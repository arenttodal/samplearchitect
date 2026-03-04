/* Integration test — Simulates the full pipeline without GUI */
/* Run with: node test-integration.js */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Create a shared context for all modules
const context = vm.createContext({
  console: console,
  Math: Math,
  parseInt: parseInt,
  Object: Object,
  Array: Array,
  Map: Map,
  Uint8Array: Uint8Array,
  DataView: DataView,
  String: String,
  document: null,
  window: {},
  navigator: {}
});

// Evaluate modules in order in the same context
const modules = [
  'src/js/parser.js',
  'src/js/mapper.js',
  'src/js/template.js',
  'src/js/trimmer.js',
  'src/js/ksp-gen.js'
];

modules.forEach(function(mod) {
  const code = fs.readFileSync(path.join(__dirname, mod), 'utf-8');
  vm.runInContext(code, context, { filename: mod });
});

var failed = false;
function assert(label, condition) {
  if (!condition) {
    console.error('  FAIL:', label);
    failed = true;
  } else {
    console.log('  OK:', label);
  }
}

// Now run the tests in the same context
const testCode = `
// ── Test 1: Parser ──
console.log('=== Test 1: Parser ===');

var testFiles = [
  'Test_Plucked_C3_v1_rr1.wav',
  'Test_Plucked_E3_v1_rr1.wav',
  'Test_Plucked_G3_v1_rr1.wav'
];

var samples = testFiles.map(function(f) {
  return parseFilename(f, '/test/' + f);
});

samples.forEach(function(s) {
  console.log('  ' + s.filename + ' -> ' + s.note + (s.accidental || '') + s.octave + ' MIDI:' + s.midiNote);
});

var allParsed = samples.every(function(s) { return s.parsed; });
if (!allParsed) throw new Error('Not all samples parsed');

// ── Test 2: MIDI Notes ──
console.log('\\n=== Test 2: MIDI Notes ===');
if (samples[0].midiNote !== 60 || samples[1].midiNote !== 64 || samples[2].midiNote !== 67) {
  throw new Error('MIDI notes incorrect');
}
console.log('  C3=60, E3=64, G3=67 — correct');

// ── Test 3: Key Range Assignment ──
console.log('\\n=== Test 3: Key Ranges ===');
assignKeyRanges(samples);
assignVelocityRanges(samples);
samples.forEach(function(s) {
  console.log('  ' + s.filename + ' -> [' + s.lowKey + '-' + s.highKey + '] root:' + s.rootKey + ' vel:' + s.velLow + '-' + s.velHigh);
});

// ── Test 4: Validation ──
console.log('\\n=== Test 4: Validation ===');
var validation = validateSamples(samples);
if (validation.errors.length > 0) throw new Error('Validation errors: ' + validation.errors.join(', '));
console.log('  No errors');

// ── Test 5: Stats ──
console.log('\\n=== Test 5: Stats ===');
var stats = getSampleStats(samples);
console.log('  Instrument: ' + stats.instrument + ', Samples: ' + stats.totalSamples + ', Articulations: ' + stats.articulationList.join(', '));

// ── Test 6: KSP Generation ──
console.log('\\n=== Test 6: KSP Generation ===');
var ksp = generateKSP(samples, stats, templateConfig);
console.log('  Script length: ' + ksp.length + ' chars');

// Return for Node-side assertions
var result = { ksp: ksp, stats: stats };
result;
`;

const result = vm.runInContext(testCode, context);
const ksp = result.ksp;

// Write KSP to test-output
const outputDir = path.join(__dirname, 'test-output');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'Test_script.txt'), ksp);
console.log('\nKSP written to test-output/Test_script.txt');

// ── Test 7: KSP Structure Verification ──
console.log('\n=== Test 7: KSP Structure ===');
const lines = ksp.split('\n');

assert('has on init', lines.some(l => l.trim() === 'on init'));
assert('has end on', lines.some(l => l.trim() === 'end on'));
assert('has set_script_title', ksp.includes('set_script_title'));
assert('has message()', ksp.includes('message('));

