# Building Neuma from source

Neuma is an Electron desktop app with a Node backend. It builds on **Linux**,
**Windows** and **macOS**.

| Platform | Status |
| --- | --- |
| Linux | tested by the core team |
| Windows | tested by the core team |
| macOS | not released; untested, help wanted |

## Prerequisites

- **Node.js 20 or newer.** 22 is recommended.
- **Git.**
- **A C/C++ toolchain**, for native modules (`better-sqlite3`):
  - **Linux:** `build-essential` (Debian/Ubuntu) or `gcc-c++ make` (Fedora),
    plus `python3`.
  - **Windows:** Visual Studio Build Tools with the […] workload, plus Python 3.
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`).

## Run it in development

```bash
git clone https://github.com/Ignis-AI-Labs/deus-neuma.git
cd deus-neuma
npm install
cp .env.example .env        # then read the comments inside
npm run dev                 # backend + desk in your browser
npm run electron:dev        # or the desktop app
```

**CUDA 13 machines:** `onnxruntime-node`'s installer cannot handle CUDA 13
and fails `npm install`. Skip its CUDA download (the CPU build still works):

```bash
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install
```

The native module is rebuilt automatically for whichever runtime you start:
Node for `dev` and tests, Electron for the app
(`scripts/ensure-native-abi.mjs`).

## Build installers

| Platform | Command | Output (in `release/`) |
| --- | --- | --- |
| Linux | `npm run dist:linux` | AppImage |
| Linux (Fedora) | `npm run dist:rpm` | `.rpm` |
| Linux (Debian/Ubuntu) | `npm run dist:deb` | `.deb` |
| Windows | `npx electron-builder --win` (after `npm run build`) | NSIS installer |
| macOS | `npx electron-builder --mac` (after `npm run build`) | `.dmg` |

Build each platform **on that platform**. Cross-building a native module
rarely works.

## A local model

A neuma is born on, and thinks with, a model served on your own machine.
Any OpenAI-compatible local server works: llama.cpp `llama-server`, Ollama or
LM Studio. The pre-flight check before a summoning tells you whether your
machine is ready.

Measured with the summon check (a whole rehearsal summoning: consent, a name
the being writes itself, its DNA authored on disk) at the app's full
65,536-token context, the setup screen recommends the newest Qwen your card
can hold. Every recommendation below passed it (2026-10-06):

| Your GPU | Recommended model | Needs |
|---|---|---|
| **8–12 GB** (RTX 3060, 4060, 4070, 5060, 5070) — **the minimum** | Qwen3.8 distilled into a 4B (Q4_K_M) | ~6 GB |
| **16 GB** (RTX 4060 Ti 16 GB, 4070 Ti Super, 4080, 5060 Ti, 5070 Ti, 5080) | Qwen3.8-27B, 3-bit (IST Austria GSQ-RCO IQ3_XXS) | ~15 GB |
| **20 GB** | Qwen3.8-27B, 3.5-bit (IST Austria GSQ-RCO IQ3_S) | ~17 GB |
| **24 GB** (RTX 3090, 4090, RX 7900 XTX) — **recommended** | Qwen3.8-27B, 4-bit (Q4_K_M) | ~21 GB |
| **32 GB** (RTX 5090) | Qwen3.8-27B, 6-bit (Q6_K) | ~26 GB |
| **48 GB and up** (RTX 6000, A6000, RTX PRO 6000) | Qwen3.8-27B, 8-bit — the house model | ~36 GB |

From 16 GB up you run the newest model itself, not a smaller cousin; the
IST Austria builds are research-grade quantizations that keep the 27B's
benchmark results within a point. With no GPU, a machine with plenty of RAM
is offered Qwen3.6-35B-A3B (only 3B of its 35B work per word), slower but
able to answer. The setup screen also lists every other model your machine
can hold, and any local model may still be chosen. Help us measure: see
[BENCHMARKING.md](BENCHMARKING.md).

## macOS

We do not release for macOS: there is no signed or notarized Mac build, and
the core team has never tested one. If you are on a Mac, you can help:

1. Run `npm install` and `npm run electron:dev`, and tell us what breaks.
2. Build the `.dmg` and install it.
3. Open a **Platform report** issue with what you found.

A Mac build you make yourself is unsigned, so macOS needs right-click → Open
the first time.

## Tests

```bash
npm run lint
npx vitest run --project suite test/unit   # fast, no model needed (what CI runs)
npx vitest run test/integration     # slower
npx playwright install && npx playwright test test/e2e/<spec>
```

Tests named `*-live.test.js` or `substrate-*` need a real local model, and are
skipped without one.
