/* app.js — Main controller, phase routing, state */

// ── App State ──
var state = {
  currentPhase: 1,
  completedPhases: [],
  samples: [],
  selectedSampleIndex: -1,
  instrumentName: 'My Instrument',
  outputPath: null,
  recordingPlan: null,
  layoutBuilder: null,
  previewBuilder: null,
  knobPositions: null,
  uiHeight: null
};

// ── Phase Navigation ──
function goToPhase(phase) {
  if (phase < 1 || phase > 4) return;
  if (phase > 1 && state.completedPhases.indexOf(phase - 1) === -1 && phase !== state.currentPhase) return;

  state.currentPhase = phase;

  // Update phase visibility
  document.querySelectorAll('.phase').forEach(function(el) {
    el.classList.remove('active');
  });
  document.getElementById('phase' + phase).classList.add('active');

  // Update step nav buttons
  document.querySelectorAll('.step-btn').forEach(function(btn) {
    var step = parseInt(btn.dataset.step);
    btn.classList.remove('active', 'completed', 'disabled');
    if (step === phase) {
      btn.classList.add('active');
    } else if (state.completedPhases.indexOf(step) !== -1) {
      btn.classList.add('completed');
    } else if (step > phase && state.completedPhases.indexOf(step - 1) === -1) {
      btn.classList.add('disabled');
    }
  });

  // Phase-specific init
  if (phase === 3) renderPhase3();
  if (phase === 4) renderPhase4();
}

function completePhase(phase) {
  if (state.completedPhases.indexOf(phase) === -1) {
    state.completedPhases.push(phase);
  }
}

// ── Phase 1 Setup ──
function initPhase1() {
  document.getElementById('btnReady').addEventListener('click', function() {
    completePhase(1);
    goToPhase(2);
  });

  document.getElementById('btnDownloadTemplate').addEventListener('click', async function() {
    try {
      var result = await window.__TAURI__.dialog.save({
        title: 'Choose location for template folders',
        defaultPath: 'MySamples'
      });
      if (result) {
        var folders = ['Plucked', 'Strummed', 'Harmonics', 'Sustain'];
        for (var i = 0; i < folders.length; i++) {
          await window.__TAURI__.core.invoke('create_directory', {
            path: result + '/' + folders[i]
          });
        }
        console.log('Template folders created at:', result);
      }
    } catch (err) {
      console.error('Template folder creation failed:', err);
    }
  });
}

// ── Phase 2 Setup ──
function initPhase2() {
  var dropZone = document.getElementById('dropZone');

  // Listen for Tauri file drop events
  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen('tauri://drag-drop', function(event) {
      var paths = event.payload.paths || [];
      if (paths.length > 0) {
        handleFileDrop(paths[0]);
      }
    });
  }

  // Also handle native HTML drag/drop as fallback display
  dropZone.addEventListener('dragover', function(e) {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', function() {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', function(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    // The Tauri event handler above will process the actual file paths
  });
}

async function handleFileDrop(dirPath) {
  try {
    var filePaths = await window.__TAURI__.core.invoke('read_dir_recursive', { path: dirPath });

    state.samples = [];
    filePaths.forEach(function(fp) {
      var filename = fp.split('/').pop().split('\\').pop();
      var parsed = parseFilename(filename, fp);
      state.samples.push(parsed);
    });

    if (state.samples.length === 0) return;

    // Auto-detect instrument name: recording plan > first parsed sample > folder name
    if (state.recordingPlan && state.recordingPlan.instrument) {
      state.instrumentName = state.recordingPlan.instrument;
    } else {
      var firstMatched = state.samples.find(function(s) { return s.parsed; });
      if (firstMatched && firstMatched.instrument) {
        state.instrumentName = firstMatched.instrument;
      } else {
        // Fall back to parent folder name
        var parts = dirPath.replace(/\\/g, '/').replace(/\/$/, '').split('/');
        state.instrumentName = parts[parts.length - 1] || 'My Instrument';
      }
    }
    document.getElementById('projectName').textContent = state.instrumentName + ' Project';

    // Show and populate instrument name field
    var nameBar = document.getElementById('instrumentNameBar');
    nameBar.style.display = '';
    var nameInput = document.getElementById('instrumentNameInput');
    nameInput.value = state.instrumentName;

    // Assign key ranges and velocity ranges
    assignKeyRanges(state.samples);
    assignVelocityRanges(state.samples);

    // Render immediately (no auto-trim — user triggers trim manually)
    renderFileList();
    renderKeyboardView();
    updateValidation();

    // Hide drop zone
    document.getElementById('dropZone').classList.add('hidden');
    document.getElementById('keyboardContainer').style.display = '';

  } catch (err) {
    console.error('File drop handling failed:', err);
  }
}

