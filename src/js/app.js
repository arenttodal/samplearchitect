/* app.js — Main controller, phase routing, state */

// ── App State ──
var state = {
  currentPhase: 1,
  completedPhases: [],
  samples: [],
  selectedSampleIndex: -1,
  editingSampleIndex: -1,
  instrumentName: 'My Instrument',
  outputPath: null,
  recordingPlan: null,
  layoutBuilder: null,
  previewBuilder: null,
  knobPositions: null,
  uiHeight: null,
  importing: false,
  building: false
};

// ── Small UI helpers ──
function setStatus(el, text, kind) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  el.textContent = text || '';
  el.className = 'status-msg' + (kind ? ' ' + kind : '');
}

function errText(err) {
  return String(err && err.message ? err.message : err);
}

/* Make a div behave as an accessible checkbox */
function makeCheckable(el, checked, onToggle) {
  el.setAttribute('role', 'checkbox');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-checked', checked ? 'true' : 'false');
  el.addEventListener('click', onToggle);
  el.addEventListener('keydown', function(e) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onToggle();
    }
  });
}

// ── Phase Navigation ──
function goToPhase(phase) {
  if (phase < 1 || phase > 4) return;
  if (state.building) return; // the build owns the screen until it finishes
  if (phase > 1 && state.completedPhases.indexOf(phase - 1) === -1 && phase !== state.currentPhase) return;

  state.currentPhase = phase;

  // Update phase visibility
  document.querySelectorAll('.phase').forEach(function(el) {
    el.classList.remove('active');
  });
  document.getElementById('phase' + phase).classList.add('active');

  renderStepNav();

  // Phase-specific init
  if (phase === 3) renderPhase3();
  if (phase === 4) renderPhase4();
}

function renderStepNav() {
  var phase = state.currentPhase;
  document.querySelectorAll('.step-btn').forEach(function(btn) {
    var step = parseInt(btn.dataset.step);
    btn.classList.remove('active', 'completed', 'disabled');
    var reachable = step === 1 || step === phase || state.completedPhases.indexOf(step - 1) !== -1;
    if (step === phase) {
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'step');
    } else {
      btn.removeAttribute('aria-current');
      if (state.completedPhases.indexOf(step) !== -1) btn.classList.add('completed');
      if (!reachable) btn.classList.add('disabled');
    }
    btn.disabled = !reachable;
  });
}

function completePhase(phase) {
  if (state.completedPhases.indexOf(phase) === -1) {
    state.completedPhases.push(phase);
  }
}

/* Later steps must be revisited when earlier input becomes invalid */
function uncompleteFrom(phase) {
  state.completedPhases = state.completedPhases.filter(function(p) { return p < phase; });
  renderStepNav();
}

// ── Phase 1 Setup ──
function initPhase1() {
  document.getElementById('btnReady').addEventListener('click', function() {
    completePhase(1);
    goToPhase(2);
  });

  document.getElementById('btnDownloadTemplate').addEventListener('click', async function() {
    var status = document.getElementById('templateStatus');
    try {
      var result = await window.__TAURI__.dialog.save({
        title: 'Choose location for template folders',
        defaultPath: 'MySamples'
      });
      if (!result) return;
      var folders = ['Plucked', 'Strummed', 'Harmonics', 'Sustain'];
      for (var i = 0; i < folders.length; i++) {
        await window.__TAURI__.core.invoke('create_directory', {
          path: result + '/' + folders[i]
        });
      }
      setStatus(status, 'Template folders created in ' + result, 'ok');
    } catch (err) {
      console.error('Template folder creation failed:', err);
      setStatus(status, 'Could not create the folders: ' + errText(err), 'error');
    }
  });
}

// ── Phase 2 Setup ──
function initPhase2() {
  var dropZone = document.getElementById('dropZone');

  // Tauri delivers dropped paths through this event, wherever the drop lands.
  // Only Phase 2 imports; elsewhere a drop would silently replace the samples.
  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen('tauri://drag-drop', function(event) {
      dropZone.classList.remove('drag-over');
      var paths = (event.payload && event.payload.paths) || [];
      if (paths.length === 0 || state.currentPhase !== 2) return;
      handleFileDrop(paths[0]);
    });
    window.__TAURI__.event.listen('tauri://drag-enter', function() {
      if (state.currentPhase === 2) dropZone.classList.add('drag-over');
    });
    window.__TAURI__.event.listen('tauri://drag-leave', function() {
      dropZone.classList.remove('drag-over');
    });
  }

  // Native HTML drag/drop only drives the hover style
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
  });

  document.getElementById('btnChooseFolder').addEventListener('click', chooseFolder);
}

