# SampleArchitect 1.2.0 (beta): release notes

Turn a folder of named WAV samples into an instrument you can play: a ready-to-play **Decent Sampler** preset and a **Kontakt 6+** kit with a mapping guide.

## Fixed
- **Kontakt:** scripts for instruments with round robins failed to compile (a variable was declared outside `on init`). Round-robin cycling also no longer silences every other note when the instrument doesn't have one group per round robin.
- **Decent Sampler:** the Cutoff knob closed the filter to ~1 Hz, which made instruments nearly silent. It now sweeps 33 Hz–22 kHz.
- **Decent Sampler:** Pan now spans full left/right. Delay time is applied correctly. Knobs point at the right effect when Filter is off.
- **Decent Sampler:** instruments with several articulations no longer play them all at once. An **Articulation** menu switches between them.
- Instrument names containing `/`, quotes or other special characters no longer break file paths, the KSP script or the interface.
- Trimming leading silence no longer resamples audio or reduces 24-bit samples to 16-bit.
- Exporting again no longer overwrites the previous export. The new one goes to `Name (2)`.

## New
- **Choose Folder…** button, so import works without drag-and-drop. You can re-import a different folder at any time.
- Import checks every WAV header: unreadable files are flagged and skipped, and mixed sample rates are reported.
- Clear messages for empty folders, duplicate mappings, out-of-range notes and build failures. A failed build can be retried.
- Manual note assignments can be edited or undone.
- Setup guide rewritten: honest Kontakt mapping steps and a full zone table (root, key range, velocity range, round robin).
- Keyboard-accessible toggles and visible focus.
- App icon set and installer configuration.

## Known limitations
- Kontakt `.nki` files can only be created inside Kontakt. Mapping zones takes a few manual steps (see `Setup Guide.txt`). Kontakt round robins need one group per round robin, and Kontakt articulation switching is not generated.
- Neither Kontakt nor Decent Sampler loading was tested in this release cycle. Both outputs are checked against their documentation and by automated tests only.
- No EQ effect. Delay is a fixed stereo echo, not tempo-synced.
- Installers are unsigned (macOS Gatekeeper / Windows SmartScreen will warn).