// ── Per-sample trim (manual) ──
async function trimSingleSample(index) {
  var s = state.samples[index];
  if (!s) return;

  try {
    var trim = await analyzeSampleTrim(s.path);
    if (!trim) return;

    s.trimStart = trim.startTime;
    s.trimEnd = trim.endTime;
    s.trimStartSample = trim.startSample;
    s.trimEndSample = trim.endSample;
    s.silenceRemoved = trim.silenceRemoved;
    s.trimSignificant = trim.significant;
    s.trimApproved = false; // analyzed but not yet approved

    // Select this sample and show trim confirmation in detail panel
    state.selectedSampleIndex = index;
    renderFileList();
    renderTrimConfirm(index);
  } catch (err) {
    console.error('Trim analysis failed for', s.filename, err);
  }
}

function approveTrim(index) {
  var s = state.samples[index];
  if (!s) return;
  s.trimApproved = true;
  renderFileList();
  renderSampleDetail();
}

function rejectTrim(index) {
  var s = state.samples[index];
  if (!s) return;
  s.trimStart = undefined;
  s.trimEnd = undefined;
  s.trimStartSample = undefined;
  s.trimEndSample = undefined;
  s.silenceRemoved = undefined;
  s.trimSignificant = undefined;
  s.trimApproved = false;
  renderFileList();
  renderSampleDetail();
}

function renderTrimConfirm(index) {
  var container = document.getElementById('sampleDetail');
  var s = state.samples[index];
  if (!s || s.silenceRemoved == null) return;

  var removed = s.silenceRemoved.toFixed(2);

  container.innerHTML =
    '<div class="inner-panel">' +
    '<span class="label-lg" style="display:block;margin-bottom:12px;">TRIM PREVIEW</span>' +
    '<div class="trim-preview-info">' +
    '<div class="detail-grid">' +
    '<div class="detail-item"><span class="label">LEADING SILENCE</span><div class="value">' + removed + 's</div></div>' +
    '<div class="detail-item"><span class="label">AUDIO STARTS AT</span><div class="value">' + s.trimStart.toFixed(3) + 's</div></div>' +
    '<div class="detail-item"><span class="label">STATUS</span><div class="value">' + (s.silenceRemoved > 0.01 ? 'Trimmable' : 'Clean') + '</div></div>' +
    '</div>' +
    '</div>' +
    '<div class="detail-actions" style="gap:8px;">' +
    '<button class="btn-secondary" id="btnPreviewOriginal">Original</button>' +
    '<button class="btn-secondary" id="btnPreviewTrimmed">Trimmed</button>' +
    (s.silenceRemoved > 0.01 ?
      '<button class="btn-primary" id="btnApproveTrim">Accept Trim</button>' +
      '<button class="btn-secondary" id="btnRejectTrim">Reject</button>' :
      '<button class="btn-secondary" id="btnRejectTrim">Close</button>') +
    '</div>' +
    '</div>';

  document.getElementById('btnPreviewOriginal').addEventListener('click', function() {
    previewSample(s.path);
  });
  document.getElementById('btnPreviewTrimmed').addEventListener('click', function() {
    previewSample(s.path, s.trimStart, s.trimEnd);
  });
  if (document.getElementById('btnApproveTrim')) {
    document.getElementById('btnApproveTrim').addEventListener('click', function() {
      approveTrim(index);
    });
  }
  document.getElementById('btnRejectTrim').addEventListener('click', function() {
    rejectTrim(index);
  });
}

