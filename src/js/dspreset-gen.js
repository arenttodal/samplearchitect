/* dspreset-gen.js — Decent Sampler .dspreset XML generator */
/* Generates a complete .dspreset file from sample map + template config. */
/* Sample paths are relative to the .dspreset file location. */
/* Colors use AARRGGBB hex format (alpha first). */

/* Ranges follow the DS binding reference (Appendix B of the DS developer guide):
   AMP_VOLUME 0-16, PAN -100..100, GLOBAL_TUNING -36..36 semitones,
   ENV_ATTACK 0-10 s, ENV_RELEASE 0-25 s, FX_FILTER_FREQUENCY 0-22000 Hz,
   FX_FILTER_RESONANCE 0-5, FX_REVERB_WET_LEVEL 0-1.
   `effect` names the effect a binding targets; its position is computed from
   the effects actually written, so knobs never point at the wrong effect. */
var DS_CONTROL_BINDINGS = {
  volume:    { label: 'VOLUME',  param: 'AMP_VOLUME',          type: 'amp',    min: 0,    max: 1,   def: 0.75  },
  pan:       { label: 'PAN',     param: 'PAN',                 type: 'amp',    min: -100, max: 100, def: 0     },
  attack:    { label: 'ATTACK',  param: 'ENV_ATTACK',          type: 'amp',    min: 0,    max: 4,   def: 0.001 },
  release:   { label: 'RELEASE', param: 'ENV_RELEASE',         type: 'amp',    min: 0,    max: 10,  def: 0.5   },
  tune:      { label: 'TUNE',    param: 'GLOBAL_TUNING',       type: 'amp',    min: -24,  max: 24,  def: 0     },
  /* 0-1 knob mapped to Hz through a curve (as in the DS boilerplate preset) */
  cutoff:    { label: 'CUTOFF',  param: 'FX_FILTER_FREQUENCY', type: 'effect', min: 0,    max: 1,   def: 1,     effect: 'filter',
               table: '0,33;0.3,150;0.4,450;0.5,1100;0.7,4100;0.9,11000;1.0001,22000' },
  resonance: { label: 'RES',     param: 'FX_FILTER_RESONANCE', type: 'effect', min: 0.1,  max: 5,   def: 0.7,   effect: 'filter' },
  reverb:    { label: 'REVERB',  param: 'FX_REVERB_WET_LEVEL', type: 'effect', min: 0,    max: 1,   def: 0.3,   effect: 'reverb' }
};

