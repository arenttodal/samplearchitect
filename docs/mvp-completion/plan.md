# MVP release plan

## Product brief
SampleArchitect is a free, local, offline desktop app. You record an instrument, name the WAVs `Instrument_Articulation_NoteOctave_vN_rrN.wav`, drop the folder in, choose controls, and build. The build produces a **ready-to-play Decent Sampler preset** (no manual steps) and a **Kontakt kit**: samples, KSP performance script, skin and a step-by-step mapping guide. The AI concept assistant is optional (bring your own Anthropic key).

## Primary journey → acceptance criteria
1. Launch → static guide visible, with no key and no network needed. *(AC1)*
2. Import by drop **or** "Choose Folder…" → files listed with matched/unmatched counts, keyboard shows mapped keys, hidden files are skipped, an empty folder gets an explanation. *(AC2)*
3. Unreadable WAVs and mixed sample rates are reported. Duplicates block progress with a clear message. Unmatched files can be assigned, edited and range-checked. *(AC3)*
4. Configure controls/effects/format → Build → choose a location → progress → completion. Output goes into a new folder and never overwrites an earlier build. *(AC4)*
5. The output `.dspreset` references only files that exist. Knob bindings target existing effects with valid ranges. Multi-articulation instruments have an articulation menu. *(AC5)*
6. The KSP script declares variables only in `on init` and has no unescaped quotes. RR cycling can't silence notes. *(AC6)*
7. A build failure shows an error and the user can retry. Open Folder / Setup Guide work. *(AC7)*
8. Trimmed samples keep their sample rate and bit depth (16/24). *(AC8)*
9. Reproducible build: `npm ci && npm test && npm run test:e2e && npm run tauri:build` on a clean checkout. *(AC9)*

## Scope
**Release blockers:** F1–F11 (audit.md), F14.
**Release improvements:** F12 (IPC bytes), F13 (Kontakt guide accuracy), README/first-use docs, release notes.
**Deferred:** Kontakt zone auto-mapping without manual steps (needs Kontakt 7 Creator Tools/Lua or a verified approach), EQ effect, KSP articulation keyswitches, FX parameter knobs for delay, Inter font bundling, code signing/notarization, CI workflow publishing, the marketing site.

## Milestones
| M | Outcome | Changes | Verify | Done when |
|---|---|---|---|---|
| M1 | Generators produce valid output | `ksp-gen.js`, `dspreset-gen.js`, shared sanitizers | Extend `test-integration.js` | F1–F5 tests pass |
| M2 | Safe import/export | Rust `read_wav_info`, byte IPC, `exporter.js` sanitizing, unique output dir, native-rate trim | Unit + `cargo test` + E2E | F6, F7, F11, F12 covered |
| M3 | Recoverable UI | Choose Folder, re-import, phase-scoped drop, error/empty states, edit assignment, build retry | `tests/e2e.js` journeys 1–3 | E2E passes with no console errors |
| M4 | Release candidate | versions, tauri bundle config, README, guide text, release notes | `cargo tauri build` artifact, launch under Xvfb, fresh-clone run | Artifact built and launches |

Status is tracked in verification.md.
