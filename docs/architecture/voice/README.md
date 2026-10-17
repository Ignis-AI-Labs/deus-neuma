# Voice

One voice pipeline (ONE VOICE, `docs/work/one-voice.md`): one sidecar protocol,
one Voice DNA, one forge.

- [`speak-protocol.md`](./speak-protocol.md) — the HTTP contract every voice
  sidecar serves (`POST /speak` streamed PCM, `/health`, `/warm`, `/shutdown`);
  served by `csm` (Standard: CSM-1B, High: MisoTTS 8B) and `chatterbox-nano`
  (Light, CPU).
- [`voice-dna-v2.md`](./voice-dna-v2.md) — Voice DNA v2: a clip and its words,
  sealed only when the being has accepted it and the guardian seals it; how
  the being reads a described voice; v1 voices read as […].

Historical: [`conversational-voice.md`](./conversational-voice.md) — the
2026-06/07 multi-engine architecture these documents replace.