// ── Accept All Trims (single click, no dialog) ──
async function acceptAllTrims() {
  var btn = document.getElementById('btnAcceptAllTrims');
  btn.textContent = 'Analyzing\u2026';
  btn.disabled = true;

  var accepted = 0;
  for (var i = 0; i < state.samples.length; i++) {
    var s = state.samples[i];

    // Skip already-approved samples
    if (s.trimApproved) continue;

    // Analyze if not yet analyzed
    if (s.trimStart == null) {
      try {
        var trim = await analyzeSampleTrim(s.path);
        if (trim) {
          s.trimStart = trim.startTime;
          s.trimEnd = trim.endTime;
          s.trimStartSample = trim.startSample;
          s.trimEndSample = trim.endSample;
          s.silenceRemoved = trim.silenceRemoved;
          s.trimSignificant = trim.significant;
        }
      } catch (err) {
        console.error('Trim analysis failed for', s.filename, err);
        continue;
      }
    }

    // Approve only if there's actually silence to trim
    if (s.silenceRemoved != null && s.silenceRemoved > 0.01) {
      s.trimApproved = true;
      accepted++;
    }
  }

  btn.textContent = 'Accept All Trims';
  btn.disabled = false;
  renderFileList();
  console.log('Accept All Trims: ' + accepted + ' samples approved');
}

function rejectAllTrims() {
  var rejected = 0;
  for (var i = 0; i < state.samples.length; i++) {
    var s = state.samples[i];
    if (s.trimApproved || s.trimStart != null) {
      s.trimStart = undefined;
      s.trimEnd = undefined;
      s.trimStartSample = undefined;
      s.trimEndSample = undefined;
      s.silenceRemoved = undefined;
      s.trimSignificant = undefined;
      s.trimApproved = false;
      rejected++;
    }
  }
  renderFileList();
  renderSampleDetail();
  console.log('Reject All Trims: ' + rejected + ' samples reset');
}

function renderFileList() {
  var scroll = document.getElementById('fileListScroll');
  scroll.innerHTML = '';

  var matched = state.samples.filter(function(s) { return s.parsed; }).length;
  var unmatched = state.samples.length - matched;

  // Badges
  var badges = document.getElementById('fileBadges');
  badges.innerHTML = '';
  if (matched > 0) {
    var b = document.createElement('span');
    b.className = 'badge ok';
    b.textContent = matched + ' matched';
    badges.appendChild(b);
  }
  if (unmatched > 0) {
    var b2 = document.createElement('span');
    b2.className = 'badge warn';
    b2.textContent = unmatched + ' unmatched';
    badges.appendChild(b2);
  }

  // File rows
  state.samples.forEach(function(sample, index) {
    var row = document.createElement('div');
    row.className = 'file-row';
    if (index === state.selectedSampleIndex) row.classList.add('selected');

    // Dot color: green if parsed (and trim approved or no trim needed), amber otherwise
    var dot = document.createElement('div');
    if (sample.parsed) {
      dot.className = 'dot ok';
    } else {
      dot.className = 'dot warn';
    }

    var fname = document.createElement('span');
    fname.className = 'filename';
    fname.textContent = sample.filename;

    row.appendChild(dot);
    row.appendChild(fname);

    // Show trim status tag if trim was analyzed
    if (sample.trimApproved && sample.silenceRemoved > 0.01) {
      var trimTag = document.createElement('span');
      trimTag.className = 'trim-tag approved';
      trimTag.textContent = '\u2212' + sample.silenceRemoved.toFixed(1) + 's';
      row.appendChild(trimTag);
    }

    // Per-sample Trim button
    var trimBtn = document.createElement('button');
    trimBtn.className = 'btn-trim';
    trimBtn.textContent = sample.trimApproved ? '\u2713' : 'Trim';
    if (sample.trimApproved) trimBtn.classList.add('approved');
    trimBtn.addEventListener('click', (function(idx) {
      return function(e) {
        e.stopPropagation();
        trimSingleSample(idx);
      };
    })(index));
    row.appendChild(trimBtn);

    var pitch = document.createElement('span');
    pitch.className = 'pitch-label';
    pitch.textContent = sample.parsed ? formatNoteName(sample.note, sample.accidental, sample.octave) : '?';

    row.appendChild(pitch);

    row.addEventListener('click', function() {
      selectSample(index);
    });

    scroll.appendChild(row);
  });
}

