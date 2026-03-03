# SampleArchitect — MVP Build Brief

## What Is This

SampleArchitect is a desktop app that turns a folder of named WAV samples into a playable Kontakt instrument. The user records samples, names them with a specific convention, drags them into the app, configures basic controls, and exports a KSP script + folder structure that loads directly into Native Instruments Kontakt.

**The 24-hour goal:** Record a few samples of any instrument, run them through this app, load the output in Kontakt, and play a chord in a DAW.

## Tech Stack

- **Desktop shell:** Tauri 2.x (Rust backend, WebView2 frontend)
- **Frontend:** Vanilla HTML, CSS, JavaScript — NO frameworks, NO build tools, NO React, NO TypeScript
- **Audio preview:** Web Audio API
- **File I/O:** Tauri fs and dialog plugins
- **Output:** Generated KSP script file + organized folder structure + setup guide text file

There is NO database, NO cloud API, NO user accounts, NO Supabase, NO Cloudflare. Everything runs locally.

## Design

The UI is ultra-dark, monochromatic, Apple-inspired. Near-black backgrounds, white/gray text hierarchy, color only as tiny functional indicators (green dots for matched samples, amber for unmatched).

### Color Tokens (CSS Custom Properties)

```css
:root {
  --bg: #08080b;
  --raised: #0d0d11;
  --card: #111116;
  --card-edge: rgba(255,255,255,0.04);
  --divider: rgba(255,255,255,0.04);
  --hover: rgba(255,255,255,0.03);
  --press: rgba(255,255,255,0.06);
  --h1: #ededf0;
  --h2: #d0d0d5;
  --body: #9a9aa2;
  --muted: #5c5c65;
  --faint: #35353d;
  --ok: #3dd68c;
  --warn: #c9933a;
  --ok-bg: rgba(61,214,140,0.08);
  --warn-bg: rgba(201,147,58,0.08);
}
```

### Typography
- Font: Inter (loaded locally), weights 400 and 600
- Monospace: SF Mono / Fira Code fallback
- Size range: 8px (uppercase labels) to 24px (instrument title)
- All uppercase labels use letter-spacing: 0.14em

### Components
- Cards: 14px border-radius, 1px solid var(--card-edge) border, var(--card) background
- Inner panels: 10px border-radius, var(--divider) border
- Buttons primary: rgba(255,255,255,0.07) bg, white text, 600 weight, 6px radius
- Buttons secondary: transparent bg, var(--divider) border, var(--muted) text
- Hover: +3% white opacity on backgrounds
- Minimum window size: 1200×700px

### Layout
- Top bar: 38px. Logo left, step navigation center, project name right.
- Content: fills remaining height, 14px padding
- Bottom bar: 22px. "SampleArchitect v1.0" left, "Kontakt 6+" center, "by Evenant" right
- Step nav: pill container (rgba(255,255,255,0.02) bg, 8px radius) with 4 step buttons inside

## The Four Phases

The app is a 4-step wizard. Steps are shown in the top nav bar. Users can click any completed step to go back.

---

### Phase 1: Getting Started (Static Guide)

**NO AI CHAT.** This is a static HTML panel with a reference guide.

**Layout:** Full-width single card, scrollable content, large "I'm Ready — Import Samples" button at the bottom.

**Content:**
1. **Naming Convention** — Visual explanation with examples showing the pattern:
   `[Instrument]_[Articulation]_[Note][Octave]_v[Velocity]_rr[RoundRobin].wav`
   Examples: `Kantele_Plucked_C3_v1_rr1.wav`, `Piano_Sustain_Bb2_v3_rr2.wav`

2. **Folder Structure** — Recommend organizing by articulation subfolder

3. **Recording Tips** — Consistent mic position, 0.5s silence before each sample, 44.1kHz/24bit minimum

4. **"Download Template Folders" button** — Opens Tauri save dialog, creates empty folder structure:
   ```
   MySamples/
   ├── Plucked/
   ├── Strummed/
   ├── Harmonics/
   └── Sustain/
   ```

**Build time: ~2 hours**

---

