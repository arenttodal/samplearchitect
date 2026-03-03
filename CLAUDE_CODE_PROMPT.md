# Claude Code Launch Prompt for SampleArchitect

Copy everything below this line and paste it as your first message to Claude Code:

---

Read CLAUDE.md, then read every file in the reference/ folder. These contain the complete specification for what we're building.

Then build the SampleArchitect MVP — a Tauri 2.x desktop app following these steps, in this exact order. After each step, verify the result before moving on.

## Step 1: Scaffold the Tauri project

Initialize a Tauri 2.x project in this directory:
- `npm create tauri-app@latest . -- --template vanilla` (or manually scaffold)
- Configure tauri.conf.json: window title "SampleArchitect", min width 1200, min height 700, decorations true
- Add required Tauri plugins: fs, dialog, shell, path
- Verify: `cargo tauri dev` launches an empty window

## Step 2: Build the app shell and CSS

Create index.html with the full app layout:
- Top bar (38px): logo "S" badge + "SampleArchitect" text left, step navigation center (4 steps: Concept, Samples, Template, Export), "Kantele Project" text right
- Content area: fills remaining height, 14px padding
- Bottom bar (22px): version left, format center, credit right
- All styles in css/style.css using the CSS custom properties defined in CLAUDE.md

The step navigation should be clickable and route between 4 phase containers. Only one phase is visible at a time. Phase switching works via vanilla JS toggling display:none.

Design is ultra-dark, monochromatic. See the color tokens in CLAUDE.md — this is critical, the app must look premium. No bright colors except tiny green/amber status dots.

Verify: App launches, clicking steps switches between 4 empty phase panels, dark theme looks correct.

## Step 3: Phase 1 — Static Getting Started guide

Full-width card with scrollable content:
- Naming convention explanation with code examples
- Folder structure recommendation
- Recording tips
- "Download Template Folders" button that opens a Tauri save dialog and creates empty articulation subfolders
- Large "I'm Ready — Import Samples" button at the bottom that advances to Phase 2

Verify: Guide displays correctly, template folder download works via Tauri dialog.

## Step 4: Phase 2 — File import and parsing

This is the biggest phase. Build these sub-components:

### 4a: Drop zone + file parser
- Implement parser.js following reference/parser-spec.md exactly
- Drop zone at top of right panel — user drags a folder
- Tauri file drop event reads all .wav files recursively from the directory
- Each filename runs through the parser regex
- Populate the sample list with parsed metadata
- Auto-detect instrument name from first matched file

### 4b: File list panel (left, 300px)
- Scrollable list of all files
- Each row: green/amber dot, monospace filename (truncated), pitch label
- Clicking selects and shows detail on right
- Header shows matched/unmatched count badges

### 4c: Keyboard mapper (top of right panel)
- Visual piano spanning min to max MIDI note range (+3 semitone padding)
- White keys as flex divs, black keys as negative-margin overlays
- Mapped keys get subtle white highlight, suggested get amber
- Note labels below each white key

### 4d: Sample detail (bottom of right panel)
- Matched files: read-only metadata display + Preview button (Web Audio API playback)
- Unmatched files: editable dropdowns (Note, Accidental, Octave, Velocity, Articulation, Round Robin) + Apply button

### 4e: Validation
- At least 1 sample mapped before Phase 3
- No duplicate mappings
- Mixed sample rate warning (non-blocking)

Verify: Drop a folder of correctly-named .wav files → see green dots, keyboard highlights → click files to see detail → preview plays audio.

## Step 5: Phase 3 — Template configuration

Two-column layout:
- Left: instrument preview showing instrument name, knob grid (SVG arcs), FX chain pills
- Right top: 2×4 grid of control toggles (Volume, Pan, Attack, Release, Tune, Cutoff, Res, Reverb)
- Right bottom: 4 effect toggles (Filter, EQ, Reverb, Delay) with descriptions

Toggling controls shows/hides knobs in the preview. Toggling effects updates the FX chain display. Store configuration in state for the KSP generator.

Knob rendering: SVG circle arcs with 270° sweep. Track at rgba(255,255,255,0.04), value at rgba(255,255,255,0.35). Value label centered in monospace.

Verify: All toggles work, preview updates live.

## Step 6: Phase 4 — KSP generation and export

This is the critical path. Study reference/ksp-template.ksp carefully.

### 6a: Build summary card
- 3×2 grid: Instrument, Samples, Articulations, Vel Layers, RR, Template

### 6b: KSP script generator (ksp-gen.js)
Implement a function that takes the sample map + template config and returns a complete KSP script string. Following the reference template:
- Declare UI knobs for each enabled control
- Generate one if/else mapping block per sample (matching zone name to MIDI params)
- Key ranges from mapper.js assignments
- Velocity splits calculated per note (how many layers at that pitch)
- Round robin group assignment (rr1 → group 0, rr2 → group 1)
- Effect chain insertion for enabled effects
- UI control handlers for each enabled knob
- Round robin cycling in on_note (if any samples have rr > 1)

### 6c: Exporter
- Tauri save dialog for output directory
- Create folder structure: Samples/[Articulation]/, Scripts/
- Copy sample files into organized subfolders (use Tauri fs)
- Write .ksp script file
- Write setup guide from reference/setup-guide-template.txt with all placeholders filled

### 6d: Build UI
- Progress bar with 8 stage labels
- Completion screen with checkmark, "Open Folder" button (Tauri shell open)

Verify: Full export produces correct folder structure with valid .ksp file. Open the .ksp in a text editor — it should be syntactically valid KSP.

## Step 7: Integration test

Create 3 test WAV files (even just silence — use Web Audio to generate test tones if needed):
```
Test_Plucked_C3_v1_rr1.wav
Test_Plucked_E3_v1_rr1.wav
Test_Plucked_G3_v1_rr1.wav
```

Run the full pipeline:
1. Launch app
2. Go to Phase 2, import the test samples
3. Verify all 3 show green, keyboard maps correctly
4. Phase 3: leave defaults
5. Phase 4: export
6. Open the output .ksp file and verify zone mapping is correct

If this works, the MVP is complete.
