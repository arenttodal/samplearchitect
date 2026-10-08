# Release handoff: SampleArchitect 1.2.0 (beta)

**Status: verified local release candidate. Not published.** Everything that can be checked without Kontakt or Decent Sampler passes, including the real desktop binary. What's left is one manual check in the two samplers and the owner decisions below.

- Branch: `claude/affectionate-mayer-njhc3v` (pushed). Base: `main` @ `d9684f2`.
- Records: [audit](audit.md) · [plan](plan.md) · [decisions](decisions.md) · [verification](verification.md) · [release notes](release-notes-1.2.0.md)

## Remaining before a public beta

| Item | Type | Exact next action |
|---|---|---|
| Play-test in Decent Sampler | Release blocker (external: needs the host) | Build any instrument with C3/E3/G3 (e.g. `test-samples/`), open `Decent Sampler/<Name>.dspreset`, play a C-major chord, turn every knob, and with 2 articulations switch the menu |
| Play-test in Kontakt 6/7 | Release blocker for the Kontakt claim (external: needs Kontakt) | Follow `Setup Guide.txt` exactly. Confirm the script applies with no error, the skin loads, knobs respond, and a chord plays. Also confirm the Auto-map menu wording in the guide. If anything differs, the guide text is in `src/js/exporter.js` `generateSetupGuide` |
| macOS / Windows installers | External (needs those OSes; signing certs optional) | On each OS: `npm ci && npm run tauri:build`. Unsigned builds work but show Gatekeeper/SmartScreen warnings |
| Publishing | Owner action, not authorized | Merge the branch, tag `v1.2.0`, attach the bundles to a GitHub release with `release-notes-1.2.0.md` |

## Decisions for you

None of these blocks a private beta. Defaults are in place.

1. **CLAUDE.md vs. the shipped product (D1).** CLAUDE.md still says "no AI, no Decent Sampler". I kept both, because the later commits are deliberate. *Recommendation:* update CLAUDE.md's "What NOT to build" list so future work isn't steered backwards. If you'd rather drop either feature, tell me.
2. **License (D18).** `package.json` says `ISC` (npm's default), which signals open-source permission. *Recommendation:* set your real license, or `UNLICENSED` for proprietary, before publishing.
3. **Positioning (D16).** Provisional free beta. The app has zero running costs (fully local), so a free beta costs nothing to operate. Change the copy in README/release notes if you prefer otherwise.
4. **App icon (D14).** Generated from the in-app "S" badge because the committed icon was a blank 32 px placeholder. Swap in real artwork any time (reversal steps in decisions.md).
5. **Kontakt KSP manual PDF in `site/`.** This is Native Instruments' copyrighted manual. *Recommendation:* don't publish it with the site. Link to NI's download instead. I left it untouched.
6. **AI assistant model (D17).** Still `claude-sonnet-4-5-20250929`, which is still active. Optional upgrade to `claude-sonnet-5-5` in `src-tauri/src/lib.rs` (changes cost and behaviour).

## What now works (and what changed)
- Full journey: guide → import (drop or **Choose Folder…**) → mapping with WAV checks → trim → controls/effects → build → open folder or guide. Every failure path shows a message and lets you recover.
- **Decent Sampler output** is ready to play. Fixed: filter silencing the instrument, pan, delay, wrong effect targets, articulations stacking.
- **Kontakt output**: the script compiles with round robins and can't silence notes. The guide is honest about the manual mapping steps and includes a zone table.
- Safety: names and articulations are sanitized for paths and KSP, markup is escaped, CSP is on, and exports never overwrite earlier ones.
- Audio: trimmed samples keep their native rate and 24-bit depth. Large files cross IPC as raw bytes.
- Packaging: version 1.2.0 everywhere, icons, bundle config, Linux `.deb`/`.rpm`/`.AppImage` built.

## Known limitations
- Kontakt: mapping is manual (Kontakt only creates `.nki` itself). Round robins need one group per rr. No articulation switching.
- No EQ. Delay is a fixed 250 ms echo, not tempo-synced.
- Note names in filenames use a single-digit octave (0–9), and notes must fall within MIDI 0–127 (C-2…G8).
- Installers are unsigned. macOS/Windows builds not produced here.

## Deferred (post-MVP, prioritized)
1. Kontakt articulation keyswitches, and RR per articulation.
2. Tempo-synced delay and an EQ, implemented in both generators.
3. Sample-loop points / release triggers.
4. Bundle the Inter font locally (CLAUDE.md asks for it; the system fallback is used now).
5. Code signing and notarization. Publish a CI release workflow.
6. Unify Kontakt and DS sample folders, to avoid copying samples twice when both formats are built.

## How to run, review, release

```bash
git checkout claude/affectionate-mayer-njhc3v
npm ci
npm test && npm run test:rust && npm run test:e2e
npm run tauri:dev                 # try it
npm run tauri:build               # installers → src-tauri/target/release/bundle/
```

Review commit by commit (`git log d9684f2..`). The icon is its own commit, so you can reject it independently.

**Rollback:** nothing persistent changes. To revert, `git revert` the commits, or reset `main` to `d9684f2` if the branch was merged and you want the old behaviour back. The only stored state is the optional API key in WebView `localStorage` under `sa_api_key`, and its format is unchanged.
