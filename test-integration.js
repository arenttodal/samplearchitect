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

// ── Test 6: KSP Generation ──
console.log('\\n=== Test 6: KSP Generation ===');
var ksp = generateKSP(samples, stats, templateConfig);
console.log('KSP script length:', ksp.length, 'chars');
console.log('Contains on init:', ksp.indexOf('on init') > -1);
console.log('Contains end on:', ksp.indexOf('end on') > -1);
console.log('Contains zone mapping:', ksp.indexOf('ZONE_PAR_ROOT_KEY') > -1);
console.log('Contains C3 root key (60):', ksp.indexOf('ZONE_PAR_ROOT_KEY, 60') > -1);
console.log('Contains E3 root key (64):', ksp.indexOf('ZONE_PAR_ROOT_KEY, 64') > -1);
console.log('Contains G3 root key (67):', ksp.indexOf('ZONE_PAR_ROOT_KEY, 67') > -1);

// Return KSP for file writing
var result = { ksp: ksp, stats: stats };
result;
`;

const result = vm.runInContext(testCode, context);

// Write KSP to test-output
const outputDir = path.join(__dirname, 'test-output');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'Test.ksp'), result.ksp);
console.log('\nKSP written to test-output/Test.ksp');

// ── Test 7: Verify KSP structure ──
console.log('\n=== Test 7: KSP Structure Verification ===');
const ksp = result.ksp;
const lines = ksp.split('\n');
const hasOnInit = lines.some(l => l.trim() === 'on init');
const hasEndOn = lines.some(l => l.trim() === 'end on');
const hasSetScriptTitle = ksp.includes('set_script_title');
const hasWhileLoop = ksp.includes('while ($i < $num_zones)');
const hasVolumeKnob = ksp.includes('declare ui_knob $Volume');
const hasZoneMapping = ksp.includes('ZONE_PAR_ROOT_KEY, 60') && ksp.includes('ZONE_PAR_ROOT_KEY, 64') && ksp.includes('ZONE_PAR_ROOT_KEY, 67');

console.log('Has on init:', hasOnInit);
console.log('Has end on:', hasEndOn);
console.log('Has set_script_title:', hasSetScriptTitle);
console.log('Has zone mapping loop:', hasWhileLoop);
console.log('Has Volume knob:', hasVolumeKnob);
console.log('Has all 3 zone mappings:', hasZoneMapping);

if (!hasOnInit || !hasEndOn || !hasSetScriptTitle || !hasWhileLoop || !hasZoneMapping) {
  console.error('FAIL: KSP structure invalid');
  process.exit(1);
}

console.log('\n========================================');
console.log('ALL TESTS PASSED');
console.log('========================================');