// ── Test 8: All 8 knob declarations with 0-1000000 range ──
console.log('\n=== Test 8: Knob Declarations (0-1000000 range) ===');
assert('Volume knob',    ksp.includes('declare ui_knob $Volume (0, 1000000, 1)'));
assert('Pan knob',       ksp.includes('declare ui_knob $Pan (0, 1000000, 1)'));
assert('Attack knob',    ksp.includes('declare ui_knob $Attack (0, 1000000, 1)'));
assert('Release knob',   ksp.includes('declare ui_knob $Release (0, 1000000, 1)'));
assert('Tune knob',      ksp.includes('declare ui_knob $Tune (0, 1000000, 1)'));
assert('Cutoff knob',    ksp.includes('declare ui_knob $Cutoff (0, 1000000, 1)'));
assert('Resonance knob', ksp.includes('declare ui_knob $Resonance (0, 1000000, 1)'));
assert('Reverb knob',    ksp.includes('declare ui_knob $Reverb (0, 1000000, 1)'));

// ── Test 9: Correct default values ──
console.log('\n=== Test 9: Default Values ===');
assert('Volume := 750000',    ksp.includes('$Volume := 750000'));
assert('Pan := 500000',       ksp.includes('$Pan := 500000'));
assert('Attack := 0',         ksp.includes('$Attack := 0'));
assert('Release := 350000',   ksp.includes('$Release := 350000'));
assert('Tune := 500000',      ksp.includes('$Tune := 500000'));
assert('Cutoff := 800000',    ksp.includes('$Cutoff := 800000'));
assert('Resonance := 200000', ksp.includes('$Resonance := 200000'));
assert('Reverb := 300000',    ksp.includes('$Reverb := 300000'));

// ── Test 10: UI Control Handlers — direct pass, no scaling ──
console.log('\n=== Test 10: UI Control Handlers (no scaling) ===');
assert('Volume handler',    ksp.includes('set_engine_par($ENGINE_PAR_VOLUME, $Volume, -1, -1, -1)'));
assert('Pan handler',       ksp.includes('set_engine_par($ENGINE_PAR_PAN, $Pan, -1, -1, -1)'));
assert('Attack handler',    ksp.includes('set_engine_par($ENGINE_PAR_ATTACK, $Attack, -1, -1, -1)'));
assert('Release handler',   ksp.includes('set_engine_par($ENGINE_PAR_RELEASE, $Release, -1, -1, -1)'));
assert('Tune handler',      ksp.includes('set_engine_par($ENGINE_PAR_TUNE, $Tune, -1, -1, -1)'));
assert('Cutoff handler',    ksp.includes('set_engine_par($ENGINE_PAR_CUTOFF, $Cutoff, 0, 0, -1)'));
assert('Resonance handler', ksp.includes('set_engine_par($ENGINE_PAR_RESONANCE, $Resonance, 0, 0, -1)'));
assert('Reverb handler',    ksp.includes('set_engine_par($ENGINE_PAR_INSERT_EFFECT_OUTPUT_GAIN, $Reverb, -1, 0, 1)'));

// ── Test 11: NO zone mapping code ──
console.log('\n=== Test 11: No Zone Mapping ===');
assert('no get_zone_id',           !ksp.includes('get_zone_id'));
assert('no zone_get_sample_name',  !ksp.includes('zone_get_sample_name'));
assert('no set_zone_par',          !ksp.includes('set_zone_par'));
assert('no ZONE_PAR_ROOT_KEY',     !ksp.includes('ZONE_PAR_ROOT_KEY'));
assert('no $num_zones',            !ksp.includes('$num_zones'));

// ── Test 12: NO invalid constants ──
console.log('\n=== Test 12: No Invalid Constants ===');
assert('no ENGINE_PAR_EFFECT_DRYWET',       !ksp.includes('ENGINE_PAR_EFFECT_DRYWET'));
assert('no ENGINE_PAR_SEND_EFFECT_0_LEVEL', !ksp.includes('ENGINE_PAR_SEND_EFFECT_0_LEVEL'));

// ── Test 13: Effects chain present (Filter, Reverb, Delay — skip EQ) ──
console.log('\n=== Test 13: Effects Chain ===');
assert('has Filter effect',  ksp.includes('$EFFECT_TYPE_FILTER, 0, 0, -1'));
assert('has Reverb effect',  ksp.includes('$EFFECT_TYPE_REVERB, -1, 0, 1'));
assert('has Delay effect',   ksp.includes('$EFFECT_TYPE_DELAY, -1, 1, 1'));
assert('no EQ effect',       !ksp.includes('EFFECT_TYPE_PARA_EQ'));