var DS_EFFECT_XML = {
  filter: '<effect type="lowpass" frequency="22000" resonance="0.7"/>',
  reverb: '<effect type="reverb" roomSize="0.7" wetLevel="0.3"/>',
  delay:  '<effect type="delay" delayTime="0.25" feedback="0.2" wetLevel="0.2"/>'
};

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateDspreset(samples, stats, config, instrumentName, positions) {
  var mapped = samples.filter(function(s) { return s.parsed; });
  instrumentName = instrumentName || stats.instrument || 'Instrument';

  var enabledControls = getEnabledControls();
  var hasPositions = positions && positions.length > 0;

  // Effects in output order; a binding's position is its index here
  var effectKeys = getEnabledEffects()
    .map(function(e) { return e.key; })
    .filter(function(k) { return DS_EFFECT_XML[k]; });

  // Group samples by articulation, then by round robin
  var artGroups = {};
  var artNames = [];
  mapped.forEach(function(s) {
    var art = s.articulation || 'Default';
    if (!artGroups[art]) { artGroups[art] = {}; artNames.push(art); }
    var rr = s.roundRobin || 1;
    if (!artGroups[art][rr]) artGroups[art][rr] = [];
    artGroups[art][rr].push(s);
  });
  var multiArt = artNames.length > 1;
  function artTag(i) { return 'art' + (i + 1); }

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

  // Articulation selector: each option enables exactly one articulation tag
  if (multiArt) {
    lines.push('');
    lines.push('      <label text="ARTICULATION" x="580" y="44" width="212" height="14"');
    lines.push('             textSize="9" textColor="FF5C5C65" hAlign="right"/>');
    lines.push('      <menu x="580" y="60" width="212" height="26" value="1">');
    artNames.forEach(function(art, i) {
      lines.push('        <option name="' + escapeXml(art) + '">');
      artNames.forEach(function(other, j) {
        lines.push('          <binding type="amp" level="tag" identifier="' + artTag(j) + '" parameter="TAG_ENABLED"');
        lines.push('                   translation="fixed_value" translationValue="' + (i === j ? 'true' : 'false') + '"/>');
      });
      lines.push('        </option>');
    });
    lines.push('      </menu>');
  }

  // Knobs — use builder positions scaled to DS coordinates, or fallback 4×2 grid
  var xPositions = [30, 130, 230, 330];
  var row1Y = 120;
  var row2Y = 230;

  enabledControls.forEach(function(item, index) {
    var binding = DS_CONTROL_BINDINGS[item.key];
    if (!binding) return;
    var position = 0;
    if (binding.effect) {
      position = effectKeys.indexOf(binding.effect);
      if (position < 0) return; // target effect not present
    }

    var x, y;
    var pos = hasPositions && positions.find(function(p) { return p.key === item.key; });
    if (pos) {
      // Scale from 633×500 canvas to 812×375 DS coordinates
      x = Math.round(pos.x * 812 / 633);
      y = Math.round(pos.y * 375 / 500);
    } else {
      var row = Math.floor(index / 4);
      var col = index % 4;
      x = xPositions[col];
      y = row === 0 ? row1Y : row2Y;
    }

    var translation = binding.table
      ? ' translation="table" translationTable="' + binding.table + '"'
      : '';

    lines.push('');
    lines.push('      <labeled-knob x="' + x + '" y="' + y + '" width="80" height="90"');
    lines.push('                    label="' + binding.label + '" textColor="FF9A9AA2" textSize="10"');
    lines.push('                    type="float" minValue="' + binding.min + '" maxValue="' + binding.max + '" value="' + binding.def + '">');
    lines.push('        <binding type="' + binding.type + '" level="instrument" position="' + position + '"');
    lines.push('                 parameter="' + binding.param + '"' + translation + '/>');
    lines.push('      </labeled-knob>');
  });

  lines.push('    </tab>');
  lines.push('  </ui>');
  lines.push('');

  // ── Groups Section ──
  lines.push('  <groups>');

  artNames.forEach(function(artName, artIndex) {
    var rrGroups = artGroups[artName];
    var rrKeys = Object.keys(rrGroups).map(Number).sort(function(a, b) { return a - b; });
    var hasMultipleRR = rrKeys.length > 1;

    rrKeys.forEach(function(rrNum, rrIndex) {
      var groupSamples = rrGroups[rrNum];
      var groupName = artName + (hasMultipleRR ? '_RR' + rrNum : '');

      var groupAttrs = 'name="' + escapeXml(groupName) + '" ampVelTrack="1" attack="0.001" decay="0" sustain="1" release="0.5"';
      if (hasMultipleRR) {
        // Positions are 1..n even if the rr numbers in filenames skip values
        groupAttrs += ' seqMode="round_robin" seqLength="' + rrKeys.length + '" seqPosition="' + (rrIndex + 1) + '"';
      }
      if (multiArt) {
        groupAttrs += ' tags="' + artTag(artIndex) + '"';
        if (artIndex > 0) groupAttrs += ' enabled="false"';
      }

      lines.push('    <group ' + groupAttrs + '>');

      groupSamples.forEach(function(s) {
        var samplePath = 'Samples/' + articulationFolder(s) + '/' + s.filename;
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
  if (effectKeys.length > 0) {
    lines.push('  <effects>');
    effectKeys.forEach(function(key) {
      lines.push('    ' + DS_EFFECT_XML[key]);
    });
    lines.push('  </effects>');
    lines.push('');
  }

  lines.push('</DecentSampler>');
  lines.push('');

  return lines.join('\n');
}
