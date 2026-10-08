# Audit — SampleArchitect MVP completion

Starting revision: `d9684f2` (main, merge of PR 25), branch `claude/affectionate-mayer-njhc3v`, clean working tree, no pre-existing local changes.
Audit date: 2026-10-08.

## What the product is

- **User:** a musician or small sample-library maker who records their own instrument and wants a playable software instrument without learning sampler scripting.
- **Problem:** turning a folder of WAV takes into a mapped, playable instrument is tedious and technical (key ranges, velocity splits, round robins, UI script).
- **Core promise:** *Drop a folder of convention-named WAVs, pick controls, and get an instrument you can load and play in a sampler.*
- **Must work unaided:** name files → import → see mapping → configure → build → follow the generated guide → play a chord.
- **Positioning evidence:** none in the repo beyond "by Evenant" and "Decent Sampler (free)" copy. No pricing, licensing or store code. Treated as a free beta (see decisions.md).

## Stack and boundaries

| Area | Finding |
|---|---|
| Shell | Tauri 2 (`src-tauri/`), Rust commands in `src-tauri/src/lib.rs` |
| Frontend | Vanilla HTML/CSS/JS in `src/`, globals, no bundler (matches CLAUDE.md) |
| Outputs | Kontakt: KSP script + resource container (wallpaper/knob PNG) + samples + guide. Decent Sampler: `.dspreset` + samples |
| External services | Optional Anthropic API chat (Phase 1) via Rust `reqwest`, user-supplied key in `localStorage` |
| Data stores | None (state in memory; API key in `localStorage`) |
| Tests | `node test-integration.js` (vm-based unit tests of parser/mapper/generators). No UI tests, no Rust tests, no CI |
| Packaging | `cargo tauri build` / `npm run tauri:build`; `tauri.conf.json` has no `bundle` section and a wrong `$schema` URL |
| Other | `site/` holds a marketing page + the Kontakt 6.0.2 KSP manual PDF (third-party, NI copyright) |

## Plans vs. implementation (contradictions)

CLAUDE.md (the original MVP brief) says *no AI chat, no Decent Sampler export*. Later commits (V1.1–V1.2, March 2026) deliberately added: an opt-in AI concept assistant, Decent Sampler export, silence trimming, a draggable knob layout builder, a Kontakt GUI skin, and MIDI preview. Commit history also shows the owner tested in real Kontakt and **removed** the brief's zone-remapping KSP (`set_zone_par` loop) because it errored, switching to "map in Kontakt's Mapping Editor, then paste the script".

Interpretation: the later commits are the current product intent. Those features are kept. The AI assistant stays opt-in, so the no-key path is the static guide the brief asks for. CLAUDE.md is left unchanged because it is the owner's file; the conflict is recorded in decisions.md (D1).

## Baseline results (before changes)

| Check | Result |
|---|---|
| `node test-integration.js` | PASS (23 groups) |
| `cargo build` (src-tauri) | PASS once webkit2gtk-4.1 dev libs were installed (Linux) |
| Launch debug binary under Xvfb | PASS. The window renders the Phase 1 guide |
| E2E through the UI | No harness existed. Added `tests/e2e.js` |
| Kontakt / Decent Sampler load | Not possible here (no hosts available). Never verified in this session |

## Findings

Confidence: H = reproduced or confirmed against primary docs, M = strong inference, L = plausible.