async function chooseFolder() {
  try {
    var dir = await window.__TAURI__.dialog.open({
      title: 'Choose your sample folder',
      directory: true,
      multiple: false
    });
    if (dir) handleFileDrop(Array.isArray(dir) ? dir[0] : dir);
  } catch (err) {
    setStatus('importStatus', 'Could not open the folder picker: ' + errText(err), 'error');
  }
}

async function handleFileDrop(dirPath) {
  if (state.importing) return;
  state.importing = true;
  setStatus('importStatus', 'Reading ' + dirPath + '…');

  try {
    var filePaths = await window.__TAURI__.core.invoke('read_dir_recursive', { path: dirPath });

    if (filePaths.length === 0) {
      setStatus('importStatus',
        'No .wav files found in ' + dirPath + '. Drop the folder that contains your samples (subfolders are included).',
        'error');
      return;
    }

    var samples = filePaths.map(function(fp) {
      var filename = fp.split('/').pop().split('\\').pop();
      return parseFilename(filename, fp);
    });
    samples.sort(function(a, b) { return a.path.localeCompare(b.path); });

    // Read headers so unreadable files and mixed sample rates are caught now,
    // not when a sampler refuses the export.
    for (var i = 0; i < samples.length; i++) {
      try {
        samples[i].wavInfo = await window.__TAURI__.core.invoke('read_wav_info', { path: samples[i].path });
      } catch (err) {
        samples[i].unreadable = errText(err);
        samples[i].parsed = false;
      }
    }

    state.samples = samples;
    state.selectedSampleIndex = -1;
    state.editingSampleIndex = -1;
    uncompleteFrom(2);

    // Auto-detect instrument name: recording plan > first parsed sample > folder name
    if (state.recordingPlan && state.recordingPlan.instrument && state.recordingPlan.instrument !== 'My Instrument') {
      state.instrumentName = state.recordingPlan.instrument;
    } else {
      var firstMatched = state.samples.find(function(s) { return s.parsed; });
      if (firstMatched && firstMatched.instrument) {
        state.instrumentName = firstMatched.instrument;
      } else {
        var parts = dirPath.replace(/\\/g, '/').replace(/\/$/, '').split('/');
        state.instrumentName = parts[parts.length - 1] || 'My Instrument';
      }
    }
    document.getElementById('projectName').textContent = state.instrumentName + ' Project';

    document.getElementById('instrumentNameBar').style.display = '';
    document.getElementById('instrumentNameInput').value = state.instrumentName;

    assignKeyRanges(state.samples);
    assignVelocityRanges(state.samples);

    renderFileList();
    renderKeyboardView();
    renderSampleDetail();
    updateValidation();

    // Collapse the drop zone; the folder button stays available for re-import
    document.getElementById('dropZone').classList.add('compact');
    document.getElementById('keyboardContainer').style.display = '';
    setStatus('importStatus', 'Imported ' + samples.length + ' file' + (samples.length === 1 ? '' : 's') + ' from ' + dirPath, 'ok');
  } catch (err) {
    console.error('File drop handling failed:', err);
    setStatus('importStatus', 'Could not read ' + dirPath + ': ' + errText(err), 'error');
  } finally {
    state.importing = false;
  }
}

// ── Per-sample trim (manual) ──
async function trimSingleSample(index) {
  var s = state.samples[index];
  if (!s || s.unreadable) return;

  var trim = await analyzeSampleTrim(s.path);
  if (!trim) {
    setStatus('importStatus', 'Could not analyze ' + s.filename + ' for silence', 'error');
    return;
  }
  applyTrimAnalysis(s, trim);
  s.trimApproved = false; // analyzed but not yet approved

  // Select this sample and show trim confirmation in detail panel
  state.selectedSampleIndex = index;
  renderFileList();
  renderTrimConfirm(index);
}

function applyTrimAnalysis(s, trim) {
  s.trimStart = trim.startTime;
  s.trimEnd = trim.endTime;
  s.trimStartSample = trim.startSample;
  s.trimEndSample = trim.endSample;
  s.silenceRemoved = trim.silenceRemoved;
  s.trimSignificant = trim.significant;
}

