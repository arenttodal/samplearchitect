/* Smoke test of the real desktop binary (Rust commands + WebKit + IPC).
 *
 * Drives the built app through tauri-driver (W3C WebDriver). Native file
 * dialogs can't be automated, so only `dialog.save/open` are replaced in the
 * page; every `invoke` goes to the real Rust backend and touches real files.
 *
 * Linux prerequisites: webkit2gtk-driver (WebKitWebDriver), `cargo install
 * tauri-driver`, a display (e.g. `xvfb-run`), and a built app:
 *   npx tauri build --no-bundle
 *   xvfb-run node tests/tauri-smoke.js [path/to/binary]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BINARY = process.argv[2] || path.join(ROOT, 'src-tauri/target/release/samplearchitect');
const DRIVER = process.env.TAURI_DRIVER || path.join(os.homedir(), '.cargo/bin/tauri-driver');
const BASE = 'http://127.0.0.1:4444';

let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log('  OK:', label);
  else { failures++; console.error('  FAIL:', label, extra !== undefined ? '— ' + extra : ''); }
}

async function wd(method, url, body) {
  const r = await fetch(BASE + url, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json();
  if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message);
  return j.value;
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function makeWav(file, rate, bits, silenceSecs, secs, freq) {
  const frames = Math.round(rate * (silenceSecs + secs));
  const bps = bits / 8;
  const data = Buffer.alloc(frames * bps);
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    const v = t < silenceSecs ? 0 : 0.5 * Math.sin(2 * Math.PI * freq * t);
    if (bits === 16) data.writeInt16LE(Math.round(v * 32767), i * 2);
    else data.writeIntLE(Math.round(v * 8388607), i * 3, 3);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * bps, 28); h.writeUInt16LE(bps, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

function readFmt(file) {
  const b = fs.readFileSync(file);
  return { rate: b.readUInt32LE(24), bits: b.readUInt16LE(34), bytes: b.length };
}

async function main() {
  if (!fs.existsSync(BINARY)) {
    console.error('App binary not found: ' + BINARY + '\nBuild it with `npx tauri build --no-bundle`.');
    process.exit(1);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-smoke-'));
  const samples = path.join(tmp, 'Kantele samples');
  makeWav(path.join(samples, 'Plucked', 'Kantele_Plucked_C3_v1_rr1.wav'), 44100, 24, 0.5, 0.5, 261.63);
  makeWav(path.join(samples, 'Plucked', 'Kantele_Plucked_E3_v1_rr1.wav'), 44100, 16, 0, 0.5, 329.63);
  makeWav(path.join(samples, 'Plucked', 'Kantele_Plucked_G3_v1_rr1.wav'), 44100, 16, 0, 0.5, 392.0);
  const outDir = path.join(tmp, 'Export', 'Kantele_SampleArchitect');

  const driver = spawn(DRIVER, [], { stdio: ['ignore', 'ignore', 'inherit'] });
  let session = null;
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch(BASE + '/status'); break; } catch (e) { await sleep(200); }
    }
    const s = await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: BINARY } } } });
    session = s.sessionId;
    const exec = function(script, args) { return wd('POST', '/session/' + session + '/execute/sync', { script: script, args: args || [] }); };
    const execAsync = function(script, args) { return wd('POST', '/session/' + session + '/execute/async', { script: script, args: args || [] }); };
    await wd('POST', '/session/' + session + '/timeouts', { script: 60000 });

    // Wait for the app to boot
    for (let i = 0; i < 50; i++) {
      if (await exec('return typeof state !== "undefined" && !!window.__TAURI__;')) break;
      await sleep(200);
    }
    console.log('=== Real app: import → trim → build ===');
    check('app booted with Tauri globals', await exec('return typeof state !== "undefined" && !!window.__TAURI__;'));
    check('version shown', /1\.2\.0/.test(await exec('return document.getElementById("appVersion").textContent;')));

    await exec('document.getElementById("btnReady").click();');
    await execAsync('var done = arguments[arguments.length - 1]; handleFileDrop(arguments[0]).then(function() { done(true); }, function(e) { done(String(e)); });', [samples]);
    const imported = await exec('return state.samples.map(function(s) { return { f: s.filename, parsed: s.parsed, rate: s.wavInfo && s.wavInfo.sample_rate, bits: s.wavInfo && s.wavInfo.bits_per_sample, bad: s.unreadable || null }; });');
    check('3 samples imported and parsed', imported.length === 3 && imported.every(function(x) { return x.parsed; }), JSON.stringify(imported));
    check('read_wav_info (Rust) returned headers', imported.every(function(x) { return x.rate === 44100; }) && imported.some(function(x) { return x.bits === 24; }), JSON.stringify(imported));

    // read_file_bytes → ArrayBuffer → decode at native rate (WebKit/GStreamer)
    await execAsync('var done = arguments[arguments.length - 1]; acceptAllTrims().then(function() { done(true); }, function(e) { done(String(e)); });');
    const trims = await exec('return state.samples.map(function(s) { return [s.filename, s.trimApproved, s.silenceRemoved]; });');
    const c3 = trims.find(function(t) { return /C3/.test(t[0]); });
    check('trim analysis ran in WebKit (C3 leading silence found)', c3 && c3[1] === true && c3[2] > 0.3, JSON.stringify(trims));

    await exec('document.getElementById("btnToPhase3").click();');
    await exec('document.getElementById("btnToPhase4").click();');
    check('reached Export step', await exec('return state.currentPhase;') === 4);

    // Only the native save dialog is replaced; the build itself is real
    await exec('window.__TAURI__.dialog.save = async function() { return ' + JSON.stringify(outDir) + '; };');
    await exec('document.getElementById("btnBuild").click();');
    let done = false;
    for (let i = 0; i < 150 && !done; i++) {
      await sleep(200);
      done = await exec('return document.getElementById("completion").classList.contains("visible") || document.getElementById("buildError").classList.contains("visible");');
    }
    const buildError = await exec('return document.getElementById("buildError").textContent;');
    check('build completed without error', done && !buildError, buildError);

    const root = await exec('return state.outputPath;');
    check('output folder created', root && fs.existsSync(root), root);
    if (root && fs.existsSync(root)) {
      const ds = path.join(root, 'Decent Sampler', 'Kantele.dspreset');
      check('Decent Sampler preset written', fs.existsSync(ds));
      check('KSP script written', fs.existsSync(path.join(root, 'Kontakt', 'Resources', 'scripts', 'Kantele_script.txt')));
      const png = path.join(root, 'Kontakt', 'Resources', 'pictures', 'wallpaper.png');
      check('wallpaper PNG written via raw-body IPC', fs.existsSync(png) && fs.readFileSync(png).slice(1, 4).toString() === 'PNG');
      const trimmed = path.join(root, 'Decent Sampler', 'Samples', 'Plucked', 'Kantele_Plucked_C3_v1_rr1.wav');
      if (fs.existsSync(trimmed)) {
        const f = readFmt(trimmed);
        check('trimmed C3 keeps 44.1 kHz / 24-bit', f.rate === 44100 && f.bits === 24, JSON.stringify(f));
        check('trimmed C3 is shorter than source', f.bytes < fs.statSync(path.join(samples, 'Plucked', 'Kantele_Plucked_C3_v1_rr1.wav')).size, f.bytes);
      } else {
        check('trimmed C3 exported', false);
      }
      check('setup guide written', fs.existsSync(path.join(root, 'Setup Guide.txt')));
    }

    if (process.env.SMOKE_SCREENSHOT) {
      const png = await wd('GET', '/session/' + session + '/screenshot');
      fs.writeFileSync(process.env.SMOKE_SCREENSHOT, Buffer.from(png, 'base64'));
    }
  } finally {
    if (session) { try { await wd('DELETE', '/session/' + session); } catch (e) {} }
    driver.kill();
  }
  console.log('\nArtifacts in ' + tmp);
  console.log(failures === 0 ? 'SMOKE: ALL PASSED' : 'SMOKE: ' + failures + ' FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(function(e) { console.error(e); process.exit(1); });