function selectSample(index) {
  state.selectedSampleIndex = index;
  // Re-render file list to update selection highlight
  renderFileList();
  // Render detail panel — wrapped in try/catch to never corrupt file list
  try {
    renderSampleDetail();
  } catch (err) {
    console.error('Error rendering sample detail:', err);
    var container = document.getElementById('sampleDetail');
    if (container) {
      container.innerHTML = '<div class="detail-empty">Error loading sample details</div>';
    }
  }
}

function renderSampleDetail() {
  var container = document.getElementById('sampleDetail');
  var sample = state.samples[state.selectedSampleIndex];

  if (!sample) {
    container.innerHTML = '<div class="detail-empty">Select a sample to view details</div>';
    return;
  }

  if (sample.parsed) {
    var keyRange = (sample.lowKey != null && sample.highKey != null) ? (sample.lowKey + '\u2013' + sample.highKey) : '\u2014';
    var trimInfo = '\u2014';
    if (sample.trimApproved && sample.silenceRemoved > 0.01) {
      trimInfo = '\u2212' + sample.silenceRemoved.toFixed(2) + 's (approved)';
    } else if (sample.silenceRemoved != null && sample.silenceRemoved > 0.01) {
      trimInfo = '\u2212' + sample.silenceRemoved.toFixed(2) + 's (pending)';
    } else if (sample.silenceRemoved != null) {
      trimInfo = 'Clean';
    }
    container.innerHTML =
      '<div class="inner-panel">' +
      '<div class="detail-grid">' +
      '<div class="detail-item"><span class="label">NOTE</span><div class="value">' + formatNoteName(sample.note, sample.accidental, sample.octave) + '</div></div>' +
      '<div class="detail-item"><span class="label">MIDI</span><div class="value">' + (sample.midiNote != null ? sample.midiNote : '\u2014') + '</div></div>' +
      '<div class="detail-item"><span class="label">VELOCITY</span><div class="value">' + (sample.velocityLayer || '\u2014') + '</div></div>' +
      '<div class="detail-item"><span class="label">ARTICULATION</span><div class="value">' + (sample.articulation || '\u2014') + '</div></div>' +
      '<div class="detail-item"><span class="label">ROUND ROBIN</span><div class="value">' + (sample.roundRobin || '\u2014') + '</div></div>' +
      '<div class="detail-item"><span class="label">KEY RANGE</span><div class="value">' + keyRange + '</div></div>' +
      '<div class="detail-item"><span class="label">TRIM</span><div class="value">' + trimInfo + '</div></div>' +
      '</div>' +
      '<div class="detail-actions">' +
      '<button class="btn-secondary" id="btnPreview">Preview</button>' +
      '</div>' +
      '</div>';

    document.getElementById('btnPreview').addEventListener('click', function() {
      // Only use trim points for preview if trim was approved
      if (sample.trimApproved) {
        previewSample(sample.path, sample.trimStart, sample.trimEnd);
      } else {
        previewSample(sample.path);
      }
    });
  } else {
    // Unmatched: show assignment form
    container.innerHTML =
      '<div class="inner-panel">' +
      '<span class="label-lg" style="display:block;margin-bottom:12px;">MANUAL ASSIGNMENT</span>' +
      '<div class="assign-form">' +
      '<div class="form-group"><label>Note</label><select id="assignNote">' +
      '<option>C</option><option>D</option><option>E</option><option>F</option><option>G</option><option>A</option><option>B</option>' +
      '</select></div>' +
      '<div class="form-group"><label>Accidental</label><select id="assignAcc">' +
      '<option value="">Natural</option><option value="s">Sharp</option><option value="b">Flat</option>' +
      '</select></div>' +
      '<div class="form-group"><label>Octave</label><select id="assignOctave">' +
      '<option>0</option><option>1</option><option>2</option><option selected>3</option><option>4</option><option>5</option><option>6</option><option>7</option><option>8</option>' +
      '</select></div>' +
      '<div class="form-group"><label>Velocity</label><select id="assignVel">' +
      '<option>1</option><option>2</option><option>3</option><option>4</option><option>5</option>' +
      '</select></div>' +
      '<div class="form-group"><label>Articulation</label><input type="text" id="assignArt" placeholder="e.g. Plucked"></div>' +
      '<div class="form-group"><label>Round Robin</label><select id="assignRR">' +
      '<option>1</option><option>2</option><option>3</option><option>4</option><option>5</option>' +
      '</select></div>' +
      '</div>' +
      '<div class="detail-actions">' +
      '<button class="btn-primary" id="btnApplyAssign">Apply</button>' +
      '<button class="btn-secondary" id="btnPreviewUnmatched">Preview</button>' +
      '</div>' +
      '</div>';

    document.getElementById('btnApplyAssign').addEventListener('click', function() {
      applyManualAssignment(state.selectedSampleIndex);
    });

    document.getElementById('btnPreviewUnmatched').addEventListener('click', function() {
      if (sample.trimApproved) {
        previewSample(sample.path, sample.trimStart, sample.trimEnd);
      } else {
        previewSample(sample.path);
      }
    });
  }
}