// ── Test 14: No scaling math ──
console.log('\n=== Test 14: No Scaling Math ===');
assert('no * 6300',  !ksp.includes('* 6300'));
assert('no * 10000', !ksp.includes('* 10000'));
assert('no * 1000',  !ksp.includes('* 1000'));
assert('no * 10',    !ksp.includes('* 10'));

// ── Test 15: GUI Skin — Performance View Setup ──
console.log('\n=== Test 15: GUI Skin (Performance View) ===');

// make_perfview must be the very first command after on init
const initIdx = lines.findIndex(l => l.trim() === 'on init');
const firstCmdAfterInit = lines.slice(initIdx + 1).find(l => l.trim() !== '' && !l.trim().startsWith('{'));
assert('make_perfview is first command', firstCmdAfterInit && firstCmdAfterInit.trim() === 'make_perfview');

assert('has set_ui_height_px',  ksp.includes('set_ui_height_px('));
assert('has set_ui_color decimal', ksp.includes('set_ui_color(-16119285)'));
assert('no hex literals in KSP',   !ksp.match(/[0-9a-f]+h\b/i));
assert('has message("")',       ksp.includes('message("")'));
assert('no set_skin_offset',    !ksp.includes('set_skin_offset'));

// ── Test 16: GUI Skin — Title Label + Knob Positioning ──
console.log('\n=== Test 16: Title Label + Knob Positioning ===');
assert('has ui_label $title',            ksp.includes('declare ui_label $title'));
assert('has set_text title',             ksp.includes('set_text($title, "Test")'));
assert('has CONTROL_PAR_TEXT_ALIGNMENT', ksp.includes('$CONTROL_PAR_TEXT_ALIGNMENT'));
assert('has CONTROL_PAR_FONT_TYPE',      ksp.includes('$CONTROL_PAR_FONT_TYPE'));
assert('has CONTROL_PAR_POS_X',          ksp.includes('$CONTROL_PAR_POS_X'));
assert('has CONTROL_PAR_POS_Y',          ksp.includes('$CONTROL_PAR_POS_Y'));
assert('has get_ui_id',                  ksp.includes('get_ui_id($'));

// Verify all 8 knobs have position set (X and Y for each) — title label also has X/Y so +1
const posXMatches = (ksp.match(/\$CONTROL_PAR_POS_X/g) || []).length;
const posYMatches = (ksp.match(/\$CONTROL_PAR_POS_Y/g) || []).length;
assert('9 POS_X (8 knobs + title)', posXMatches === 9);
assert('9 POS_Y (8 knobs + title)', posYMatches === 9);

// Verify 2-row layout for 8 knobs (more than 6 = 2 rows)
assert('330px height for 8 knobs', ksp.includes('set_ui_height_px(330)'));

// Verify specific knob positions (Y=40 for row 1, Y=120 for row 2)
assert('Volume at X=20',  ksp.includes('get_ui_id($Volume), $CONTROL_PAR_POS_X, 20'));
assert('Volume at Y=40',  ksp.includes('get_ui_id($Volume), $CONTROL_PAR_POS_Y, 40'));
assert('Pan at X=120',    ksp.includes('get_ui_id($Pan), $CONTROL_PAR_POS_X, 120'));
assert('Reverb at X=120', ksp.includes('get_ui_id($Reverb), $CONTROL_PAR_POS_X, 120'));
assert('Reverb at Y=120', ksp.includes('get_ui_id($Reverb), $CONTROL_PAR_POS_Y, 120'));

// ── Test 17: GUI Skin — Verify layout with fewer knobs ──
console.log('\n=== Test 17: GUI Skin (Fewer Knobs) ===');
// Temporarily disable some controls to test single row
const origEnabled = {};
Object.keys(context.templateConfig.controls).forEach(k => {
  origEnabled[k] = context.templateConfig.controls[k].enabled;
});

// Enable only 4 knobs
Object.keys(context.templateConfig.controls).forEach(k => {
  context.templateConfig.controls[k].enabled = false;
});
context.templateConfig.controls.volume.enabled = true;
context.templateConfig.controls.pan.enabled = true;
context.templateConfig.controls.attack.enabled = true;
context.templateConfig.controls.release.enabled = true;

