# Filename Parser Specification

## Pattern

```
[Instrument]_[Articulation]_[Note][Accidental][Octave]_v[Velocity]_rr[RoundRobin].wav
```

## Regex

```javascript
/^([^_]+)_([^_]+)_([A-Ga-g])([sb]?)(\d)_v(\d+)_rr(\d+)\.wav$/
```

### Capture Groups
| Group | Content       | Example  |
|-------|---------------|----------|
| 1     | Instrument    | Kantele  |
| 2     | Articulation  | Plucked  |
| 3     | Note (A–G)    | C        |
| 4     | Accidental    | s, b, "" |
| 5     | Octave (0–8)  | 3        |
| 6     | Velocity (1+) | 1        |
| 7     | Round Robin   | 1        |

## MIDI Note Calculation

Kontakt uses Middle C = C3 = MIDI 60 (not C4). Our convention aligns with this.

```javascript
const NOTE_OFFSETS = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };

function calcMidiNote(note, accidental, octave) {
  // C-2 = MIDI 0, so C0 = 24, C3 = 60
  const base = (parseInt(octave) + 2) * 12;
  const offset = NOTE_OFFSETS[note.toUpperCase()];
  const acc = accidental === 's' ? 1 : accidental === 'b' ? -1 : 0;
  return base + offset + acc;
}
```

### MIDI Note Reference Table
| Note | MIDI | Note | MIDI | Note | MIDI |
|------|------|------|------|------|------|
| C2   | 48   | C3   | 60   | C4   | 72   |
| D2   | 50   | D3   | 62   | D4   | 74   |
| E2   | 52   | E3   | 64   | E4   | 76   |
| F2   | 53   | F3   | 65   | F4   | 77   |
| G2   | 55   | G3   | 67   | G4   | 79   |
| A2   | 57   | A3   | 69   | A4   | 81   |
| B2   | 59   | B3   | 71   | B4   | 83   |

## Sharp/Flat Convention

Filenames use `s` for sharp and `b` for flat (NOT `#` which is invalid in many filesystems).

- C# → `Cs`
- Bb → `Bb`
- F# → `Fs`

## Valid Filename Examples

```
Kantele_Plucked_C3_v1_rr1.wav      → C3, vel 1, rr 1
Kantele_Plucked_Cs3_v2_rr1.wav     → C#3, vel 2, rr 1
Kantele_Strummed_E4_v1_rr1.wav     → E4, vel 1, rr 1
Piano_Sustain_Bb2_v3_rr2.wav       → Bb2, vel 3, rr 2
Guitar_Fingerpick_A3_v1_rr1.wav    → A3, vel 1, rr 1
```

## Invalid Filenames (should get amber status)

```
recording_017.wav                   → No naming pattern
Kantele_Plucked_C#3_v1_rr1.wav     → Uses # instead of s
Kantele_C3_v1_rr1.wav              → Missing articulation
my sample.wav                       → Spaces in filename
```

## Parser Output Object

```javascript
{
  filename: 'Kantele_Plucked_C3_v1_rr1.wav',
  path: '/full/path/to/file.wav',
  parsed: true,
  instrument: 'Kantele',
  articulation: 'Plucked',
  note: 'C',
  accidental: null,     // null, 's', or 'b'
  octave: 3,
  midiNote: 60,
  velocityLayer: 1,
  roundRobin: 1,
  manualOverride: false
}
```

For unmatched files:
```javascript
{
  filename: 'recording_017.wav',
  path: '/full/path/to/file.wav',
  parsed: false,
  instrument: null,
  articulation: null,
  note: null,
  accidental: null,
  octave: null,
  midiNote: null,
  velocityLayer: null,
  roundRobin: null,
  manualOverride: false
}
```

## Key Range Assignment

After all samples are parsed, the mapper assigns key ranges. For MVP, use simple gap-filling:

1. Sort all mapped samples by MIDI note
2. For each sample, calculate low key and high key:
   - Low key = midpoint between this note and the note below (or this note - 3 if lowest)
   - High key = midpoint between this note and the note above (or this note + 3 if highest)
3. Root key always equals the detected MIDI note

```javascript
function assignKeyRanges(samples) {
  const sorted = [...samples].filter(s => s.parsed).sort((a,b) => a.midiNote - b.midiNote);
  const unique = [...new Map(sorted.map(s => [s.midiNote, s])).values()];
  
  for (let i = 0; i < unique.length; i++) {
    const prev = i > 0 ? unique[i-1].midiNote : unique[i].midiNote - 6;
    const next = i < unique.length-1 ? unique[i+1].midiNote : unique[i].midiNote + 6;
    
    unique[i].lowKey = Math.ceil((prev + unique[i].midiNote) / 2);
    unique[i].highKey = Math.floor((unique[i].midiNote + next) / 2);
    unique[i].rootKey = unique[i].midiNote;
    
    // Ensure no overlap
    if (i > 0 && unique[i].lowKey <= unique[i-1].highKey) {
      unique[i].lowKey = unique[i-1].highKey + 1;
    }
  }
  
  // Apply ranges to all samples at the same pitch
  for (const s of samples) {
    if (!s.parsed) continue;
    const ref = unique.find(u => u.midiNote === s.midiNote);
    if (ref) {
      s.lowKey = ref.lowKey;
      s.highKey = ref.highKey;
      s.rootKey = ref.rootKey;
    }
  }
}
```

## Velocity Layer Assignment

Velocity ranges are split evenly based on how many layers exist per note:

| Layers | Layer 1   | Layer 2   | Layer 3    |
|--------|-----------|-----------|------------|
| 1      | 0–127     |           |            |
| 2      | 0–63      | 64–127    |            |
| 3      | 0–42      | 43–84     | 85–127     |
| 4      | 0–31      | 32–63     | 64–95      | 96–127 |

```javascript
function getVelocityRange(layer, totalLayers) {
  const step = Math.floor(128 / totalLayers);
  const low = (layer - 1) * step;
  const high = layer === totalLayers ? 127 : (layer * step) - 1;
  return { low, high };
}
```
