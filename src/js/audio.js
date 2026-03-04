/* audio.js — Web Audio API preview player + MIDI support */

var audioCtx = null;
var currentSource = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function stopPreview() {
  if (currentSource) {
    try { currentSource.stop(); } catch(e) {}
    currentSource = null;
  }
}

/**
 * Preview a sample, optionally with trim points.
 * If trim start/end times are provided, only that region plays.
 */
async function previewSample(filePath, trimStartTime, trimEndTime) {
  stopPreview();

  try {
    var bytes = await window.__TAURI__.core.invoke('read_file_bytes', { path: filePath });
    var ctx = getAudioContext();
    var arrayBuffer = new Uint8Array(bytes).buffer;
    var audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    var source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    if (trimStartTime !== undefined && trimEndTime !== undefined) {
      var duration = trimEndTime - trimStartTime;
      source.start(0, trimStartTime, duration);
    } else {
      source.start(0);
    }

    currentSource = source;

    source.onended = function() {
      currentSource = null;
    };
  } catch (err) {
    console.error('Preview failed:', err);
  }
}

/**
 * Play a sample for MIDI preview with velocity scaling.
 */
async function playSampleWithVelocity(filePath, velocity, trimStartTime, trimEndTime) {
  stopPreview();

  try {
    var bytes = await window.__TAURI__.core.invoke('read_file_bytes', { path: filePath });
    var ctx = getAudioContext();
    var arrayBuffer = new Uint8Array(bytes).buffer;
    var audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    var source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    // Apply velocity as gain
    var gainNode = ctx.createGain();
    gainNode.gain.value = velocity;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    if (trimStartTime !== undefined && trimEndTime !== undefined) {
      var duration = trimEndTime - trimStartTime;
      source.start(0, trimStartTime, duration);
    } else {
      source.start(0);
    }

    currentSource = source;
    source.onended = function() {
      currentSource = null;
    };
  } catch (err) {
    console.error('MIDI preview failed:', err);
  }
}

/**
 * Decode a WAV file and analyze trim points.
 * Returns trim data for the sample.
 */
async function analyzeSampleTrim(filePath) {
  try {
    var bytes = await window.__TAURI__.core.invoke('read_file_bytes', { path: filePath });
    var ctx = getAudioContext();
    var arrayBuffer = new Uint8Array(bytes).buffer;
    var audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return findTrimPoints(audioBuffer);
  } catch (err) {
    console.error('Trim analysis failed for:', filePath, err);
    return null;
  }
}

/* ── MIDI Support ── */

var midiConnected = false;

async function initMIDI() {
  if (!navigator.requestMIDIAccess) {
    updateMIDIStatus(false);
    return;
  }

  try {
    var midi = await navigator.requestMIDIAccess();
    var inputCount = 0;

    midi.inputs.forEach(function(input) {
      input.onmidimessage = handleMIDIMessage;
      inputCount++;
    });

    // Listen for new connections
    midi.onstatechange = function(e) {
      if (e.port.type === 'input') {
        if (e.port.state === 'connected') {
          e.port.onmidimessage = handleMIDIMessage;
          midiConnected = true;
          updateMIDIStatus(true);
        } else {
          // Re-check if any inputs remain
          var hasInputs = false;
          midi.inputs.forEach(function() { hasInputs = true; });
          midiConnected = hasInputs;
          updateMIDIStatus(hasInputs);
        }
      }
    };

    midiConnected = inputCount > 0;
    updateMIDIStatus(inputCount > 0);
  } catch (e) {
    console.log('MIDI not available:', e);
    updateMIDIStatus(false);
  }
}

function handleMIDIMessage(event) {
  var data = event.data;
  if (!data || data.length < 3) return;

  var status = data[0] & 0xF0;
  var note = data[1];
  var velocity = data[2];

  if (status === 0x90 && velocity > 0) {
    // Note On
    onMIDINoteOn(note, velocity);
  }
}

function onMIDINoteOn(midiNote, velocity) {
  if (!state || !state.samples) return;

  // Find the best matching sample for this MIDI note
  var sample = findSampleForMIDINote(midiNote, velocity);
  if (sample) {
    var velNorm = velocity / 127;
    var trimStart = (sample.trimApproved && sample.trimStart !== undefined) ? sample.trimStart : undefined;
    var trimEnd = (sample.trimApproved && sample.trimEnd !== undefined) ? sample.trimEnd : undefined;
    playSampleWithVelocity(sample.path, velNorm, trimStart, trimEnd);

    // Highlight the key on the keyboard
    highlightMIDIKey(midiNote);
  }
}

function findSampleForMIDINote(midiNote, velocity) {
  if (!state || !state.samples) return null;

  var mapped = state.samples.filter(function(s) { return s.parsed; });
  if (mapped.length === 0) return null;

  // Find samples that cover this MIDI note range
  var candidates = mapped.filter(function(s) {
    if (s.lowKey != null && s.highKey != null) {
      return midiNote >= s.lowKey && midiNote <= s.highKey;
    }
    return s.midiNote === midiNote;
  });

  if (candidates.length === 0) {
    // Find nearest sample
    var nearest = null;
    var nearestDist = Infinity;
    mapped.forEach(function(s) {
      var dist = Math.abs(s.midiNote - midiNote);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = s;
      }
    });
    return nearest;
  }

  // If multiple velocity layers, find the one matching velocity
  if (candidates.length > 1) {
    var velMatch = candidates.find(function(s) {
      if (s.velLow != null && s.velHigh != null) {
        return velocity >= s.velLow && velocity <= s.velHigh;
      }
      return true;
    });
    return velMatch || candidates[0];
  }

  return candidates[0];
}

function highlightMIDIKey(midiNote) {
  var keys = document.querySelectorAll('.key');
  keys.forEach(function(key) {
    if (parseInt(key.dataset.midi) === midiNote) {
      key.classList.add('midi-active');
      setTimeout(function() {
        key.classList.remove('midi-active');
      }, 200);
    }
  });
}

function updateMIDIStatus(connected) {
  var el = document.getElementById('midiStatus');
  if (!el) return;

  if (connected) {
    el.innerHTML = '<span class="midi-dot connected"></span>MIDI: Connected';
    el.className = 'midi-status connected';
  } else {
    el.innerHTML = '<span class="midi-dot"></span>MIDI: No device';
    el.className = 'midi-status';
  }
}
