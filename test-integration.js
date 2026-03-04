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
assert('Attack handler',    ksp.includes('set_engine_par($ENGINE_PAR_ATTACK, $Attack, 0, -1, -1)'));
assert('Release handler',   ksp.includes('set_engine_par($ENGINE_PAR_RELEASE, $Release, 0, -1, -1)'));
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

// ── Test 15: GUI Skin — Performance View Setup (V1.1b) ──
console.log('\n=== Test 15: GUI Skin (Performance View V1.1b) ===');

// make_perfview must be the very first command after on init
const initIdx = lines.findIndex(l => l.trim() === 'on init');
const firstCmdAfterInit = lines.slice(initIdx + 1).find(l => l.trim() !== '' && !l.trim().startsWith('{'));
assert('make_perfview is first command', firstCmdAfterInit && firstCmdAfterInit.trim() === 'make_perfview');

assert('has set_ui_height_px',  ksp.includes('set_ui_height_px('));
assert('set_ui_color is commented out', ksp.includes('{ set_ui_color(' + (-16119285) + ') }'));
assert('no active set_ui_color', !ksp.match(/^\s+set_ui_color\(/m));
assert('no hex literals in KSP',   !ksp.match(/[0-9a-f]+h\b/i));
assert('has message("")',       ksp.includes('message("")'));
assert('no set_skin_offset',    !ksp.includes('set_skin_offset'));

// ── Test 16: V1.1b — Wallpaper + Knob Skin References ──
console.log('\n=== Test 16: Wallpaper + Knob Skin (V1.1b) ===');
assert('has wallpaper reference',   ksp.includes('set_control_par_str($INST_WALLPAPER_ID, $CONTROL_PAR_PICTURE, "wallpaper")'));
assert('has knob skin reference',   ksp.includes('set_control_par_str(get_ui_id($Volume), $CONTROL_PAR_PICTURE, "sa_knob")'));
assert('no ui_label $title',        !ksp.includes('declare ui_label $title'));
assert('no set_text($title',        !ksp.includes('set_text($title'));
assert('no CONTROL_PAR_TEXT_ALIGNMENT', !ksp.includes('$CONTROL_PAR_TEXT_ALIGNMENT'));
assert('no CONTROL_PAR_FONT_TYPE',      !ksp.includes('$CONTROL_PAR_FONT_TYPE'));
assert('has $CONTROL_PAR_POS_X',         ksp.includes('$CONTROL_PAR_POS_X'));
assert('has $CONTROL_PAR_POS_Y',         ksp.includes('$CONTROL_PAR_POS_Y'));
assert('has get_ui_id',                  ksp.includes('get_ui_id($'));

// All 8 knobs have set_control_par_str for picture
const knobPicMatches = (ksp.match(/set_control_par_str\(get_ui_id\(\$\w+\), \$CONTROL_PAR_PICTURE, "sa_knob"\)/g) || []).length;
assert('8 knob skin assignments', knobPicMatches === 8);

// All 8 knobs have WIDTH=54 and HEIGHT=54 to match frame size
const widthMatches = (ksp.match(/\$CONTROL_PAR_WIDTH, 54\)/g) || []).length;
const heightMatches = (ksp.match(/\$CONTROL_PAR_HEIGHT, 54\)/g) || []).length;
assert('8 knob WIDTH=54', widthMatches === 8);
assert('8 knob HEIGHT=54', heightMatches === 8);

// 8 knobs have POS_X and POS_Y (no title label anymore)
const posXMatches = (ksp.match(/\$CONTROL_PAR_POS_X/g) || []).length;
const posYMatches = (ksp.match(/\$CONTROL_PAR_POS_Y/g) || []).length;
assert('8 POS_X (8 knobs, no title)', posXMatches === 8);
assert('8 POS_Y (8 knobs, no title)', posYMatches === 8);

// V1.1b: 500px height for 2 rows (8 knobs), 400px for 1 row
assert('500px height for 2 rows', ksp.includes('set_ui_height_px(500)'));

// V1.1b: Knob positions (Y=190 for row 1, Y=280 for row 2, spacing=75)
assert('Volume at X=20',   ksp.includes('get_ui_id($Volume), $CONTROL_PAR_POS_X, 20'));
assert('Volume at Y=190',  ksp.includes('get_ui_id($Volume), $CONTROL_PAR_POS_Y, 190'));
assert('Pan at X=95',      ksp.includes('get_ui_id($Pan), $CONTROL_PAR_POS_X, 95'));
assert('Attack at X=170',  ksp.includes('get_ui_id($Attack), $CONTROL_PAR_POS_X, 170'));
assert('Reverb at Y=280',  ksp.includes('get_ui_id($Reverb), $CONTROL_PAR_POS_Y, 280'));

