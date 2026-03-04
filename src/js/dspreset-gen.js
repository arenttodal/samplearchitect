/* dspreset-gen.js — Decent Sampler .dspreset XML generator */
/* Generates a complete .dspreset file from sample map + template config. */
/* Sample paths are relative to the .dspreset file location. */
/* Colors use AARRGGBB hex format (alpha first). */

var DS_CONTROL_BINDINGS = {
  volume:    { label: 'VOLUME',  param: 'AMP_VOLUME',          type: 'amp',    min: 0,   max: 1,  def: 0.75  },
  pan:       { label: 'PAN',     param: 'PAN',                 type: 'amp',    min: -1,  max: 1,  def: 0     },
  attack:    { label: 'ATTACK',  param: 'ENV_ATTACK',          type: 'amp',    min: 0,   max: 4,  def: 0.001 },
  release:   { label: 'RELEASE', param: 'ENV_RELEASE',         type: 'amp',    min: 0,   max: 10, def: 0.5   },
  tune:      { label: 'TUNE',    param: 'GLOBAL_TUNING',       type: 'amp',    min: -24, max: 24, def: 0     },
  cutoff:    { label: 'CUTOFF',  param: 'FX_FILTER_FREQUENCY', type: 'effect', min: 0,   max: 1,  def: 1.0,  pos: 0 },
  resonance: { label: 'RES',     param: 'FX_FILTER_RESONANCE', type: 'effect', min: 0,   max: 1,  def: 0,    pos: 0 },
  reverb:    { label: 'REVERB',  param: 'FX_REVERB_WET_LEVEL', type: 'effect', min: 0,   max: 1,  def: 0.3,  pos: 1 }
};

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateDspreset(samples, stats, config, instrumentName) {
  var mapped = samples.filter(function(s) { return s.parsed; });
  instrumentName = instrumentName || stats.instrument || 'Instrument';
  var maxRR = stats.maxRoundRobins;

  var enabledControls = getEnabledControls();
  var enabledEffects = getEnabledEffects();

  var lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<DecentSampler minVersion="1.0.0">');
  lines.push('');

  // ── UI Section ──
  lines.push('  <ui width="812" height="375" bgColor="FF0A0A0B" textColor="FF9A9AA2">');
  lines.push('    <tab name="main">');

  // Title labels
  lines.push('      <label text="' + escapeXml(instrumentName) + '" x="20" y="15" width="300" height="30"');
  lines.push('             textSize="24" textColor="FFEDEDF0"/>');
  lines.push('      <label text="SAMPLEARCHITECT" x="600" y="20" width="200" height="16"');
  lines.push('             textSize="10" textColor="FF5C5C65" hAlign="right"/>');

  // Knobs — 4x2 grid, only enabled controls
  var xPositions = [30, 130, 230, 330];
  var row1Y = 120;
  var row2Y = 230;

  enabledControls.forEach(function(item, index) {
    var binding = DS_CONTROL_BINDINGS[item.key];
    if (!binding) return;

    var row = Math.floor(index / 4);
    var col = index % 4;
    var x = xPositions[col];
    var y = row === 0 ? row1Y : row2Y;
    var position = binding.pos != null ? binding.pos : 0;

    lines.push('');
    lines.push('      <labeled-knob x="' + x + '" y="' + y + '" width="80" height="90"');
    lines.push('                    label="' + binding.label + '" textColor="FF9A9AA2" textSize="10"');
    lines.push('                    type="float" minValue="' + binding.min + '" maxValue="' + binding.max + '" value="' + binding.def + '">');
    lines.push('        <binding type="' + binding.type + '" level="instrument" position="' + position + '"');
    lines.push('                 parameter="' + binding.param + '"/>');
    lines.push('      </labeled-knob>');
  });

  lines.push('    </tab>');
  lines.push('  </ui>');
  lines.push('');

  // ── Groups Section ──
  // Group samples by articulation, then by round robin
  var artGroups = {};
  mapped.forEach(function(s) {
    var art = s.articulation || 'Default';
    if (!artGroups[art]) artGroups[art] = {};
    var rr = s.roundRobin || 1;
    if (!artGroups[art][rr]) artGroups[art][rr] = [];
    artGroups[art][rr].push(s);
  });

  lines.push('  <groups>');

  var artNames = Object.keys(artGroups);
  artNames.forEach(function(artName) {
    var rrGroups = artGroups[artName];
    var rrKeys = Object.keys(rrGroups).map(Number).sort(function(a, b) { return a - b; });
    var hasMultipleRR = rrKeys.length > 1;

    rrKeys.forEach(function(rrNum) {
      var groupSamples = rrGroups[rrNum];
      var groupName = artName + (hasMultipleRR ? '_RR' + rrNum : '');

      var groupAttrs = 'name="' + escapeXml(groupName) + '" ampVelTrack="1" attack="0.001" decay="0" sustain="1" release="0.5"';
      if (hasMultipleRR) {
        groupAttrs += ' seqMode="round_robin" seqPosition="' + rrNum + '"';
      }

      lines.push('    <group ' + groupAttrs + '>');

      groupSamples.forEach(function(s) {
        var samplePath = 'Samples/' + (s.articulation || 'Uncategorized') + '/' + s.filename;
        var attrs = 'path="' + escapeXml(samplePath) + '"';
        attrs += ' rootNote="' + s.midiNote + '"';
        attrs += ' loNote="' + (s.lowKey != null ? s.lowKey : s.midiNote) + '"';
        attrs += ' hiNote="' + (s.highKey != null ? s.highKey : s.midiNote) + '"';
        attrs += ' loVel="' + (s.velLow != null ? s.velLow : 0) + '"';
        attrs += ' hiVel="' + (s.velHigh != null ? s.velHigh : 127) + '"';

        lines.push('      <sample ' + attrs + '/>');
      });

      lines.push('    </group>');
    });
  });

  lines.push('  </groups>');
  lines.push('');

  // ── Effects Section ──
  var activeEffects = enabledEffects.filter(function(e) { return e.key !== 'eq'; });
  if (activeEffects.length > 0) {
    lines.push('  <effects>');
    activeEffects.forEach(function(item) {
      if (item.key === 'filter') {
        lines.push('    <effect type="lowpass" frequency="22000" resonance="0"/>');
      } else if (item.key === 'reverb') {
        lines.push('    <effect type="reverb" wetLevel="0.3"/>');
      } else if (item.key === 'delay') {
        lines.push('    <effect type="delay" delayTimeMS="250" wetLevel="0.2"/>');
      }
    });
    lines.push('  </effects>');
    lines.push('');
  }

  lines.push('</DecentSampler>');
  lines.push('');

  return lines.join('\n');
}