function clearTrim(s) {
  s.trimStart = undefined;
  s.trimEnd = undefined;
  s.trimStartSample = undefined;
  s.trimEndSample = undefined;
  s.silenceRemoved = undefined;
  s.trimSignificant = undefined;
  s.trimApproved = false;
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
  clearTrim(s);
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
    '<span class="label-lg" style="display:block;margin-bottom:12px;">TRIM PREVIEW — ' + escapeHtml(s.filename) + '</span>' +
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
  btn.textContent = 'Analyzing…';
  btn.disabled = true;

  var accepted = 0;
  var failedNames = [];
  try {
    for (var i = 0; i < state.samples.length; i++) {
      var s = state.samples[i];
      if (s.trimApproved || s.unreadable) continue;

      if (s.trimStart == null) {
        var trim = await analyzeSampleTrim(s.path);
        if (!trim) {
          failedNames.push(s.filename);
          continue;
        }
        applyTrimAnalysis(s, trim);
      }

      // Approve only if there's actually silence to trim
      if (s.silenceRemoved != null && s.silenceRemoved > 0.01) {
        s.trimApproved = true;
        accepted++;
      }
    }
  } finally {
    btn.textContent = 'Accept All Trims';
    btn.disabled = false;
  }
  renderFileList();
  renderSampleDetail();
  if (failedNames.length > 0) {
    setStatus('importStatus', 'Could not analyze: ' + failedNames.join(', '), 'error');
  } else {
    setStatus('importStatus', accepted === 0
      ? 'No leading silence to trim'
      : 'Trimmed leading silence on ' + accepted + ' sample' + (accepted === 1 ? '' : 's'), 'ok');
  }
}

function rejectAllTrims() {
  state.samples.forEach(clearTrim);
  renderFileList();
  renderSampleDetail();
  setStatus('importStatus', 'All trims removed', 'ok');
}

function renderFileList() {
  var scroll = document.getElementById('fileListScroll');
  scroll.innerHTML = '';

  var matched = state.samples.filter(function(s) { return s.parsed; }).length;
  var unreadable = state.samples.filter(function(s) { return s.unreadable; }).length;
  var unmatched = state.samples.length - matched - unreadable;

  // Badges
  var badges = document.getElementById('fileBadges');
  badges.innerHTML = '';
  function badge(cls, text) {
    var b = document.createElement('span');
    b.className = 'badge ' + cls;
    b.textContent = text;
    badges.appendChild(b);
  }
  if (matched > 0) badge('ok', matched + ' matched');
  if (unmatched > 0) badge('warn', unmatched + ' unmatched');
  if (unreadable > 0) badge('warn', unreadable + ' unreadable');

  document.getElementById('fileListToolbar').style.display = state.samples.length > 0 ? '' : 'none';

  if (state.samples.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'detail-empty';
    empty.textContent = 'No samples yet';
    scroll.appendChild(empty);
    return;
  }

  state.samples.forEach(function(sample, index) {
    var row = document.createElement('div');
    row.className = 'file-row';
    row.setAttribute('role', 'option');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-selected', index === state.selectedSampleIndex ? 'true' : 'false');
    row.title = sample.unreadable ? sample.filename + ' — ' + sample.unreadable : sample.filename;
    if (index === state.selectedSampleIndex) row.classList.add('selected');
    if (sample.unreadable) row.classList.add('unreadable');

    var dot = document.createElement('div');
    dot.className = sample.parsed ? 'dot ok' : 'dot warn';

    var fname = document.createElement('span');
    fname.className = 'filename';
    fname.textContent = sample.filename;

    row.appendChild(dot);
    row.appendChild(fname);

    if (sample.trimApproved && sample.silenceRemoved > 0.01) {
      var trimTag = document.createElement('span');
      trimTag.className = 'trim-tag approved';
      trimTag.textContent = '−' + sample.silenceRemoved.toFixed(1) + 's';
      row.appendChild(trimTag);
    }

    if (!sample.unreadable) {
      var trimBtn = document.createElement('button');
      trimBtn.className = 'btn-trim';
      trimBtn.textContent = sample.trimApproved ? '✓' : 'Trim';
      trimBtn.title = 'Detect and remove leading silence';
      if (sample.trimApproved) trimBtn.classList.add('approved');
      trimBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        trimSingleSample(index);
      });
      row.appendChild(trimBtn);
    }

    var pitch = document.createElement('span');
    pitch.className = 'pitch-label';
    pitch.textContent = sample.parsed ? formatNoteName(sample.note, sample.accidental, sample.octave) : (sample.unreadable ? '✕' : '?');
    row.appendChild(pitch);

    row.addEventListener('click', function() {
      selectSample(index);
    });
    row.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectSample(index);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var next = index + (e.key === 'ArrowDown' ? 1 : -1);
        if (next >= 0 && next < state.samples.length) {
          selectSample(next);
          var rows = document.querySelectorAll('.file-row');
          if (rows[next]) rows[next].focus();
        }
      }
    });

    scroll.appendChild(row);
  });
}

