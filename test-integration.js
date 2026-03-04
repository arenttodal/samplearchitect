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
  console.log(
    s.filename,
    '-> parsed:', s.parsed,
    ', note:', s.note + (s.accidental || '') + s.octave,
    ', midi:', s.midiNote,
    ', vel:', s.velocityLayer,
    ', rr:', s.roundRobin
  );
});

var allParsed = samples.every(function(s) { return s.parsed; });
console.log('All parsed:', allParsed);
if (!allParsed) throw new Error('Not all samples parsed');

// Verify MIDI notes
console.log('\\n=== Test 2: MIDI Notes ===');
console.log('C3 MIDI:', samples[0].midiNote, '(expected 60)');
console.log('E3 MIDI:', samples[1].midiNote, '(expected 64)');
console.log('G3 MIDI:', samples[2].midiNote, '(expected 67)');

if (samples[0].midiNote !== 60 || samples[1].midiNote !== 64 || samples[2].midiNote !== 67) {
  throw new Error('MIDI notes incorrect');
}

// ── Test 3: Key Range Assignment ──
console.log('\\n=== Test 3: Key Ranges ===');
assignKeyRanges(samples);
assignVelocityRanges(samples);

samples.forEach(function(s) {
  console.log(
    s.filename,
    '-> low:', s.lowKey, 'root:', s.rootKey, 'high:', s.highKey,
    ', vel:', s.velLow + '-' + s.velHigh
  );
});

// ── Test 4: Validation ──
console.log('\\n=== Test 4: Validation ===');
var validation = validateSamples(samples);
console.log('Errors:', validation.errors.length === 0 ? 'None' : validation.errors);
console.log('Warnings:', validation.warnings.length === 0 ? 'None' : validation.warnings);

if (validation.errors.length > 0) throw new Error('Validation errors: ' + validation.errors.join(', '));

// ── Test 5: Stats ──
console.log('\\n=== Test 5: Stats ===');
var stats = getSampleStats(samples);
console.log('Instrument:', stats.instrument);
console.log('Total samples:', stats.totalSamples);
console.log('Articulations:', stats.articulationList.join(', '));
console.log('Max vel layers:', stats.maxVelocityLayers);
console.log('Max RR:', stats.maxRoundRobins);

// ── Test 6: KSP Generation (NEW — no zone mapping) ──
console.log('\\n=== Test 6: KSP Generation ===');
var ksp = generateKSP(samples, stats, templateConfig);
console.log('KSP script length:', ksp.length, 'chars');
console.log('Contains on init:', ksp.indexOf('on init') > -1);
console.log('Contains end on:', ksp.indexOf('end on') > -1);
console.log('Contains set_script_title:', ksp.indexOf('set_script_title') > -1);
console.log('Contains Volume knob:', ksp.indexOf('declare ui_knob \\$Volume') > -1);
console.log('Contains ui_control handler:', ksp.indexOf('on ui_control') > -1);

// Verify NO zone mapping code exists
console.log('\\nVerifying NO zone mapping code:');
console.log('No get_zone_id:', ksp.indexOf('get_zone_id') === -1);
console.log('No zone_get_sample_name:', ksp.indexOf('zone_get_sample_name') === -1);
console.log('No set_zone_par:', ksp.indexOf('set_zone_par') === -1);
console.log('No ZONE_PAR_ROOT_KEY:', ksp.indexOf('ZONE_PAR_ROOT_KEY') === -1);
console.log('No \\$num_zones:', ksp.indexOf('\\$num_zones') === -1);

// Verify NO effects chain code
console.log('No EFFECT_TYPE_FILTER:', ksp.indexOf('EFFECT_TYPE_FILTER') === -1);
console.log('No EFFECT_TYPE_REVERB:', ksp.indexOf('EFFECT_TYPE_REVERB') === -1);
console.log('No EFFECT_TYPE_DELAY:', ksp.indexOf('EFFECT_TYPE_DELAY') === -1);

// Verify correct knob ranges (0-100 style)
console.log('\\nVerifying knob ranges:');
console.log('Volume 0-100:', ksp.indexOf('\\$Volume (0, 100, 1)') > -1);
console.log('Attack 0-100:', ksp.indexOf('\\$Attack (0, 100, 1)') > -1);
console.log('Release 0-100:', ksp.indexOf('\\$Release (0, 100, 1)') > -1);
console.log('Tune -36 to 36:', ksp.indexOf('\\$Tune (-36, 36, 1)') > -1);

// Verify correct engine_par scaling
console.log('\\nVerifying engine par scaling:');
console.log('Volume * 6300:', ksp.indexOf('\\$Volume * 6300') > -1);
console.log('Attack * 10000:', ksp.indexOf('\\$Attack * 10000') > -1);
console.log('Tune * 1000:', ksp.indexOf('\\$Tune * 1000') > -1);

// Return KSP for file writing
var result = { ksp: ksp, stats: stats };
result;
`;

const result = vm.runInContext(testCode, context);

// Write KSP to test-output
const outputDir = path.join(__dirname, 'test-output');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'Test_script.txt'), result.ksp);
console.log('\nKSP written to test-output/Test_script.txt');

// ── Test 7: Verify KSP structure ──
console.log('\n=== Test 7: KSP Structure Verification ===');
const ksp = result.ksp;
const lines = ksp.split('\n');
const hasOnInit = lines.some(l => l.trim() === 'on init');
const hasEndOn = lines.some(l => l.trim() === 'end on');
const hasSetScriptTitle = ksp.includes('set_script_title');
const hasVolumeKnob = ksp.includes('declare ui_knob $Volume');
const hasUiControl = ksp.includes('on ui_control');

// MUST NOT have zone mapping
const noGetZoneId = !ksp.includes('get_zone_id');
const noSetZonePar = !ksp.includes('set_zone_par');
const noZoneParRootKey = !ksp.includes('ZONE_PAR_ROOT_KEY');
const noEffectsChain = !ksp.includes('EFFECT_TYPE_FILTER') && !ksp.includes('EFFECT_TYPE_REVERB');

// MUST have correct knob ranges
const hasVolumeRange = ksp.includes('$Volume (0, 100, 1)');
const hasVolumeScaling = ksp.includes('$Volume * 6300');

console.log('Has on init:', hasOnInit);
console.log('Has end on:', hasEndOn);
console.log('Has set_script_title:', hasSetScriptTitle);
console.log('Has Volume knob:', hasVolumeKnob);
console.log('Has ui_control handlers:', hasUiControl);
console.log('No get_zone_id:', noGetZoneId);
console.log('No set_zone_par:', noSetZonePar);
console.log('No ZONE_PAR_ROOT_KEY:', noZoneParRootKey);
console.log('No effects chain:', noEffectsChain);
console.log('Has Volume 0-100 range:', hasVolumeRange);
console.log('Has Volume * 6300 scaling:', hasVolumeScaling);

const allPass = hasOnInit && hasEndOn && hasSetScriptTitle && hasVolumeKnob &&
  hasUiControl && noGetZoneId && noSetZonePar && noZoneParRootKey &&
  noEffectsChain && hasVolumeRange && hasVolumeScaling;

if (!allPass) {
  console.error('\nFAIL: KSP structure verification failed');
  process.exit(1);
}

console.log('\n========================================');
console.log('ALL TESTS PASSED');
console.log('========================================');