### Phase 2: Sample Import & Mapping

This is the core phase and gets the most build time.

**Layout:** Two-column. Left panel (300px) = file list. Right panel = keyboard mapper (top) + sample detail (bottom).

#### Drop Zone
Top of the right panel. User drags a **folder** from Finder/Explorer. Tauri file drop provides the directory path. App reads all .wav files recursively, skipping hidden files.

#### On File Drop:
1. Read all .wav files recursively from dropped directory
2. Run each filename through the parser regex (see reference/parser-spec.md)
3. Populate sample array with parsed metadata
4. Calculate MIDI note numbers (C0 = 24)
5. Auto-detect instrument name from first matched file's instrument token
6. Render file list + keyboard

#### File List (left, 300px)
Scrollable list. Each row:
- Status dot: green (parsed) or amber (unmatched)
- Filename in monospace, truncated with ellipsis
- Pitch label ("C3" or "?" for unmatched)

Clicking selects and shows detail on right.
Header shows matched/unmatched badge counts.

#### Keyboard Mapper (top of right panel)
Visual piano keyboard spanning the range of imported samples (auto from min/max MIDI notes + 3 semitone padding). Keys fill with subtle white highlight when mapped. Clicking a key scrolls file list to first sample at that pitch. Built as a flex container of divs — white keys flex:1, black keys negative margin overlay.

Key colors:
- Mapped: rgba(255,255,255,0.035) bg with rgba(255,255,255,0.08) border
- Unmatched/AI-suggested: rgba(201,147,58,0.025) bg
- Empty: rgba(255,255,255,0.008) bg

#### Sample Detail (bottom of right panel)
**When matched file selected:** Read-only summary of parsed metadata (note, octave, velocity, articulation, round robin). "Preview" button plays WAV via Web Audio API.

**When unmatched file selected:** Editable dropdowns:
- Note: A through G
- Accidental: Natural / Sharp / Flat
- Octave: 0–8
- Velocity Layer: 1–5
- Articulation: free text input
- Round Robin: 1–5
- "Apply" button saves assignment, turns dot green