// ── Test 17: GUI Skin — Verify layout with fewer knobs (V1.1b) ──
console.log('\n=== Test 17: GUI Skin (Fewer Knobs V1.1b) ===');
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
assert('4 knobs: 400px height for 1 row', ksp4.includes('set_ui_height_px(400)'));
const posX4 = (ksp4.match(/\$CONTROL_PAR_POS_X/g) || []).length;
assert('4 knobs: 4 POS_X (no title)', posX4 === 4);
assert('4 knobs: Attack at X=170', ksp4.includes('get_ui_id($Attack), $CONTROL_PAR_POS_X, 170'));
assert('4 knobs: has wallpaper', ksp4.includes('$INST_WALLPAPER_ID'));
assert('4 knobs: has knob skin', ksp4.includes('$CONTROL_PAR_PICTURE, "sa_knob"'));

// Restore
Object.keys(origEnabled).forEach(k => {
  context.templateConfig.controls[k].enabled = origEnabled[k];
});

// ── Test 18: WAV Encoder (audioBufferToWav) ──
console.log('\n=== Test 18: WAV Encoder ===');

const wavEncTestCode = `
(function() {
  // Test writeString
  var testBuf = new ArrayBuffer(4);
  var testView = new DataView(testBuf);
  writeString(testView, 0, 'RIFF');
  var writeStringOk = (testView.getUint8(0) === 82 && testView.getUint8(1) === 73 &&
                        testView.getUint8(2) === 70 && testView.getUint8(3) === 70);

  // Test audioBufferToWav with a mock AudioBuffer
  // Create a minimal mock that matches the AudioBuffer interface
  var numSamples = 100;
  var sampleRate = 44100;
  var numChannels = 1;
  var channelData = new Float32Array(numSamples);
  // Fill with a known pattern: silence then signal
  for (var i = 0; i < numSamples; i++) {
    channelData[i] = (i >= 20 && i < 80) ? 0.5 : 0.0;
  }

  var mockBuffer = {
    numberOfChannels: numChannels,
    sampleRate: sampleRate,
    length: numSamples,
    getChannelData: function(ch) { return channelData; }
  };

  var wav = audioBufferToWav(mockBuffer);
  var result = {};

  // Check it's a valid WAV
  result.isUint8Array = (wav instanceof Uint8Array);
  result.size = wav.length;
  result.expectedSize = 44 + (numSamples * numChannels * 2); // header + 16-bit PCM data

  var wavView = new DataView(wav.buffer);
  // RIFF header
  result.riff = String.fromCharCode(wav[0], wav[1], wav[2], wav[3]);
  result.wave = String.fromCharCode(wav[8], wav[9], wav[10], wav[11]);
  result.fmt = String.fromCharCode(wav[12], wav[13], wav[14], wav[15]);
  result.data = String.fromCharCode(wav[36], wav[37], wav[38], wav[39]);

  // Format fields
  result.pcmFormat = wavView.getUint16(20, true);
  result.channels = wavView.getUint16(22, true);
  result.wavSampleRate = wavView.getUint32(24, true);
  result.bitDepth = wavView.getUint16(34, true);
  result.dataSize = wavView.getUint32(40, true);
  result.expectedDataSize = numSamples * numChannels * 2;

  // Check audio content: sample 0 should be 0 (silence), sample 20 should be nonzero
  result.silentSample = wavView.getInt16(44, true);
  result.signalSample = wavView.getInt16(44 + 20 * 2, true);

  result.writeStringOk = writeStringOk;
  return result;
})()
`;

const wavResult = vm.runInContext(wavEncTestCode, context);
assert('writeString works',      wavResult.writeStringOk);
assert('output is Uint8Array',   wavResult.isUint8Array);
assert('correct file size',      wavResult.size === wavResult.expectedSize);
assert('RIFF header',            wavResult.riff === 'RIFF');
assert('WAVE marker',            wavResult.wave === 'WAVE');
assert('fmt chunk',              wavResult.fmt === 'fmt ');
assert('data chunk',             wavResult.data === 'data');
assert('PCM format = 1',        wavResult.pcmFormat === 1);
assert('channels = 1',          wavResult.channels === 1);
assert('sampleRate = 44100',    wavResult.wavSampleRate === 44100);
assert('bitDepth = 16',         wavResult.bitDepth === 16);
assert('data size correct',     wavResult.dataSize === wavResult.expectedDataSize);
assert('silent sample = 0',     wavResult.silentSample === 0);
assert('signal sample nonzero', wavResult.signalSample !== 0);

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
