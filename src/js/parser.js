/* parser.js — Filename parser following reference/parser-spec.md */

/* Single source for the version shown in the UI and written to exports */
var SA_VERSION = '1.2.0';

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
  const midi = match ? calcMidiNote(match[3], match[4] || null, match[5]) : null;
  if (match && midi >= 0 && midi <= 127) {
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
      midiNote: midi,
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

/* ── Name sanitizing ──
   Instrument names come from filename tokens or user input and articulations
   from free text; both end up in file paths, KSP strings and markup. */

var WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/* A single path segment that is valid on macOS, Windows and Linux. */
function safePathSegment(name, fallback) {
  var s = String(name == null ? '' : name)
    .replace(/[\u0000-\u001f<>:"\/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 64)
    .replace(/[\s.]+$/, '');
  if (!s || /^_+$/.test(s) || WINDOWS_RESERVED.test(s)) return fallback || 'Untitled';
  return s;
}

/* Text safe inside a KSP string literal and a { } comment. */
function kspSafeText(name) {
  return String(name == null ? '' : name)
    .replace(/["{}\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 64);
}

/* Folder a sample is exported into: Samples/<this>/<filename> */
function articulationFolder(sample) {
  return safePathSegment(sample.articulation, 'Uncategorized');
}

/* Escape text for insertion into innerHTML (filenames and names are untrusted) */
function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