function selectSample(index) {
  state.selectedSampleIndex = index;
  state.editingSampleIndex = -1;
  renderFileList();
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

function formatWavInfo(info) {
  if (!info) return '—';
  return (info.sample_rate / 1000) + ' kHz · ' + info.bits_per_sample + '-bit · ' +
    (info.channels === 1 ? 'mono' : info.channels === 2 ? 'stereo' : info.channels + ' ch') +
    ' · ' + info.duration_secs.toFixed(2) + 's';
}

function renderSampleDetail() {
  var container = document.getElementById('sampleDetail');
  var sample = state.samples[state.selectedSampleIndex];

  if (!sample) {
    container.innerHTML = '<div class="detail-empty">' +
      (state.samples.length ? 'Select a sample to view details' : 'Import a folder to see your samples here') +
      '</div>';
    return;
  }

  if (sample.unreadable) {
    container.innerHTML =
      '<div class="inner-panel">' +
      '<span class="label-lg" style="display:block;margin-bottom:12px;">' + escapeHtml(sample.filename) + '</span>' +
      '<p class="detail-note error">This file can’t be read as a WAV file and will be left out of the export.</p>' +
      '<p class="detail-note">' + escapeHtml(sample.unreadable) + '</p>' +
      '</div>';
    return;
  }

  if (sample.parsed && state.editingSampleIndex !== state.selectedSampleIndex) {
    var keyRange = (sample.lowKey != null && sample.highKey != null)
      ? midiToNoteName(sample.lowKey) + '–' + midiToNoteName(sample.highKey)
      : '—';
    var velRange = (sample.velLow != null) ? sample.velLow + '–' + sample.velHigh : '—';
    var trimInfo = '—';
    if (sample.trimApproved && sample.silenceRemoved > 0.01) {
      trimInfo = '−' + sample.silenceRemoved.toFixed(2) + 's (approved)';
    } else if (sample.silenceRemoved != null && sample.silenceRemoved > 0.01) {
      trimInfo = '−' + sample.silenceRemoved.toFixed(2) + 's (pending)';
    } else if (sample.silenceRemoved != null) {
      trimInfo = 'Clean';
    }
    container.innerHTML =
      '<div class="inner-panel">' +
      '<span class="label-lg detail-title">' + escapeHtml(sample.filename) + (sample.manualOverride ? ' · MANUAL' : '') + '</span>' +
      '<div class="detail-grid">' +
      '<div class="detail-item"><span class="label">NOTE</span><div class="value">' + formatNoteName(sample.note, sample.accidental, sample.octave) + '</div></div>' +
      '<div class="detail-item"><span class="label">MIDI</span><div class="value">' + sample.midiNote + '</div></div>' +
      '<div class="detail-item"><span class="label">VELOCITY</span><div class="value">v' + sample.velocityLayer + ' (' + velRange + ')</div></div>' +
      '<div class="detail-item"><span class="label">ARTICULATION</span><div class="value">' + escapeHtml(sample.articulation || '—') + '</div></div>' +
      '<div class="detail-item"><span class="label">ROUND ROBIN</span><div class="value">' + sample.roundRobin + '</div></div>' +
      '<div class="detail-item"><span class="label">KEY RANGE</span><div class="value">' + keyRange + '</div></div>' +
      '<div class="detail-item"><span class="label">TRIM</span><div class="value">' + trimInfo + '</div></div>' +
      '<div class="detail-item"><span class="label">FORMAT</span><div class="value">' + formatWavInfo(sample.wavInfo) + '</div></div>' +
      '</div>' +
      '<div class="detail-actions">' +
      '<button class="btn-secondary" id="btnPreview">Preview</button>' +
      (sample.manualOverride ? '<button class="btn-secondary" id="btnEditAssign">Edit Mapping</button>' : '') +
      '</div>' +
      '</div>';

    document.getElementById('btnPreview').addEventListener('click', function() {
      if (sample.trimApproved) {
        previewSample(sample.path, sample.trimStart, sample.trimEnd);
      } else {
        previewSample(sample.path);
      }
    });
    if (sample.manualOverride) {
      document.getElementById('btnEditAssign').addEventListener('click', function() {
        state.editingSampleIndex = state.selectedSampleIndex;
        renderSampleDetail();
      });
    }
    return;
  }

  // Unmatched (or editing a manual assignment): show assignment form
  var cur = sample.parsed ? sample : null;
  function opts(values, selected, labels) {
    return values.map(function(v, i) {
      return '<option value="' + v + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + (labels ? labels[i] : v) + '</option>';
    }).join('');
  }
  container.innerHTML =
    '<div class="inner-panel">' +
    '<span class="label-lg detail-title">MANUAL ASSIGNMENT — ' + escapeHtml(sample.filename) + '</span>' +
    '<div class="assign-form">' +
    '<div class="form-group"><label for="assignNote">Note</label><select id="assignNote">' +
    opts(['C', 'D', 'E', 'F', 'G', 'A', 'B'], cur ? cur.note : 'C') + '</select></div>' +
    '<div class="form-group"><label for="assignAcc">Accidental</label><select id="assignAcc">' +
    opts(['', 's', 'b'], cur ? (cur.accidental || '') : '', ['Natural', 'Sharp', 'Flat']) + '</select></div>' +
    '<div class="form-group"><label for="assignOctave">Octave</label><select id="assignOctave">' +
    opts([0, 1, 2, 3, 4, 5, 6, 7, 8], cur ? cur.octave : 3) + '</select></div>' +
    '<div class="form-group"><label for="assignVel">Velocity</label><select id="assignVel">' +
    opts([1, 2, 3, 4, 5], cur ? cur.velocityLayer : 1) + '</select></div>' +
    '<div class="form-group"><label for="assignArt">Articulation</label><input type="text" id="assignArt" maxlength="32" placeholder="e.g. Plucked" value="' +
    escapeHtml(cur ? cur.articulation : (defaultArticulation() || '')) + '"></div>' +
    '<div class="form-group"><label for="assignRR">Round Robin</label><select id="assignRR">' +
    opts([1, 2, 3, 4, 5], cur ? cur.roundRobin : 1) + '</select></div>' +
    '</div>' +
    '<div class="status-msg" id="assignStatus" role="status"></div>' +
    '<div class="detail-actions">' +
    '<button class="btn-primary" id="btnApplyAssign">Apply</button>' +
    '<button class="btn-secondary" id="btnPreviewUnmatched">Preview</button>' +
    (cur ? '<button class="btn-secondary" id="btnUnassign">Unassign</button>' : '') +
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
  if (cur) {
    document.getElementById('btnUnassign').addEventListener('click', function() {
      var keep = { filename: sample.filename, path: sample.path, wavInfo: sample.wavInfo };
      var fresh = parseFilename('', sample.path);
      Object.keys(fresh).forEach(function(k) { sample[k] = fresh[k]; });
      sample.filename = keep.filename;
      sample.wavInfo = keep.wavInfo;
      state.editingSampleIndex = -1;
      refreshMapping();
    });
  }
}

/* Most common articulation among mapped samples, used as the form default */
function defaultArticulation() {
  var counts = {};
  var best = null;
  state.samples.forEach(function(s) {
    if (!s.parsed || !s.articulation) return;
    counts[s.articulation] = (counts[s.articulation] || 0) + 1;
    if (!best || counts[s.articulation] > counts[best]) best = s.articulation;
  });
  return best;
}

function applyManualAssignment(index) {
  var s = state.samples[index];
  if (!s) return;

  var note = document.getElementById('assignNote').value;
  var acc = document.getElementById('assignAcc').value || null;
  var octave = parseInt(document.getElementById('assignOctave').value);
  var vel = parseInt(document.getElementById('assignVel').value);
  // Articulations become folder names and DS menu entries: keep them plain
  var art = document.getElementById('assignArt').value.replace(/[^A-Za-z0-9 \-]/g, '').trim() || 'Default';
  var rr = parseInt(document.getElementById('assignRR').value);

  var midi = calcMidiNote(note, acc, octave);
  if (midi < 0 || midi > 127) {
    setStatus('assignStatus', formatNoteName(note, acc, octave) + ' is outside the MIDI range (C-2 to G8).', 'error');
    return;
  }

  s.parsed = true;
  s.manualOverride = true;
  s.note = note;
  s.accidental = acc;
  s.octave = octave;
  s.midiNote = midi;
  s.velocityLayer = vel;
  s.articulation = art;
  s.roundRobin = rr;
  s.instrument = state.instrumentName;
  state.editingSampleIndex = -1;

  refreshMapping();
}

function refreshMapping() {
  state.samples.forEach(function(s) {
    s.lowKey = s.highKey = s.rootKey = s.velLow = s.velHigh = null;
  });
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
    var idx = state.samples.findIndex(function(s) { return s.parsed && s.midiNote === midiNote; });
    if (idx >= 0) {
      selectSample(idx);
      var rows = document.querySelectorAll('.file-row');
      if (rows[idx]) rows[idx].scrollIntoView({ block: 'nearest' });
    }
  });
}