function applyManualAssignment(index) {
  var s = state.samples[index];
  if (!s) return;

  var note = document.getElementById('assignNote').value;
  var acc = document.getElementById('assignAcc').value || null;
  var octave = parseInt(document.getElementById('assignOctave').value);
  var vel = parseInt(document.getElementById('assignVel').value);
  var art = document.getElementById('assignArt').value || 'Default';
  var rr = parseInt(document.getElementById('assignRR').value);

  s.parsed = true;
  s.manualOverride = true;
  s.note = note;
  s.accidental = acc;
  s.octave = octave;
  s.midiNote = calcMidiNote(note, acc, octave);
  s.velocityLayer = vel;
  s.articulation = art;
  s.roundRobin = rr;
  s.instrument = state.instrumentName;

  // Recalculate ranges
  assignKeyRanges(state.samples);
  assignVelocityRanges(state.samples);

  renderFileList();
  renderKeyboardView();
  renderSampleDetail();
  updateValidation();
}

function renderKeyboardView() {
  var container = document.getElementById('keyboardWrap');
  renderKeyboard(container, state.samples, function(midiNote) {
    // Find first sample at this pitch
    var idx = state.samples.findIndex(function(s) { return s.parsed && s.midiNote === midiNote; });
    if (idx >= 0) {
      selectSample(idx);
      // Scroll into view
      var rows = document.querySelectorAll('.file-row');
      if (rows[idx]) rows[idx].scrollIntoView({ block: 'nearest' });
    }
  });
}

function updateValidation() {
  var validation = validateSamples(state.samples);
  var warningEl = document.getElementById('validationWarning');
  var btnNext = document.getElementById('btnToPhase3');

  if (validation.errors.length > 0) {
    warningEl.classList.remove('hidden');
    warningEl.textContent = validation.errors[0];
    btnNext.style.display = 'none';
  } else {
    warningEl.classList.add('hidden');
    btnNext.style.display = '';
  }

  if (validation.warnings.length > 0) {
    warningEl.classList.remove('hidden');
    warningEl.textContent = validation.warnings[0];
    warningEl.style.borderColor = 'rgba(201,147,58,0.15)';
    warningEl.style.background = 'var(--warn-bg)';
    warningEl.style.color = 'var(--warn)';
  }
}

