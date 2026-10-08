# SampleArchitect

Desktop app that turns a folder of named WAV samples into a playable sampler instrument.

1. Record your instrument and name the files `Instrument_Articulation_NoteOctave_vVelocity_rrRoundRobin.wav`, e.g. `Kantele_Plucked_C3_v1_rr1.wav` (sharps use `s`: `Cs3` = C#3).
2. Drop the folder into SampleArchitect (or use **Choose Folder…**). Check the mapping on the keyboard, fix unmatched files, and optionally trim leading silence.
3. Pick the controls and effects you want.
4. **Build Instrument**. You get:
   - **Decent Sampler** (free): a ready-to-play `.dspreset`. Open it and play.
   - **Kontakt 6+**: samples, a KSP performance script, a GUI skin, and `Setup Guide.txt` with the mapping steps. Kontakt only creates `.nki` files itself, so the Kontakt route takes a few manual steps.

Everything runs locally. No account is needed and nothing is uploaded. The optional AI recording-plan assistant (Step 1) only runs if you add your own Anthropic API key in Settings.

Middle C is **C3 = MIDI 60** (Kontakt's convention).

## Install from source

Prerequisites:

- Node.js 18+ and npm
- Rust (stable) via [rustup](https://rustup.rs)
- Platform libraries for Tauri 2 ([official list](https://v2.tauri.app/start/prerequisites/)):
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Windows: Microsoft C++ Build Tools and WebView2 (preinstalled on Windows 10/11)
  - Debian/Ubuntu: `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev`

```bash
npm ci
npm run tauri:dev      # run the app in development
npm run tauri:build    # build installers into src-tauri/target/release/bundle/
```

## Tests

```bash
npm test               # generators, parser, mapping, sanitizers (Node, no deps)
npm run test:rust      # Rust commands (WAV header reader, path decoding)
npm run test:e2e       # full UI journeys in headless Chromium with a filesystem-backed IPC shim
```

`test:e2e` needs a Chromium. It uses the Playwright browser cache, `/opt/pw-browsers`, or `CHROMIUM_PATH`.

On Linux you can also drive the real built app:

```bash
sudo apt install webkit2gtk-driver xvfb && cargo install tauri-driver
npx tauri build --no-bundle
xvfb-run node tests/tauri-smoke.js
```

## Project layout

```
src/                 frontend (vanilla HTML/CSS/JS, no build step)
  js/parser.js       filename parser, sanitizers, version
  js/mapper.js       key/velocity ranges, validation
  js/ksp-gen.js      Kontakt script generator
  js/dspreset-gen.js Decent Sampler preset generator
  js/exporter.js     output folder + setup guide
  js/app.js          UI controller
src-tauri/           Rust backend (file IO, WAV headers, optional API proxy)
reference/           original specs (parser, KSP reference, templates)
tests/               end-to-end tests
docs/mvp-completion/ audit, plan, decisions, verification and release notes
```

## Known limitations

See [docs/mvp-completion/release-handoff.md](docs/mvp-completion/release-handoff.md#known-limitations).

## Feedback

Please file bugs and requests as GitHub issues on this repository.
