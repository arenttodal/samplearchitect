/* End-to-end test of the real frontend in headless Chromium.
 *
 * The Tauri IPC layer (window.__TAURI__) is replaced by a shim that runs the
 * same commands as src-tauri/src/lib.rs against the real filesystem from Node.
 * Everything above IPC — HTML, CSS, all of src/js — is the shipping code.
 *
 * What this does NOT cover: the Rust commands themselves (see `cargo test`),
 * the WebView2/WebKit differences, and loading the output in Kontakt or
 * Decent Sampler.
 *
 * Run: npm run test:e2e
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let chromium;
try {
  chromium = require('playwright-core').chromium;
} catch (e) {
  console.error('playwright-core is not installed. Run `npm install` first.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// ── Static server for src/ ──
function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = http.createServer(function(req, res) {
    const p = path.join(SRC, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!p.startsWith(SRC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(function(resolve) {
    server.listen(0, '127.0.0.1', function() { resolve(server); });
  });
}

// ── Node-side implementations of the Rust commands ──
function collectWavs(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) collectWavs(p, out);
    else if (name.toLowerCase().endsWith('.wav')) out.push(p);
  }
  return out;
}

function wavInfo(p) {
  const buf = fs.readFileSync(p);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file (missing RIFF/WAVE header)');
  }
  let off = 12, fmt = null, dataBytes = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bitsPerSample: buf.readUInt16LE(off + 22)
      };
    } else if (id === 'data') {
      dataBytes = Math.min(size, buf.length - off - 8);
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt) throw new Error('WAV has no fmt chunk');
  if (dataBytes == null) throw new Error('WAV has no data chunk');
  const frameBytes = fmt.channels * (fmt.bitsPerSample / 8);
  return {
    sample_rate: fmt.sampleRate,
    channels: fmt.channels,
    bits_per_sample: fmt.bitsPerSample,
    format_tag: fmt.format,
    duration_secs: frameBytes > 0 ? dataBytes / frameBytes / fmt.sampleRate : 0
  };
}

const ipcLog = [];
function handleIpc(cmd, args) {
  ipcLog.push(cmd);
  switch (cmd) {
    case 'read_dir_recursive': return collectWavs(args.path, []);
    case 'read_wav_info': return wavInfo(args.path);
    case 'create_directory': fs.mkdirSync(args.path, { recursive: true }); return null;
    case 'copy_file':
      fs.mkdirSync(path.dirname(args.dest), { recursive: true });
      fs.copyFileSync(args.src, args.dest); return null;
    case 'write_text_file':
      fs.mkdirSync(path.dirname(args.path), { recursive: true });
      fs.writeFileSync(args.path, args.contents); return null;
    case 'read_file_bytes': return { __bytes: fs.readFileSync(args.path).toString('base64') };
    case 'write_file_bytes':
      fs.mkdirSync(path.dirname(args.path), { recursive: true });
      fs.writeFileSync(args.path, Buffer.from(args.bytesB64, 'base64')); return null;
    case 'path_exists': return fs.existsSync(args.path);
    default: throw new Error('Unknown command: ' + cmd);
  }
}

// Injected into the page before any app script runs.
function shimSource() {
  return '(' + function() {
    var listeners = {};
    var dialogQueue = [];
    window.__shim = {
      opened: [],
      queueDialog: function(v) { dialogQueue.push(v); },
      emit: function(name, payload) { (listeners[name] || []).forEach(function(cb) { cb({ payload: payload }); }); }
    };
    function b64ToBuf(b64) {
      var bin = atob(b64), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u.buffer;
    }
    function bufToB64(u8) {
      var s = '';
      for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(s);
    }
    window.__TAURI__ = {
      core: {
        invoke: async function(cmd, args, options) {
          // Raw-body commands (Uint8Array payload + headers), as used by write_file_bytes.
          if (args instanceof Uint8Array) {
            var hdrs = (options && options.headers) || {};
            args = { path: decodeURIComponent(hdrs['x-path']), bytesB64: bufToB64(args) };
          }
          var r = await window.__nodeIpc(cmd, args || {});
          if (r && r.__error) throw r.__error;
          if (r && r.__bytes !== undefined) return b64ToBuf(r.__bytes);
          return r;
        }
      },
      event: {
        listen: async function(name, cb) {
          (listeners[name] = listeners[name] || []).push(cb);
          return function() {};
        }
      },
      dialog: {
        save: async function() { return dialogQueue.shift() || null; },
        open: async function() { return dialogQueue.shift() || null; },
        message: async function() {}
      },
      shell: { open: async function(p) { window.__shim.opened.push(p); } }
    };
  } + ')();';
}

// ── Test helpers ──
let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log('  OK:', label);
  else { failures++; console.error('  FAIL:', label, extra !== undefined ? '— ' + extra : ''); }
}

function makeWav(file, opts) {
  opts = opts || {};
  const rate = opts.rate || 44100, bits = opts.bits || 16, ch = opts.channels || 1;
  const silence = opts.silence || 0, secs = opts.secs || 0.5, freq = opts.freq || 261.63;
  const frames = Math.round(rate * (silence + secs));
  const bps = bits / 8;
  const data = Buffer.alloc(frames * ch * bps);
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    const v = t < silence ? 0 : 0.5 * Math.sin(2 * Math.PI * freq * t);
    for (let c = 0; c < ch; c++) {
      const o = (i * ch + c) * bps;
      if (bits === 16) data.writeInt16LE(Math.round(v * 32767), o);
      else if (bits === 24) data.writeIntLE(Math.round(v * 8388607), o, 3);
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * ch * bps, 28); h.writeUInt16LE(ch * bps, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-e2e-'));
  const server = await serve();
  const url = 'http://127.0.0.1:' + server.address().port + '/index.html';

  const launchOpts = { headless: true };
  if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
  else if (fs.existsSync('/opt/pw-browsers/chromium')) {
    // Pre-installed browser in some CI/cloud images
    const dir = fs.readdirSync('/opt/pw-browsers').find(function(d) { return /^chromium-\d+$/.test(d); });
    if (dir) {
      const cand = path.join('/opt/pw-browsers', dir, 'chrome-linux', 'chrome');
      if (fs.existsSync(cand)) launchOpts.executablePath = cand;
    }
  }
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  const consoleErrors = [];
  page.on('pageerror', function(e) { consoleErrors.push(String(e)); });
  page.on('console', function(m) { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.exposeFunction('__nodeIpc', function(cmd, args) {
    try { return handleIpc(cmd, args); } catch (e) { return { __error: String(e.message || e) }; }
  });
  await page.addInitScript(shimSource());
  // Never prompt for a key / hit the network in tests.
  await page.addInitScript(function() { try { localStorage.clear(); } catch (e) {} });

  async function freshLoad() {
    await page.goto(url);
    await page.waitForFunction(function() { return typeof state !== 'undefined'; });
  }

  // ─────────────────────────────────────────────
  console.log('=== Journey 1: C3/E3/G3 → Decent Sampler + Kontakt export ===');
  const samplesDir = path.join(tmp, 'Chord');
  makeWav(path.join(samplesDir, 'Plucked', 'Test_Plucked_C3_v1_rr1.wav'), { freq: 261.63, silence: 0.4 });
  makeWav(path.join(samplesDir, 'Plucked', 'Test_Plucked_E3_v1_rr1.wav'), { freq: 329.63 });
  makeWav(path.join(samplesDir, 'Plucked', 'Test_Plucked_G3_v1_rr1.wav'), { freq: 392.0, bits: 24 });
  fs.writeFileSync(path.join(samplesDir, '.DS_Store'), 'junk');

  await freshLoad();
  check('Phase 1 static guide visible without API key', await page.isVisible('#phase1Guide'));
  await page.click('#btnReady');
  check('Phase 2 active after "I\'m Ready"', await page.isVisible('#phase2'));
  check('Continue hidden before import', !(await page.isVisible('#btnToPhase3')));

  // Import via the "Choose Folder" button (dialog.open)
  await page.evaluate(function(p) { window.__shim.queueDialog(p); }, samplesDir);
  await page.click('#btnChooseFolder');
  await page.waitForSelector('.file-row');
  const rows = await page.$$eval('.file-row', function(els) { return els.length; });
  check('3 files listed (hidden files skipped)', rows === 3, rows);
  const badge = await page.textContent('#fileBadges');
  check('matched badge says 3 matched', /3 matched/.test(badge), badge);
  const mappedKeys = await page.$$eval('.key.mapped', function(els) { return els.map(function(e) { return e.dataset.midi; }); });
  check('keyboard highlights 60/64/67', mappedKeys.join(',') === '60,64,67', mappedKeys.join(','));
  check('instrument name auto-detected', (await page.inputValue('#instrumentNameInput')) === 'Test');

  // Select a sample, see details
  await page.click('.file-row >> nth=0');
  check('sample detail shows note', /C3/.test(await page.textContent('#sampleDetail')));

  // Trim analysis on the sample with leading silence, then accept it
  await page.click('#btnAcceptAllTrims');
  await page.waitForFunction(function() { return !document.getElementById('btnAcceptAllTrims').disabled; });
  const trimmed = await page.evaluate(function() { return state.samples.filter(function(s) { return s.trimApproved; }).map(function(s) { return s.filename; }); });
  check('only the sample with leading silence gets a trim', trimmed.length === 1 && /C3/.test(trimmed[0]), trimmed.join(','));

  // Rename instrument to something hostile to paths / markup / KSP strings
  await page.fill('#instrumentNameInput', 'My "Kantele"/<b>x</b>');
  await page.click('#btnToPhase3');
  check('Phase 3 active', await page.isVisible('#phase3'));
  await page.click('#btnToPhase4');
  check('Phase 4 active', await page.isVisible('#phase4'));
  const summaryHtml = await page.innerHTML('#summaryGrid');
  check('instrument name is HTML-escaped in summary', summaryHtml.indexOf('<b>x</b>') === -1);

  const outDir = path.join(tmp, 'out', 'Build1');
  await page.evaluate(function(p) { window.__shim.queueDialog(p); }, outDir);
  await page.click('#btnBuild');
  await page.waitForSelector('#completion.visible', { timeout: 20000 });
  check('completion screen shown', true);

  const outRoot = await page.evaluate(function() { return state.outputPath; });
  check('output root exists', fs.existsSync(outRoot), outRoot);
  const listing = [];
  (function walk(d, rel) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p, rel + n + '/');
      else listing.push(rel + n);
    }
  })(outRoot, '');
  console.log('    output files:\n      ' + listing.join('\n      '));

  check('setup guide written', listing.indexOf('Setup Guide.txt') !== -1);
  const dsPreset = listing.find(function(f) { return /^Decent Sampler\/.*\.dspreset$/.test(f); });
  check('.dspreset written', !!dsPreset);
  const kspFile = listing.find(function(f) { return /^Kontakt\/Resources\/scripts\/.*\.txt$/.test(f); });
  check('KSP script written', !!kspFile);
  check('no path separators leaked from the instrument name', listing.every(function(f) { return f.indexOf('<b>') === -1 && f.indexOf('"') === -1; }));
  ['Kontakt/Resources/pictures/wallpaper.png', 'Kontakt/Resources/pictures/knob.png',
   'Kontakt/Resources/pictures/wallpaper.txt', 'Kontakt/Resources/pictures/knob.txt',
   'Kontakt/Samples/Plucked/Test_Plucked_C3_v1_rr1.wav', 'Decent Sampler/Samples/Plucked/Test_Plucked_G3_v1_rr1.wav'
  ].forEach(function(f) { check('exists: ' + f, listing.indexOf(f) !== -1); });

  // .dspreset: every referenced sample exists relative to the preset
  if (dsPreset) {
    const xml = fs.readFileSync(path.join(outRoot, dsPreset), 'utf8');
    const refs = Array.from(xml.matchAll(/path="([^"]+)"/g)).map(function(m) { return m[1]; });
    check('.dspreset references 3 samples', refs.length === 3, refs.length);
    check('all .dspreset sample paths resolve', refs.every(function(r) { return fs.existsSync(path.join(outRoot, path.dirname(dsPreset), r)); }));
    check('.dspreset has filter knob with Hz translation table', /FX_FILTER_FREQUENCY[^>]*translation="table"/.test(xml));
    check('.dspreset title escaped', xml.indexOf('<b>') === -1);
  }
  if (kspFile) {
    const ksp = fs.readFileSync(path.join(outRoot, kspFile), 'utf8');
    check('KSP title has no raw double quote from the name', /set_script_title\("[^"]*"\)/.test(ksp));
    check('KSP declares nothing outside on init', (function() {
      const afterInit = ksp.split(/\nend on\n/).slice(1).join('\n');
      return !/\bdeclare\b/.test(afterInit);
    })());
  }

  // Trimmed export keeps original sample rate and bit depth
  const trimmedOut = path.join(outRoot, 'Decent Sampler/Samples/Plucked/Test_Plucked_C3_v1_rr1.wav');
  if (fs.existsSync(trimmedOut)) {
    const info = wavInfo(trimmedOut);
    check('trimmed sample keeps 44.1 kHz', info.sample_rate === 44100, info.sample_rate);
    check('trimmed sample keeps 16-bit', info.bits_per_sample === 16, info.bits_per_sample);
    check('trimmed sample is shorter than the source (leading silence removed)', info.duration_secs < 0.85 && info.duration_secs > 0.5, info.duration_secs);
  }
  const g3 = path.join(outRoot, 'Kontakt/Samples/Plucked/Test_Plucked_G3_v1_rr1.wav');
  if (fs.existsSync(g3)) check('untrimmed 24-bit sample copied byte-identical', fs.readFileSync(g3).equals(fs.readFileSync(path.join(samplesDir, 'Plucked/Test_Plucked_G3_v1_rr1.wav'))));

  // Completion actions
  await page.click('#btnOpenFolder');
  await page.click('#btnViewGuide');
  const opened = await page.evaluate(function() { return window.__shim.opened; });
  check('Open folder / guide call shell.open', opened.length === 2 && /Setup Guide\.txt$/.test(opened[1]), opened.join(' | '));

  // Building again into the same folder must not silently overwrite
  await page.click('#btnBuildAgain');
  await page.evaluate(function(p) { window.__shim.queueDialog(p); }, outDir);
  await page.click('#btnBuild');
  await page.waitForSelector('#completion.visible, #buildError.visible', { timeout: 20000 });
  const secondRoot = await page.evaluate(function() { return state.outputPath; });
  check('second build goes to a new folder, not over the first', secondRoot !== outRoot && fs.existsSync(secondRoot), secondRoot);

  // ─────────────────────────────────────────────
  console.log('\n=== Journey 2: unmatched files, manual assignment, validation ===');
  const messyDir = path.join(tmp, 'Messy');
  makeWav(path.join(messyDir, 'recording_017.wav'));
  makeWav(path.join(messyDir, 'Piano_Sustain_C3_v1_rr1.wav'));
  makeWav(path.join(messyDir, 'Piano_Sustain_D3_v1_rr1.wav', ), { rate: 48000 });
  fs.writeFileSync(path.join(messyDir, 'Piano_Sustain_E3_v1_rr1.wav'), 'this is not audio');

  await freshLoad();
  await page.click('#btnReady');
  await page.evaluate(function(p) { window.__shim.emit('tauri://drag-drop', { paths: [p] }); }, messyDir);
  await page.waitForSelector('.file-row');
  const badge2 = await page.textContent('#fileBadges');
  check('unmatched badge shown', /unmatched/.test(badge2), badge2);
  const warn = await page.textContent('#validationWarning');
  check('mixed sample rate warning shown', /sample rate/i.test(warn), warn);
  check('unreadable WAV is reported', /E3|not audio|unreadable|invalid/i.test(warn + (await page.textContent('#fileListScroll'))), warn);
  check('Continue still allowed (warnings only)', await page.isVisible('#btnToPhase3'));

  // Assign the unmatched file to C3 → duplicate → blocked
  const unmatchedIdx = await page.evaluate(function() { return state.samples.findIndex(function(s) { return s.filename === 'recording_017.wav'; }); });
  await page.click('.file-row >> nth=' + unmatchedIdx);
  await page.selectOption('#assignNote', 'C');
  await page.selectOption('#assignOctave', '3');
  await page.fill('#assignArt', 'Sustain');
  await page.click('#btnApplyAssign');
  const err = await page.textContent('#validationWarning');
  check('duplicate mapping blocks Continue', /Duplicate/i.test(err) && !(await page.isVisible('#btnToPhase3')), err);

  // Out of MIDI range assignment is refused
  await page.click('.file-row >> nth=' + unmatchedIdx);
  if (await page.isVisible('#assignNote')) {
    await page.selectOption('#assignNote', 'B');
    await page.selectOption('#assignOctave', '8');
    await page.click('#btnApplyAssign');
    check('out-of-range note (B8) refused', /range/i.test(await page.textContent('#sampleDetail')));
  } else {
    // Manual assignment already applied; reopen editor
    check('assignment form reachable for re-edit', await page.isVisible('#btnEditAssign'));
    await page.click('#btnEditAssign');
    await page.selectOption('#assignNote', 'B');
    await page.selectOption('#assignOctave', '8');
    await page.click('#btnApplyAssign');
    check('out-of-range note (B8) refused', /range/i.test(await page.textContent('#sampleDetail')));
    await page.selectOption('#assignNote', 'F');
    await page.selectOption('#assignOctave', '3');
    await page.fill('#assignArt', '../../evil');
    await page.click('#btnApplyAssign');
  }
  const err2 = await page.textContent('#validationWarning');
  check('duplicate cleared after re-assigning to F3', !/Duplicate/i.test(err2), err2);
  check('articulation sanitized', await page.evaluate(function() {
    return state.samples.every(function(s) { return !s.articulation || s.articulation.indexOf('/') === -1 && s.articulation.indexOf('..') === -1; });
  }));

  // Re-import a different folder from phase 2
  check('change-folder control available after import', await page.isVisible('#btnChooseFolder'));

  // Drop while on another phase is ignored
  await page.click('#btnToPhase3');
  const before = await page.evaluate(function() { return state.samples.length; });
  await page.evaluate(function(p) { window.__shim.emit('tauri://drag-drop', { paths: [p] }); }, samplesDir);
  await page.waitForTimeout(300);
  const after = await page.evaluate(function() { return state.samples.length; });
  check('drop outside phase 2 does not replace samples', before === after, before + ' vs ' + after);

  // ─────────────────────────────────────────────
  console.log('\n=== Journey 3: error states ===');
  await freshLoad();
  await page.click('#btnReady');
  const emptyDir = path.join(tmp, 'Empty');
  fs.mkdirSync(emptyDir);
  await page.evaluate(function(p) { window.__shim.emit('tauri://drag-drop', { paths: [p] }); }, emptyDir);
  await page.waitForTimeout(300);
  check('empty folder explains itself', /no \.wav/i.test(await page.textContent('#phase2')));

  // Build failure shows an error and lets the user retry
  await page.evaluate(function(p) { window.__shim.emit('tauri://drag-drop', { paths: [p] }); }, samplesDir);
  await page.waitForSelector('.file-row');
  await page.click('#btnToPhase3');
  await page.click('#btnToPhase4');
  const blocker = path.join(tmp, 'blocker');
  fs.writeFileSync(blocker, 'a file where a folder must go');
  await page.evaluate(function(p) { window.__shim.queueDialog(p); }, path.join(blocker, 'out'));
  await page.click('#btnBuild');
  await page.waitForSelector('#buildError.visible', { timeout: 10000 });
  check('build error is shown', true);
  check('build button available again for retry', await page.isVisible('#btnBuild'));

  // Template folder download reports success
  await freshLoad();
  const tplDir = path.join(tmp, 'Template', 'MySamples');
  await page.evaluate(function(p) { window.__shim.queueDialog(p); }, tplDir);
  await page.click('#btnDownloadTemplate');
  await page.waitForTimeout(300);
  check('template folders created', ['Plucked', 'Strummed', 'Harmonics', 'Sustain'].every(function(f) { return fs.existsSync(path.join(tplDir, f)); }));
  check('template creation reports success', /created/i.test(await page.textContent('#phase1')));

  // ─────────────────────────────────────────────
  const relevantErrors = consoleErrors.filter(function(e) { return !/Build failed|Not a directory|ENOTDIR|EEXIST|not audio|decod|Unable to decode|Trim analysis failed/i.test(e); });
  check('no unexpected console errors', relevantErrors.length === 0, relevantErrors.join('\n'));

  await page.screenshot({ path: path.join(tmp, 'last.png') });
  await browser.close();
  server.close();
  console.log('\nArtifacts in ' + tmp);
  console.log(failures === 0 ? '\nE2E: ALL PASSED' : '\nE2E: ' + failures + ' FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(function(e) { console.error(e); process.exit(1); });