// ── Phase 3 ──
function renderPhase3() {
  var stats = getSampleStats(state.samples);

  // Initialize layout builder if not already created
  if (!state.layoutBuilder) {
    var canvas = document.getElementById('layoutCanvas');
    state.layoutBuilder = new LayoutBuilder(canvas);
  }

  // Update builder state
  state.layoutBuilder.instrumentName = state.instrumentName;
  state.layoutBuilder.sampleCount = stats.totalSamples;
  state.layoutBuilder.updateControls();
  state.layoutBuilder.updateEffects();

  renderControlToggles();
  renderEffectToggles();
  renderFormatToggles();
}

function renderControlToggles() {
  var grid = document.getElementById('controlsGrid');
  grid.innerHTML = '';

  Object.keys(templateConfig.controls).forEach(function(key) {
    var ctrl = templateConfig.controls[key];
    var toggle = document.createElement('div');
    toggle.className = 'control-toggle';

    var checkbox = document.createElement('div');
    checkbox.className = 'toggle-checkbox' + (ctrl.enabled ? ' checked' : '');

    var label = document.createElement('span');
    label.className = 'toggle-label';
    label.textContent = ctrl.label;

    toggle.appendChild(checkbox);
    toggle.appendChild(label);

    toggle.addEventListener('click', function() {
      toggleControl(key);
      checkbox.classList.toggle('checked');
      if (state.layoutBuilder) {
        state.layoutBuilder.updateControls();
      }
    });

    grid.appendChild(toggle);
  });
}

function renderFormatToggles() {
  var panel = document.getElementById('formatPanel');
  panel.innerHTML = '';

  Object.keys(templateConfig.exportFormats).forEach(function(key) {
    var fmt = templateConfig.exportFormats[key];
    var toggle = document.createElement('div');
    toggle.className = 'effect-toggle';

    var checkbox = document.createElement('div');
    checkbox.className = 'toggle-checkbox' + (fmt.enabled ? ' checked' : '');

    var info = document.createElement('div');
    info.className = 'effect-info';
    info.innerHTML = '<div class="effect-name">' + fmt.label + '</div>' +
                     '<div class="effect-desc">' + fmt.description + '</div>';

    toggle.appendChild(checkbox);
    toggle.appendChild(info);

    toggle.addEventListener('click', function() {
      var toggled = toggleExportFormat(key);
      if (toggled) {
        checkbox.classList.toggle('checked');
      }
    });

    panel.appendChild(toggle);
  });
}

function renderEffectToggles() {
  var panel = document.getElementById('effectsPanel');
  panel.innerHTML = '';

  Object.keys(templateConfig.effects).forEach(function(key) {
    var fx = templateConfig.effects[key];
    var toggle = document.createElement('div');
    toggle.className = 'effect-toggle';

    var checkbox = document.createElement('div');
    checkbox.className = 'toggle-checkbox' + (fx.enabled ? ' checked' : '');

    var info = document.createElement('div');
    info.className = 'effect-info';
    info.innerHTML = '<div class="effect-name">' + fx.label + '</div>' +
                     '<div class="effect-desc">' + fx.description + '</div>';

    toggle.appendChild(checkbox);
    toggle.appendChild(info);

    toggle.addEventListener('click', function() {
      toggleEffect(key);
      checkbox.classList.toggle('checked');
      if (state.layoutBuilder) {
        state.layoutBuilder.updateEffects();
      }
    });

    panel.appendChild(toggle);
  });
}

