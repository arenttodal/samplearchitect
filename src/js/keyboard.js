/* keyboard.js — Visual piano keyboard renderer */

var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
var BLACK_KEY_INDICES = [1, 3, 6, 8, 10]; // indices within octave that are black

function isBlackKey(midiNote) {
  return BLACK_KEY_INDICES.indexOf(midiNote % 12) !== -1;
}

function midiToNoteName(midi) {
  var octave = Math.floor(midi / 12) - 2;
  var noteIdx = midi % 12;
  return NOTE_NAMES[noteIdx] + octave;
}

function renderKeyboard(container, samples, onKeyClick) {
  container.innerHTML = '';

  var mapped = samples.filter(function(s) { return s.parsed; });
  if (mapped.length === 0) return;

  var midiNotes = mapped.map(function(s) { return s.midiNote; });
  var minNote = Math.max(0, Math.min.apply(null, midiNotes) - 3);
  var maxNote = Math.min(127, Math.max.apply(null, midiNotes) + 3);

  // Align to C on the left
  minNote = minNote - (minNote % 12);
  // Extend to B on the right
  maxNote = maxNote + (11 - (maxNote % 12));

  var mappedSet = {};
  mapped.forEach(function(s) {
    mappedSet[s.midiNote] = true;
  });

  // Build white keys first, then overlay black keys
  var whiteKeys = [];
  var blackKeys = [];

  for (var midi = minNote; midi <= maxNote; midi++) {
    if (isBlackKey(midi)) {
      blackKeys.push(midi);
    } else {
      whiteKeys.push(midi);
    }
  }

  // Create white keys
  whiteKeys.forEach(function(midi) {
    var key = document.createElement('div');
    key.className = 'key white';
    if (mappedSet[midi]) key.classList.add('mapped');
    key.dataset.midi = midi;

    var label = document.createElement('span');
    label.className = 'key-label';
    var noteName = midiToNoteName(midi);
    // Only show C labels and mapped keys
    if (noteName.startsWith('C') && !noteName.startsWith('C#')) {
      label.textContent = noteName;
    } else if (mappedSet[midi]) {
      label.textContent = noteName;
    }
    key.appendChild(label);

    key.addEventListener('click', function() {
      if (onKeyClick) onKeyClick(midi);
    });

    container.appendChild(key);
  });

  // Create black keys, positioned absolutely
  var whiteKeyWidth = 100 / whiteKeys.length;
  blackKeys.forEach(function(midi) {
    var key = document.createElement('div');
    key.className = 'key black';
    if (mappedSet[midi]) key.classList.add('mapped');
    key.dataset.midi = midi;

    // Find position: which white key is it between?
    var prevWhiteMidi = midi - 1;
    var whiteIndex = whiteKeys.indexOf(prevWhiteMidi);
    if (whiteIndex >= 0) {
      var leftPercent = ((whiteIndex + 1) * whiteKeyWidth) - (whiteKeyWidth * 0.3);
      key.style.left = leftPercent + '%';
      key.style.width = (whiteKeyWidth * 0.6) + '%';
    }

    if (mappedSet[midi]) {
      var label = document.createElement('span');
      label.className = 'key-label';
      label.textContent = midiToNoteName(midi);
      label.style.fontSize = '7px';
      key.appendChild(label);
    }

    key.addEventListener('click', function() {
      if (onKeyClick) onKeyClick(midi);
    });

    container.appendChild(key);
  });
}