function updateValidation() {
  var validation = validateSamples(state.samples);
  var warningEl = document.getElementById('validationWarning');
  var btnNext = document.getElementById('btnToPhase3');

  warningEl.innerHTML = '';
  warningEl.classList.remove('is-warning');
  var messages = validation.errors.concat(validation.warnings);
  messages.forEach(function(m, i) {
    var line = document.createElement('div');
    line.className = i < validation.errors.length ? 'v-error' : 'v-warning';
    line.textContent = m;
    warningEl.appendChild(line);
  });
  warningEl.classList.toggle('hidden', messages.length === 0);
  if (validation.errors.length === 0 && validation.warnings.length > 0) {
    warningEl.classList.add('is-warning');
  }

  if (validation.errors.length > 0) {
    btnNext.style.display = 'none';
    uncompleteFrom(2);
  } else {
    btnNext.style.display = '';
  }
}

// ── Phase 3 ──
function renderPhase3() {
  var stats = getSampleStats(state.samples);

  if (!state.layoutBuilder) {
    var canvas = document.getElementById('layoutCanvas');
    state.layoutBuilder = new LayoutBuilder(canvas);
  }

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
    var available = isControlAvailable(key);
    var toggle = document.createElement('div');
    toggle.className = 'control-toggle' + (available ? '' : ' unavailable');

    var checkbox = document.createElement('div');
    checkbox.className = 'toggle-checkbox' + (ctrl.enabled ? ' checked' : '');

    var label = document.createElement('span');
    label.className = 'toggle-label';
    label.textContent = ctrl.label;

    toggle.appendChild(checkbox);
    toggle.appendChild(label);

    if (!available) {
      var need = document.createElement('span');
      need.className = 'toggle-need';
      need.textContent = 'needs ' + templateConfig.effects[ctrl.requires].label;
      toggle.appendChild(need);
      toggle.title = ctrl.label + ' controls the ' + templateConfig.effects[ctrl.requires].label +
        ' effect. Turn that effect on to use it.';
    }

    makeCheckable(toggle, ctrl.enabled, function() {
      toggleControl(key);
      checkbox.classList.toggle('checked', templateConfig.controls[key].enabled);
      toggle.setAttribute('aria-checked', templateConfig.controls[key].enabled ? 'true' : 'false');
      if (state.layoutBuilder) state.layoutBuilder.updateControls();
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
    info.innerHTML = '<div class="effect-name">' + escapeHtml(fmt.label) + '</div>' +
                     '<div class="effect-desc">' + escapeHtml(fmt.description) + '</div>';

    toggle.appendChild(checkbox);
    toggle.appendChild(info);

    makeCheckable(toggle, fmt.enabled, function() {
      if (toggleExportFormat(key)) {
        checkbox.classList.toggle('checked', templateConfig.exportFormats[key].enabled);
        toggle.setAttribute('aria-checked', templateConfig.exportFormats[key].enabled ? 'true' : 'false');
        setStatus('formatStatus', '');
      } else {
        setStatus('formatStatus', 'At least one export format is required.', 'error');
      }
    });

    panel.appendChild(toggle);
  });
  var status = document.createElement('div');
  status.id = 'formatStatus';
  status.className = 'status-msg';
  status.setAttribute('role', 'status');
  panel.appendChild(status);
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
    info.innerHTML = '<div class="effect-name">' + escapeHtml(fx.label) + '</div>' +
                     '<div class="effect-desc">' + escapeHtml(fx.description) + '</div>';

    toggle.appendChild(checkbox);
    toggle.appendChild(info);

    makeCheckable(toggle, fx.enabled, function() {
      toggleEffect(key);
      checkbox.classList.toggle('checked', templateConfig.effects[key].enabled);
      toggle.setAttribute('aria-checked', templateConfig.effects[key].enabled ? 'true' : 'false');
      // Some knobs depend on effects (Cutoff/Res → Filter, Reverb → Reverb)
      renderControlToggles();
      if (state.layoutBuilder) {
        state.layoutBuilder.updateControls();
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

  if (state.layoutBuilder) {
    state.knobPositions = state.layoutBuilder.getPositions();
    state.uiHeight = state.layoutBuilder.getRequiredHeight();
  }

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
    '<div class="summary-cell"><span class="label">INSTRUMENT</span><div class="value">' + escapeHtml(state.instrumentName) + '</div></div>' +
    '<div class="summary-cell"><span class="label">SAMPLES</span><div class="value">' + stats.totalSamples + '</div></div>' +
    '<div class="summary-cell"><span class="label">ARTICULATIONS</span><div class="value">' + stats.articulationCount + '</div></div>' +
    '<div class="summary-cell"><span class="label">VEL LAYERS</span><div class="value">' + stats.maxVelocityLayers + '</div></div>' +
    '<div class="summary-cell"><span class="label">ROUND ROBINS</span><div class="value">' + stats.maxRoundRobins + '</div></div>' +
    '<div class="summary-cell"><span class="label">TEMPLATE</span><div class="value">Chromatic</div></div>';

  var outputEl = document.getElementById('outputFormats');
  var html = '';
  if (formats.indexOf('decentsampler') !== -1) {
    html += '<div class="output-row">' +
      '<div class="output-info"><span class="output-format">Decent Sampler</span>' +
      '<span class="output-desc">Ready-to-play .dspreset — open it and play</span></div>' +
      '<span class="output-badge">.dspreset</span></div>';
  }
  if (formats.indexOf('kontakt') !== -1) {
    if (html) html += '<div style="border-top:1px solid var(--divider);margin:10px 0;"></div>';
    html += '<div class="output-row">' +
      '<div class="output-info"><span class="output-format">Kontakt 6+</span>' +
      '<span class="output-desc">Samples, KSP script and skin — map in Kontakt using the setup guide</span></div>' +
      '<span class="output-badge">.txt</span></div>';
  }
  outputEl.innerHTML = html;
}

/* Never build over an earlier export: pick "<name> (2)", "(3)", ... */
async function uniqueOutputPath(path) {
  var candidate = path.replace(/[\/\\]+$/, '');
  var base = candidate;
  for (var n = 2; await window.__TAURI__.core.invoke('path_exists', { path: candidate }); n++) {
    candidate = base + ' (' + n + ')';
    if (n > 999) throw new Error('Too many existing exports named ' + base);
  }
  return candidate;
}

async function doBuild() {
  if (state.building) return;
  var btn = document.getElementById('btnBuild');
  var progress = document.getElementById('progressContainer');
  var errorEl = document.getElementById('buildError');
  errorEl.classList.remove('visible');

  var result;
  try {
    result = await window.__TAURI__.dialog.save({
      title: 'Choose where to create the instrument folder',
      defaultPath: safePathSegment(state.instrumentName, 'Instrument') + '_SampleArchitect'
    });
  } catch (err) {
    showBuildError('Could not open the save dialog: ' + errText(err));
    return;
  }
  if (!result) return;

  state.building = true;
  btn.style.display = 'none';
  document.getElementById('progressFill').style.width = '0%';
  document.getElementById('progressLabel').textContent = 'Preparing…';
  progress.classList.add('visible');

  try {
    var outputDir = await uniqueOutputPath(result);
    var stats = getSampleStats(state.samples);
    stats.instrument = state.instrumentName;

    state.outputPath = await exportInstrument(state.samples, stats, templateConfig, outputDir, function(stageIdx, label, total) {
      var pct = Math.min(100, ((stageIdx + 1) / (total || 8)) * 100);
      document.getElementById('progressFill').style.width = pct + '%';
      document.getElementById('progressLabel').textContent = label;
    });

    progress.classList.remove('visible');
    document.getElementById('completionPath').textContent = state.outputPath;
    document.getElementById('btnCopyScript').style.display = lastGeneratedKSP ? '' : 'none';
    document.getElementById('completion').classList.add('visible');
    document.getElementById('completion').scrollIntoView({ block: 'center', behavior: 'smooth' });
  } catch (err) {
    console.error('Build failed:', err);
    progress.classList.remove('visible');
    btn.style.display = '';
    showBuildError('Build failed: ' + errText(err) + '. Nothing was overwritten; fix the problem and try again.');
  } finally {
    state.building = false;
  }
}

function showBuildError(msg) {
  var el = document.getElementById('buildError');
  el.textContent = msg;
  el.classList.add('visible');
  el.scrollIntoView({ block: 'center' });
}

function resetBuildCard() {
  document.getElementById('completion').classList.remove('visible');
  document.getElementById('buildError').classList.remove('visible');
  document.getElementById('btnBuild').style.display = '';
}

// ── Init ──
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('appVersion').textContent = 'SampleArchitect v' + SA_VERSION;

  document.querySelectorAll('.step-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      goToPhase(parseInt(btn.dataset.step));
    });
  });

  // Settings modal
  document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
  document.getElementById('settingsClose').addEventListener('click', closeSettingsModal);
  document.getElementById('settingsCancelBtn').addEventListener('click', closeSettingsModal);
  document.getElementById('settingsSaveBtn').addEventListener('click', saveSettings);
  document.getElementById('settingsToggleKey').addEventListener('click', toggleApiKeyVisibility);
  document.getElementById('settingsTestKey').addEventListener('click', testApiKey);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.getElementById('settingsOverlay').classList.contains('visible')) {
      closeSettingsModal();
    }
  });

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

  updatePhase1Layout();
  renderChatMessages();

  initPhase1();
  initPhase2();
  renderFileList();
  renderSampleDetail();

  document.getElementById('instrumentNameInput').addEventListener('input', function() {
    state.instrumentName = this.value.trim() || 'My Instrument';
    document.getElementById('projectName').textContent = state.instrumentName + ' Project';
  });

  document.getElementById('btnAcceptAllTrims').addEventListener('click', function() {
    if (state.samples.length > 0) acceptAllTrims();
  });
  document.getElementById('btnRejectAllTrims').addEventListener('click', function() {
    if (state.samples.length > 0) rejectAllTrims();
  });

  document.getElementById('btnToPhase3').addEventListener('click', function() {
    completePhase(2);
    goToPhase(3);
  });

  document.getElementById('btnAutoLayout').addEventListener('click', function() {
    if (state.layoutBuilder) state.layoutBuilder.autoLayout();
  });

  document.getElementById('btnToPhase4').addEventListener('click', function() {
    if (state.layoutBuilder) {
      state.knobPositions = state.layoutBuilder.getPositions();
      state.uiHeight = state.layoutBuilder.getRequiredHeight();
    }
    completePhase(3);
    goToPhase(4);
  });

  document.getElementById('btnBuild').addEventListener('click', doBuild);
  document.getElementById('btnBuildAgain').addEventListener('click', resetBuildCard);

  document.getElementById('btnCopyScript').addEventListener('click', function() {
    var btn = document.getElementById('btnCopyScript');
    if (!lastGeneratedKSP) return;
    navigator.clipboard.writeText(lastGeneratedKSP).then(function() {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(function() {
        btn.textContent = 'Copy Script to Clipboard';
        btn.classList.remove('copied');
      }, 2000);
    }).catch(function(err) {
      console.error('Clipboard copy failed:', err);
      btn.textContent = 'Copy failed — open the script file instead';
    });
  });

  function openPath(p) {
    if (!p || !window.__TAURI__ || !window.__TAURI__.shell) return;
    Promise.resolve(window.__TAURI__.shell.open(p)).catch(function(err) {
      showBuildError('Could not open ' + p + ': ' + errText(err));
    });
  }
  document.getElementById('btnOpenFolder').addEventListener('click', function() {
    openPath(state.outputPath);
  });
  document.getElementById('btnViewGuide').addEventListener('click', function() {
    if (state.outputPath) openPath(state.outputPath + '/Setup Guide.txt');
  });

  initMIDI();

  goToPhase(1);
});