| # | Journey | Evidence | Impact | Fix | Conf |
|---|---|---|---|---|---|
| F1 | Kontakt export, any round robins | `ksp-gen.js` emits `declare $g` inside `on note`. KSP manual 6.0.2 §variables: "All user defined variables must be declared in the on init callback." | The script fails to compile in Kontakt whenever any rr>1 | Declare `$g` in `on init` | H |
| F2 | Kontakt RR | The RR loop calls `disallow_group` on group 0 for every other note. The guide never tells users to make one group per RR, so typically only 1 group exists | Every other note is silent | Cycle only when `$NUM_GROUPS >= maxRR`. Guide explains the group-per-RR setup | H |
| F3 | Decent Sampler, default config | Cutoff knob 0–1 bound to `FX_FILTER_FREQUENCY` (Hz, 0–22000 per DS docs) with value 1 | Filter at ~1 Hz, so the instrument is close to silent out of the box | Use a 0–1 knob with a Hz translation table (DS boilerplate) | H |
| F4 | DS controls | Pan knob −1..1 against a −100..100 parameter (barely moves). Delay uses `delayTimeMS` (not a DS attribute). Resonance 0–1 against 0–5. Effect `position` indices hard-coded (filter=0, reverb=1) and wrong when filter is off. Cutoff/res/reverb knobs bind to missing effects when those effects are off | Knobs do nothing or move the wrong effect | Compute positions from the emitted effects. Drop knobs whose target effect is absent. Correct ranges and attributes | H |
| F5 | DS, >1 articulation | All groups are enabled together | Articulations stack: every note plays all articulations at once | Tag groups per articulation, disable all but the first, add an articulation `<menu>` with `TAG_ENABLED` bindings (DS docs) | H |
| F6 | Security / robustness | Instrument name (from a filename token or user input) goes unescaped into `innerHTML`, KSP strings, the KSP comment, and output file paths. Free-text articulation goes into a folder path | A crafted filename runs script with full fs IPC. `/` or `..` in a name or articulation writes outside the export folder. A `"` breaks KSP compile | Escape HTML. Sanitize names for paths and KSP | H |
| F7 | Import | Promised mixed-sample-rate warning not implemented (code comment says it needs backend). Non-WAV or corrupt `.wav` files are accepted silently | Bad exports, confusing failures | Add `read_wav_info` Rust command. Warn on mixed rates, error on unreadable files | H |
| F8 | Import | Drop zone hides after the first import, so you can't change folders without restarting. Drag-drop is processed on every phase and silently replaces the samples. Drop is the only way to import (no button or keyboard path). Errors only go to `console` | Dead ends | "Choose Folder…" button (dialog), drop only on Phase 2, visible error and empty states | H |
| F9 | Manual assignment | B8 → MIDI 131 accepted. A manual assignment can't be edited after Apply | Invalid zones | Range check. "Edit mapping" on manual items | H |
| F10 | Build | A failure leaves the button hidden and a progress label with raw error. Rebuilding into the same folder silently overwrites. Template-folder creation has no feedback | No retry path, possible overwrite of earlier exports | Error panel + retry. Unique output folder. Status text | H |
| F11 | Trimmed export | Decodes at the AudioContext rate (resamples, e.g. 44.1→48 kHz) and always writes 16-bit | Silent quality loss and sample-rate change on trimmed files | Decode at the file's native rate (OfflineAudioContext). Write 24-bit when the source is ≥24-bit | H |
| F12 | Performance | Bytes cross IPC as JSON number arrays both ways | Slow and memory-heavy on large WAVs | `tauri::ipc::Response` for reads, raw body for writes | M |
| F13 | Kontakt guide | "Kontakt will auto-map them by reading note names from the filenames" isn't accurate without Auto-map setup. Sharps are spelled `s`. Velocity/RR splits aren't automatic | Wrong pitches or stacked layers in Kontakt | Guide explains Auto-map token setup and includes a full zone table (root/key range/vel range/group) for manual check | M |
| F14 | Release | Versions disagree (1.0.0 in package/tauri, v1.2 in UI). Bogus `$schema`. No `bundle` config. README says "AI-powered" | Packaging/support confusion | Align to 1.2.0, add bundle config, update README | H |
| F15 | AI assistant | Hard-coded model id `claude-sonnet-4-5-20250929` | May stop working when retired. Optional feature | Flag for owner (decisions) | M |
| F16 | Docs/assets | `site/KONTAKT_602_KSP_Reference_Manual.pdf` is NI's copyrighted manual committed to the repo, and `site/` is a public-facing page | Licensing risk if the site is published with it | Owner decision. Left untouched | M |

Not issues: the parser matches the spec. MIDI math matches Kontakt (C3=60). The key-range gap fill matches the spec. The knob strip/wallpaper `.txt` format matches commits verified against Kontakt.
