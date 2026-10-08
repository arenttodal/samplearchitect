# Verification record

Environment: Linux x86_64 cloud container, Node 22.22, Rust/cargo 1.97, Tauri 2.10.2, WebKitGTK 2.52 (webkit2gtk-4.1), Chromium 1194 (Playwright), Xvfb. Date: 2026-10-08.

## Results (final revision on branch `claude/affectionate-mayer-njhc3v`)

| Check | Command | Kind | Result |
|---|---|---|---|
| Unit/integration: parser, MIDI math, key/velocity ranges, KSP + DS generators, sanitizers, version/bundle consistency | `npm test` | automated | **PASS** (27 groups, incl. new 24–27 + extended 23) |
| Rust: WAV header reader (basic, odd-sized chunks, non-WAV, truncated), path decoding | `npm run test:rust` | automated | **PASS** (4 tests) |
| UI journeys in Chromium against the shipping frontend + filesystem-backed IPC shim (import → map → trim → configure → build → open; unmatched/duplicate/out-of-range/mixed-rate/unreadable; empty folder; build failure + retry; template folders; no-overwrite rebuild; drop ignored outside Samples; HTML/path/KSP escaping) | `npm run test:e2e` | automated | **PASS** (54 checks, no console errors) |
| Real desktop binary (release build, CSP on) through tauri-driver/WebKitWebDriver: Rust `read_dir_recursive`/`read_wav_info`, raw-byte `read_file_bytes`/`write_file_bytes`, WebKit audio decode at native rate, full build, 24-bit trimmed output | `xvfb-run node tests/tauri-smoke.js` | automated | **PASS** (14 checks) |
| Release bundles | `npx tauri build` | build | **PASS**: `.deb`, `.rpm`, `.AppImage` (Linux) |
| App launch and first screen | debug + release binary under Xvfb, screenshot | manual | **PASS** |
| Fresh clone of the branch: `npm ci && npm test && npm run test:e2e` | temp clone | automated | **PASS** |
| Visual review of Samples (warnings/duplicate error), Template, Export (complete/error) screens | E2E screenshots (`E2E_SCREENSHOTS=dir`) | manual | Reviewed. Fixed Phase 4 centering, badge wrapping, config panel overflow |

Baseline before changes: `node test-integration.js` passed. `cargo build` passed after installing webkit2gtk. No UI or Rust tests existed.

## Regression evidence for the main fixes
- KSP `declare` inside `on note` was present in the baseline output (reproduced with the old generator). Test 24 now asserts that no callback after `on init` declares anything and that RR is guarded.
- DS cutoff `minValue=0 maxValue=1` bound to `FX_FILTER_FREQUENCY`, `delayTimeMS`, pan ±1: all reproduced from the baseline generator. Tests 25–26 cover the fixes, the effect positions and the articulation menu.

## Not verified (no access in this environment)
- **Loading the outputs in Kontakt or Decent Sampler.** No host was available. The KSP was checked against the bundled Kontakt 6.0.2 manual, and the `.dspreset` against the DS developer guide (GitHub source). The owner's original pass criterion (play a C-major chord in a DAW) still needs a manual run. Steps are in release-handoff.md.
- macOS and Windows builds, signing and notarization. WebView2 behaviour.
- Real drag-and-drop from Finder/Explorer. The drop event path is covered with a simulated `tauri://drag-drop` event. The native dialogs (`dialog.open/save`) were stubbed in the real-app smoke test.
- MIDI device input. The optional Anthropic API assistant (needs a key; code unchanged).
- The CI workflow (`.github/workflows/ci.yml`) has not run on GitHub yet.
