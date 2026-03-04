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
  document: null,
  window: {}
});

// Evaluate modules in order in the same context
const modules = [
  'src/js/parser.js',
  'src/js/mapper.js',
  'src/js/template.js',
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
