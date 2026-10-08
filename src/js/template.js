/* template.js — Template configuration state */
/* default values are 0-100 percentages for UI knob preview display */

var templateConfig = {
  exportFormats: {
    kontakt:       { label: 'Kontakt 6+',       description: 'KSP script + resource container', enabled: true },
    decentsampler: { label: 'Decent Sampler',    description: 'Free — .dspreset, zero manual steps', enabled: true }
  },
  controls: {
    volume:    { label: 'Volume',  enabled: true, default: 75 },
    pan:       { label: 'Pan',     enabled: true, default: 50 },
    attack:    { label: 'Attack',  enabled: true, default: 0  },
    release:   { label: 'Release', enabled: true, default: 35 },
    tune:      { label: 'Tune',    enabled: true, default: 50 },
    cutoff:    { label: 'Cutoff',  enabled: true, default: 80, requires: 'filter' },
    resonance: { label: 'Res',     enabled: true, default: 20, requires: 'filter' },
    reverb:    { label: 'Reverb',  enabled: true, default: 30, requires: 'reverb' }
  },
  effects: {
    /* EQ is not offered: Kontakt's $EFFECT_TYPE_PARA_EQ is inconsistent across
       versions, so neither generator could honour the toggle. */
    filter: { label: 'Filter',  description: 'Low-pass',          enabled: true  },
    reverb: { label: 'Reverb',  description: 'Algorithmic',       enabled: true  },
    delay:  { label: 'Delay',   description: 'Stereo echo',       enabled: true  }
  }
};

function toggleExportFormat(key) {
  // Don't allow disabling both formats
  var other = key === 'kontakt' ? 'decentsampler' : 'kontakt';
  if (!templateConfig.exportFormats[other].enabled && templateConfig.exportFormats[key].enabled) {
    return false; // Would leave no format enabled
  }
  templateConfig.exportFormats[key].enabled = !templateConfig.exportFormats[key].enabled;
  return true;
}

function getEnabledFormats() {
  var result = [];
  Object.keys(templateConfig.exportFormats).forEach(function(key) {
    if (templateConfig.exportFormats[key].enabled) {
      result.push(key);
    }
  });
  return result;
}

function toggleControl(key) {
  templateConfig.controls[key].enabled = !templateConfig.controls[key].enabled;
}

function toggleEffect(key) {
  templateConfig.effects[key].enabled = !templateConfig.effects[key].enabled;
}

/* A control whose target effect is switched off has nothing to drive. */
function isControlAvailable(key) {
  var req = templateConfig.controls[key].requires;
  return !req || !!(templateConfig.effects[req] && templateConfig.effects[req].enabled);
}

/* Controls that will actually be generated: toggled on and available. */
function getEnabledControls() {
  var result = [];
  Object.keys(templateConfig.controls).forEach(function(key) {
    if (templateConfig.controls[key].enabled && isControlAvailable(key)) {
      result.push({ key: key, config: templateConfig.controls[key] });
    }
  });
  return result;
}

function getEnabledEffects() {
  var result = [];
  Object.keys(templateConfig.effects).forEach(function(key) {
    if (templateConfig.effects[key].enabled) {
      result.push({ key: key, config: templateConfig.effects[key] });
    }
  });
  return result;
}