// ── Phase 4 ──
function renderPhase4() {
  var stats = getSampleStats(state.samples);
  var formats = getEnabledFormats();

  // Capture builder positions for export
  if (state.layoutBuilder) {
    state.knobPositions = state.layoutBuilder.getPositions();
    state.uiHeight = state.layoutBuilder.getRequiredHeight();
  }

  // Render read-only preview canvas
  if (!state.previewBuilder) {
    var previewCanvas = document.getElementById('previewCanvas');
    if (previewCanvas) {
      state.previewBuilder = new LayoutBuilder(previewCanvas, { readonly: true });
    }
  }
  if (state.previewBuilder) {
    state.previewBuilder.instrumentName = state.instrumentName;
    state.previewBuilder.sampleCount = stats.totalSamples;
    state.previewBuilder.updateControls();
    state.previewBuilder.updateEffects();
    // Copy positions from layout builder
    if (state.knobPositions) {
      state.previewBuilder.knobs.forEach(function(k) {
        var saved = state.knobPositions.find(function(p) { return p.key === k.key; });
        if (saved) {
          k.x = saved.x;
          k.y = saved.y;
        }
      });
      state.previewBuilder.render();
    }
  }

  var grid = document.getElementById('summaryGrid');
  grid.innerHTML =
    '<div class="summary-cell"><span class="label">INSTRUMENT</span><div class="value">' + state.instrumentName + '</div></div>' +
    '<div class="summary-cell"><span class="label">SAMPLES</span><div class="value">' + stats.totalSamples + '</div></div>' +
    '<div class="summary-cell"><span class="label">ARTICULATIONS</span><div class="value">' + stats.articulationCount + '</div></div>' +
    '<div class="summary-cell"><span class="label">VEL LAYERS</span><div class="value">' + stats.maxVelocityLayers + '</div></div>' +
    '<div class="summary-cell"><span class="label">ROUND ROBINS</span><div class="value">' + stats.maxRoundRobins + '</div></div>' +
    '<div class="summary-cell"><span class="label">TEMPLATE</span><div class="value">Chromatic</div></div>';

  // Render output formats
  var outputEl = document.getElementById('outputFormats');
  var html = '';
  if (formats.indexOf('kontakt') !== -1) {
    html += '<div class="output-row">' +
      '<div class="output-info"><span class="output-format">Kontakt 6+</span>' +
      '<span class="output-desc">KSP script + resource container</span></div>' +
      '<span class="output-badge">.txt</span></div>';
  }
  if (formats.indexOf('decentsampler') !== -1) {
    if (html) html += '<div style="border-top:1px solid var(--divider);margin:10px 0;"></div>';
    html += '<div class="output-row">' +
      '<div class="output-info"><span class="output-format">Decent Sampler</span>' +
      '<span class="output-desc">Ready-to-play .dspreset \u2014 zero manual steps</span></div>' +
      '<span class="output-badge">.dspreset</span></div>';
  }
  outputEl.innerHTML = html;
}