const ksp4 = vm.runInContext('generateKSP(samples, stats, templateConfig)', context);
assert('4 knobs: 250px height', ksp4.includes('set_ui_height_px(250)'));
const posX4 = (ksp4.match(/\$CONTROL_PAR_POS_X/g) || []).length;
assert('4 knobs: 5 POS_X (4 knobs + title)', posX4 === 5);
assert('4 knobs: Attack at X=220', ksp4.includes('get_ui_id($Attack), $CONTROL_PAR_POS_X, 220'));

// Restore
Object.keys(origEnabled).forEach(k => {
  context.templateConfig.controls[k].enabled = origEnabled[k];
});

// ── Test 18: Trimmer — WAV header parsing ──
console.log('\n=== Test 18: Trimmer (WAV Parsing) ===');

// Create a minimal valid WAV file in memory
const trimTestCode = `
(function() {
  // Build a minimal 16-bit mono WAV: 44 byte header + 100 samples of data
  var numSamples = 100;
  var numChannels = 1;
  var sampleRate = 44100;
  var bitsPerSample = 16;
  var bytesPerSample = bitsPerSample / 8;
  var blockAlign = numChannels * bytesPerSample;
  var dataSize = numSamples * blockAlign;
  var fileSize = 44 + dataSize;

  var buf = new Uint8Array(fileSize);
  var view = new DataView(buf.buffer);

  // RIFF header
  buf[0]=82; buf[1]=73; buf[2]=70; buf[3]=70; // "RIFF"
  view.setUint32(4, fileSize - 8, true);
  buf[8]=87; buf[9]=65; buf[10]=86; buf[11]=69; // "WAVE"

  // fmt chunk
  buf[12]=102; buf[13]=109; buf[14]=116; buf[15]=32; // "fmt "
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  buf[36]=100; buf[37]=97; buf[38]=116; buf[39]=97; // "data"
  view.setUint32(40, dataSize, true);

  // Write some audio: first 20 samples silence, then signal, then 20 samples silence
  for (var i = 0; i < numSamples; i++) {
    var val = 0;
    if (i >= 20 && i < 80) {
      val = 16000; // loud signal
    }
    view.setInt16(44 + i * 2, val, true);
  }

  var header = parseWavHeader(buf);
  var result = {};
  result.headerOk = (header !== null);
  result.channels = header ? header.numChannels : 0;
  result.sampleRate = header ? header.sampleRate : 0;
  result.bitsPerSample = header ? header.bitsPerSample : 0;
  result.dataOffset = header ? header.dataOffset : 0;
  result.dataSize = header ? header.dataSize : 0;

  // Test trimming
  var trimmed = trimWavBytes(buf, 15, 85);
  result.trimmedLength = trimmed.length;
  var trimmedHeader = parseWavHeader(trimmed);
  result.trimmedDataSize = trimmedHeader ? trimmedHeader.dataSize : 0;
  // Expected: 70 samples * 2 bytes = 140 bytes
  result.expectedTrimmedDataSize = 70 * 2;

  return result;
})()
`;

const trimResult = vm.runInContext(trimTestCode, context);
assert('WAV header parsed',     trimResult.headerOk);
assert('channels = 1',          trimResult.channels === 1);
assert('sampleRate = 44100',    trimResult.sampleRate === 44100);
assert('bitsPerSample = 16',    trimResult.bitsPerSample === 16);
assert('dataOffset = 44',       trimResult.dataOffset === 44);
assert('dataSize = 200',        trimResult.dataSize === 200);
assert('trimmed data correct',  trimResult.trimmedDataSize === trimResult.expectedTrimmedDataSize);

// ── Test 19: Verify no plugins key in tauri.conf.json ──
console.log('\n=== Test 19: Tauri Config ===');
const tauriConf = JSON.parse(fs.readFileSync(path.join(__dirname, 'src-tauri/tauri.conf.json'), 'utf-8'));
assert('no plugins key', !('plugins' in tauriConf));

// ── Final result ──
if (failed) {
  console.error('\n========================================');
  console.error('SOME TESTS FAILED');
  console.error('========================================');
  process.exit(1);
} else {
  console.log('\n========================================');
  console.log('ALL TESTS PASSED');
  console.log('========================================');
}
