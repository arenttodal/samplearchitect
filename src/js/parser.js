/* parser.js — Filename parser following reference/parser-spec.md */

const PARSER_REGEX = /^([^_]+)_([^_]+)_([A-Ga-g])([sb]?)(\d)_v(\d+)_rr(\d+)\.wav$/;

const NOTE_OFFSETS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function calcMidiNote(note, accidental, octave) {
  const base = (parseInt(octave) + 2) * 12;
  const offset = NOTE_OFFSETS[note.toUpperCase()];
  const acc = accidental === 's' ? 1 : accidental === 'b' ? -1 : 0;
  return base + offset + acc;
}

function parseFilename(filename, fullPath) {
  const match = filename.match(PARSER_REGEX);
  if (match) {
    const note = match[3].toUpperCase();
    const accidental = match[4] || null;
    const octave = parseInt(match[5]);
    return {
      filename: filename,
      path: fullPath,
      parsed: true,
      instrument: match[1],
      articulation: match[2],
      note: note,
      accidental: accidental,
      octave: octave,
      midiNote: calcMidiNote(note, accidental, octave),
      velocityLayer: parseInt(match[6]),
      roundRobin: parseInt(match[7]),
      manualOverride: false,
      lowKey: null,
      highKey: null,
      rootKey: null,
      velLow: null,
      velHigh: null
    };
  }
  return {
    filename: filename,
    path: fullPath,
    parsed: false,
    instrument: null,
    articulation: null,
    note: null,
    accidental: null,
    octave: null,
    midiNote: null,
    velocityLayer: null,
    roundRobin: null,
    manualOverride: false,
    lowKey: null,
    highKey: null,
    rootKey: null,
    velLow: null,
    velHigh: null
  };
}

function formatNoteName(note, accidental, octave) {
  if (!note) return '?';
  const accStr = accidental === 's' ? '#' : accidental === 'b' ? 'b' : '';
  return note + accStr + octave;
}

function getVelocityRange(layer, totalLayers) {
  const step = Math.floor(128 / totalLayers);
  const low = (layer - 1) * step;
  const high = layer === totalLayers ? 127 : (layer * step) - 1;
  return { low, high };
}
