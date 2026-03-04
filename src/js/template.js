/* template.js — Template configuration state */
/* default values are 0-100 percentages for UI knob preview display */

var templateConfig = {
  knobStyle: 'gray',
  controls: {
    volume:    { label: 'Volume',  enabled: true, default: 75 },
    pan:       { label: 'Pan',     enabled: true, default: 50 },
    attack:    { label: 'Attack',  enabled: true, default: 0  },
    release:   { label: 'Release', enabled: true, default: 35 },
    tune:      { label: 'Tune',    enabled: true, default: 50 },
    cutoff:    { label: 'Cutoff',  enabled: true, default: 80 },
    resonance: { label: 'Res',     enabled: true, default: 20 },
    reverb:    { label: 'Reverb',  enabled: true, default: 30 }
  },
  effects: {
    filter: { label: 'Filter',  description: 'LP / HP / BP',     enabled: true  },
    eq:     { label: 'EQ',      description: '2-band parametric', enabled: false },
    reverb: { label: 'Reverb',  description: 'Algorithmic',       enabled: true  },
    delay:  { label: 'Delay',   description: 'Tempo-synced',      enabled: true  }
  }
};

function toggleControl(key) {
  templateConfig.controls[key].enabled = !templateConfig.controls[key].enabled;
}

function toggleEffect(key) {
  templateConfig.effects[key].enabled = !templateConfig.effects[key].enabled;
}

function getEnabledControls() {
  var result = [];
  Object.keys(templateConfig.controls).forEach(function(key) {
    if (templateConfig.controls[key].enabled) {
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
