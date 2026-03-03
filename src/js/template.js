/* template.js — Template configuration state */

var templateConfig = {
  controls: {
    volume:    { label: 'Volume',    enabled: true,  default: 75, kspParam: 'ENGINE_PAR_VOLUME',    min: 0, max: 1000000 },
    pan:       { label: 'Pan',       enabled: true,  default: 50, kspParam: 'ENGINE_PAR_PAN',       min: -1000, max: 1000 },
    attack:    { label: 'Attack',    enabled: true,  default: 10, kspParam: 'ENGINE_PAR_ATTACK',    min: 0, max: 1000000 },
    release:   { label: 'Release',   enabled: true,  default: 35, kspParam: 'ENGINE_PAR_RELEASE',   min: 0, max: 1000000 },
    tune:      { label: 'Tune',      enabled: true,  default: 50, kspParam: 'ENGINE_PAR_TUNE',      min: -36000, max: 36000 },
    cutoff:    { label: 'Cutoff',    enabled: true,  default: 80, kspParam: 'ENGINE_PAR_CUTOFF',    min: 0, max: 1000000 },
    resonance: { label: 'Res',       enabled: true,  default: 20, kspParam: 'ENGINE_PAR_RESONANCE', min: 0, max: 1000000 },
    reverb:    { label: 'Reverb',    enabled: true,  default: 30, kspParam: 'ENGINE_PAR_SEND_EFFECT_0_LEVEL', min: 0, max: 1000000 }
  },
  effects: {
    filter: { label: 'Filter',  description: 'LP / HP / BP',      enabled: true, kspType: 'EFFECT_TYPE_FILTER' },
    eq:     { label: 'EQ',      description: '2-band parametric',  enabled: true, kspType: 'EFFECT_TYPE_PARA_EQ' },
    reverb: { label: 'Reverb',  description: 'Algorithmic',        enabled: true, kspType: 'EFFECT_TYPE_REVERB' },
    delay:  { label: 'Delay',   description: 'Tempo-synced',       enabled: true, kspType: 'EFFECT_TYPE_DELAY' }
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

function scaleDefault(key) {
  var ctrl = templateConfig.controls[key];
  if (!ctrl) return 0;
  var val = ctrl.default;
  if (key === 'pan') {
    // Pan: 0-100 user → -1000..1000 KSP, default 50 = 0
    return Math.round((val / 100) * 2000 - 1000);
  }
  if (key === 'tune') {
    // Tune: 0-100 user → -36000..36000, default 50 = 0
    return Math.round((val / 100) * 72000 - 36000);
  }
  // All others: 0-100 → 0-1000000
  return Math.round((val / 100) * 1000000);
}