async function doBuild() {
  try {
    var result = await window.__TAURI__.dialog.save({
      title: 'Choose output directory',
      defaultPath: state.instrumentName + '_SampleArchitect'
    });

    if (!result) return;

    var stats = getSampleStats(state.samples);
    // Override instrument name with user-editable field
    stats.instrument = state.instrumentName;

    // Show progress
    var btn = document.getElementById('btnBuild');
    btn.style.display = 'none';
    var progress = document.getElementById('progressContainer');
    progress.classList.add('visible');

    var exportResult = await exportInstrument(state.samples, stats, templateConfig, result, function(stageIdx, label) {
      var pct = ((stageIdx + 1) / 8) * 100;
      document.getElementById('progressFill').style.width = pct + '%';
      document.getElementById('progressLabel').textContent = label;
    });

    state.outputPath = exportResult;

    // Show completion
    progress.classList.remove('visible');
    document.getElementById('completion').classList.add('visible');

  } catch (err) {
    console.error('Build failed:', err);
    document.getElementById('progressLabel').textContent = 'Build failed: ' + err;
  }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', function() {
  // Step nav clicks
  document.querySelectorAll('.step-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var step = parseInt(btn.dataset.step);
      goToPhase(step);
    });
  });

  // Settings modal
  document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
  document.getElementById('settingsClose').addEventListener('click', closeSettingsModal);
  document.getElementById('settingsCancelBtn').addEventListener('click', closeSettingsModal);
  document.getElementById('settingsSaveBtn').addEventListener('click', saveSettings);
  document.getElementById('settingsToggleKey').addEventListener('click', toggleApiKeyVisibility);
  document.getElementById('settingsTestKey').addEventListener('click', testApiKey);

  // Phase 1 chat
  document.getElementById('btnChatSend').addEventListener('click', function() {
    var input = document.getElementById('chatInput');
    var msg = input.value.trim();
    if (msg) {
      input.value = '';
      sendChatMessage(msg);
    }
  });
  document.getElementById('chatInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('btnChatSend').click();
    }
  });

  // Phase 1 Quick Start button
  document.getElementById('btnQuickStart').addEventListener('click', function() {
    skipToImport();
  });

  // Phase 1 — decide layout based on API key
  updatePhase1Layout();
  renderChatMessages();

  // Phase 1
  initPhase1();

  // Phase 2
  initPhase2();

  // Phase 2 instrument name input
  document.getElementById('instrumentNameInput').addEventListener('input', function() {
    state.instrumentName = this.value || 'My Instrument';
    document.getElementById('projectName').textContent = state.instrumentName + ' Project';
  });

  // Phase 2 Accept All / Reject All Trims
  document.getElementById('btnAcceptAllTrims').addEventListener('click', function() {
    if (state.samples.length > 0) acceptAllTrims();
  });
  document.getElementById('btnRejectAllTrims').addEventListener('click', function() {
    if (state.samples.length > 0) rejectAllTrims();
  });

  // Phase 2 → Phase 3 button
  document.getElementById('btnToPhase3').addEventListener('click', function() {
    completePhase(2);
    goToPhase(3);
  });

  // Phase 3 Auto Layout button
  document.getElementById('btnAutoLayout').addEventListener('click', function() {
    if (state.layoutBuilder) {
      state.layoutBuilder.autoLayout();
    }
  });

  // Phase 3 → Phase 4 button
  document.getElementById('btnToPhase4').addEventListener('click', function() {
    // Capture positions before leaving Phase 3
    if (state.layoutBuilder) {
      state.knobPositions = state.layoutBuilder.getPositions();
      state.uiHeight = state.layoutBuilder.getRequiredHeight();
    }
    completePhase(3);
    goToPhase(4);
  });

  // Phase 4 build
  document.getElementById('btnBuild').addEventListener('click', function() {
    doBuild();
  });

  // Phase 4 copy script to clipboard
  document.getElementById('btnCopyScript').addEventListener('click', function() {
    var btn = document.getElementById('btnCopyScript');
    if (lastGeneratedKSP) {
      navigator.clipboard.writeText(lastGeneratedKSP).then(function() {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function() {
          btn.textContent = 'Copy Script to Clipboard';
          btn.classList.remove('copied');
        }, 2000);
      }).catch(function(err) {
        console.error('Clipboard copy failed:', err);
        btn.textContent = 'Copy failed';
      });
    } else {
      btn.textContent = 'No KSP generated';
      setTimeout(function() {
        btn.textContent = 'Copy Script to Clipboard';
      }, 2000);
    }
  });

  // Phase 4 open folder
  document.getElementById('btnOpenFolder').addEventListener('click', function() {
    if (state.outputPath && window.__TAURI__ && window.__TAURI__.shell) {
      window.__TAURI__.shell.open(state.outputPath);
    }
  });

  // Phase 4 view guide
  document.getElementById('btnViewGuide').addEventListener('click', function() {
    if (state.outputPath && window.__TAURI__ && window.__TAURI__.shell) {
      window.__TAURI__.shell.open(state.outputPath + '/Setup Guide.txt');
    }
  });

  // Initialize MIDI support
  initMIDI();

  // Set initial phase
  goToPhase(1);
});