#### Validation (before allowing Phase 3):
- At least 1 sample mapped
- No duplicate mappings (same note + vel + rr)
- Warn (don't block) on mixed sample rates
- Errors show as inline red warning in header

**Build time: ~8 hours**

---

### Phase 3: Template Configuration

**Layout:** Two-column. Left = instrument preview. Right = controls panel (top) + effects panel (bottom).

#### Instrument Preview (left)
Shows: instrument name (large, top-left), "SAMPLEARCHITECT" label (small, top-right), sample count + articulation count, active knobs in a grid, and FX chain at the bottom.

Knobs are SVG arc indicators (not interactive/draggable for MVP). They show default values and appear/disappear when toggled in the right panel. The arc is drawn with:
- Track: rgba(255,255,255,0.04) circle with strokeDasharray for 270° arc
- Value: rgba(255,255,255,0.35) circle proportional to the value
- Both use strokeLinecap="round" and transform="rotate(135 cx cy)"
- Value label centered inside in monospace

FX Chain: horizontal row of pill buttons showing active effects with → arrows between them.

#### Controls Panel (right, top)
2×4 grid of toggle buttons. Each has a checkbox (11×11px, 2.5px radius) and label. These 8 controls are available:
- Volume, Pan, Attack, Release, Tune, Cutoff, Resonance, Reverb Send

Toggling updates the preview (show/hide knob) and determines which KSP macros get generated.

#### Effects Panel (right, bottom)
Vertical stack of 4 toggles with label + description:
- Filter (LP / HP / BP)
- EQ (2-band parametric)
- Reverb (Algorithmic)
- Delay (Tempo-synced)

**Build time: ~3 hours**

---

### Phase 4: Export / Build

**Layout:** Single centered column (max-width 560px). Three stacked cards: Summary, Output, Build.

#### Summary Card
6-cell grid (3×2): Instrument name, Sample count, Articulation count, Velocity layers, Round robins, Template name.

#### Output Card
Single row showing "Kontakt 6+" with description "KSP script + setup guide" and file extension badge ".nki". (No Decent Sampler for MVP.)

#### Build Button / Progress / Completion

**Before build:** Single large button "Build Instrument"

**On click:**
1. Tauri save dialog for output directory
2. Progress bar with stage labels (8 stages, ~4 seconds animation)
3. Generates KSP script (see reference/ksp-template.ksp)
4. Copies samples into organized folder structure grouped by articulation
5. Writes setup guide text file
6. Completion screen with checkmark, "Build Complete", "Download ZIP" / "Open Folder" / "Setup Guide" buttons

#### Output Folder Structure
```
[InstrumentName]_SampleArchitect/
├── Samples/
│   ├── Plucked/          (subfolder per articulation)
│   │   ├── Kantele_Plucked_C3_v1_rr1.wav
│   │   └── ...
│   ├── Strummed/
│   └── Harmonics/
├── Scripts/
│   └── [InstrumentName].ksp
└── Setup Guide.txt
```

**Build time: ~5 hours**

---

## Critical Reference Files

### reference/parser-spec.md
Complete filename parser specification with regex, MIDI note calculation, and edge cases.

### reference/ksp-template.ksp
Complete KSP script reference that the generator must produce. This is the most important reference — study it carefully before implementing ksp-gen.js.

### reference/chromatic-template.json
Template configuration file defining all controls, effects, and their default values.

### reference/setup-guide-template.txt
Template for the plain text setup guide included in exports.

---

## Build Order

Build in this exact sequence. Each step should be testable before moving on.

1. **Tauri scaffold** — `npm create tauri-app@latest`, configure window (1200×700 min), dark title bar, add fs + dialog + shell plugins
2. **Shell + CSS** — index.html with top bar, content area, bottom bar. All CSS custom properties. Step nav with click routing.
3. **Phase 1** — Static guide content. Template folder download button.
4. **Phase 2 file import** — Drop handler, filename parser, file list rendering with status dots.
5. **Phase 2 keyboard** — Visual keyboard mapper, selection, manual assignment UI.
6. **Phase 2 audio preview** — Web Audio API sample playback.
7. **Phase 3** — Template toggles, instrument preview rendering.
8. **Phase 4 KSP generator** — THE CRITICAL PATH. Generate the .ksp script from sample map + template config. See reference/ksp-template.ksp.
9. **Phase 4 exporter** — Copy samples to organized structure, write files, setup guide.
10. **Integration test** — Record 3 samples (C3, E3, G3), full pipeline, load in Kontakt, play chord.

## Testing

**Pass criteria:** Record C3, E3, G3 of any instrument → name with convention → import → configure → export → load in Kontakt → play C major chord.

**Risk mitigation:** If KSP generation runs long, cut round robin cycling and FX chain insertion. A working instrument with just zone mapping + volume knob is still a valid MVP.

## File Structure

```
samplearchitect/
├── CLAUDE.md              ← You are here
├── reference/
│   ├── parser-spec.md     ← Filename parser specification
│   ├── ksp-template.ksp   ← KSP script reference
│   ├── chromatic-template.json
│   └── setup-guide-template.txt
├── src-tauri/
│   ├── src/main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
└── src/
    ├── index.html
    ├── css/style.css
    ├── js/
    │   ├── app.js          ← Main controller, phase routing, state
    │   ├── parser.js       ← Filename parser + validator
    │   ├── mapper.js       ← Sample-to-key mapping logic
    │   ├── keyboard.js     ← Visual keyboard renderer
    │   ├── template.js     ← Template config state
    │   ├── ksp-gen.js      ← KSP script generator (CRITICAL)
    │   ├── exporter.js     ← Folder structure + file writer
    │   └── audio.js        ← Web Audio preview player
    └── assets/
        └── inter/          ← Inter font files
```

## What NOT To Build
- No AI / Claude API integration
- No FFT pitch detection
- No loop point editor
- No Decent Sampler export
- No auto-updater
- No user accounts / cloud anything
- No build tools / bundlers / webpack
- No TypeScript
- No React or any framework
