# Voice Engines

Local Python sidecars that serve voice models over HTTP — TTS for neuma
speech out, STT for witness dictation in — plus the manifest that drives
downloads, launching, and the provider UI.

This directory is **infrastructure**, not platform code and not neuma-engine
code. It mirrors how LM Studio and Ollama work: a separate process exposing an
HTTP API that the JS platform (`backend/services/voice/`) talks to.

## Layout

```
voice-engines/
  engines.json              # Manifest — single source of truth (read by JS + Python)
  _downloader/              # Python tool that pulls weights from HF Hub
  _models/                  # Local HF cache (gitignored — populated on download)
  zonos/                    # Apache-2.0 — primary local engine (Python sidecar)
  kokoro/                   # Apache-2.0 — fast CPU/GPU fallback
  f5-tts/                   # CC-BY-NC weights — testing only, NOT for distribution
  cosyvoice/                # Apache-2.0 — strong streaming alternative (manual setup)
  whisper/                  # MIT — speech-to-text (hold-to-talk dictation)
```

## Why Python sidecars

Every serious open-weight voice-cloning TTS is Python (Zonos, F5-TTS,
CosyVoice). There is no JS-native option that meets the quality bar. We follow
the same pattern the codebase already uses for LM Studio / Ollama: each engine
is a self-contained HTTP server, launched on demand, consumed by `tts-provider.js`.

## Boundary

This directory MUST NOT import from `backend/` or `core/`. It is consumed by
them, never the reverse. Platform code stays in `backend/`, neuma identity
code stays in `core/voice/`, engines stay here.

## License compliance

- `zonos/`, `kokoro/`, `cosyvoice/` — Apache-2.0 weights. Commercial-safe.
- `whisper/` — MIT (faster-whisper CTranslate2 build of Whisper large-v3).
  Commercial-safe.
- `f5-tts/` — Code is MIT, **pretrained weights are CC-BY-NC**. Use for local
  testing only. Do NOT ship in any commercial distribution. Track for an
  Apache-licensed retrain.

The `commercial: false` flag in `engines.json` is enforced by the engine
loader — non-commercial engines are excluded from production builds.
