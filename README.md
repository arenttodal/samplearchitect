# SampleArchitect

AI-powered sample instrument builder. Drag in your WAV samples, configure controls, export a playable Kontakt instrument.

## Prerequisites

Before running Claude Code, install these:

### 1. Rust toolchain
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```
Restart your terminal after installing. Verify: `rustc --version`

### 2. Node.js (v18+)
You likely already have this. Verify: `node --version`

### 3. Tauri CLI
```bash
cargo install tauri-cli --version "^2"
```
This takes a few minutes to compile. Verify: `cargo tauri --version`

### 4. macOS-specific (you're on macOS)
Xcode Command Line Tools should already be installed. If not:
```bash
xcode-select --install
```

## Quick Start

```bash
# After Claude Code builds the project:
cd samplearchitect
npm install
cargo tauri dev
```

## Project Structure

```
samplearchitect/
├── CLAUDE.md                  ← Build instructions for Claude Code
├── README.md                  ← This file
├── reference/                 ← Spec files (read-only reference)
│   ├── parser-spec.md
│   ├── ksp-template.ksp
│   ├── chromatic-template.json
│   └── setup-guide-template.txt
├── src-tauri/                 ← Rust/Tauri backend
│   ├── src/main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                       ← Frontend (vanilla HTML/CSS/JS)
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js
│   │   ├── parser.js
│   │   ├── mapper.js
│   │   ├── keyboard.js
│   │   ├── template.js
│   │   ├── ksp-gen.js
│   │   ├── exporter.js
│   │   └── audio.js
│   └── assets/
└── package.json
```

## Testing

Record 3 WAV samples of anything (C3, E3, G3), name them:
```
Test_Plucked_C3_v1_rr1.wav
Test_Plucked_E3_v1_rr1.wav
Test_Plucked_G3_v1_rr1.wav
```

Import into SampleArchitect → Configure → Export → Load in Kontakt → Play a C major chord.
