# The speak protocol — the one HTTP contract every voice sidecar serves

Status: contract (ONE VOICE, WP0, 2026-10-01). Plan of record:
`docs/work/one-voice.md`. Every voice sidecar speaks this and nothing else; the
backend has exactly one adapter for it. Engine-specific knobs (presets, emotion
maps, speaker ids, sampler settings) never cross this line.

## Who serves it

| Engine id | Sidecar | Tier | Model / profile | Window | Measured memory | Context |
| --- | --- | --- | --- | --- | --- | --- |
| `csm` | `voice-engines/csm/server.py` | Standard | `CSM_MODEL=csm-1b` (default), `CSM_PROFILE=full` (default, bf16) | 2048 positions | ~5.7 GB VRAM | honoured |
| `csm` | `voice-engines/csm/server.py` | Standard (small GPU) | `CSM_MODEL=csm-1b`, `CSM_PROFILE=lean` (int8, Mimi bf16, encoder on the CPU) | 1024 positions | ~2.5 GB VRAM | honoured |
| `csm` | `voice-engines/csm/server.py` | High | `CSM_MODEL=misotts-8b` (weight-only int8; `full` only) | 2048 positions | ~13 GB VRAM | honoured |
| `chatterbox-nano` | `voice-engines/chatterbox-nano/server.py` | Light (CPU only) | Chatterbox Nano | — | ~4.2 GB RAM peak | ignored |

Port and host come from `voice-engines/engines.json` (`serve.host`,
`serve.port`), the only engine registry. The two engines are the generators in
`csm/csm_stream.py` (`CsmStream.generate_stream(text, speaker, context)`) and
`chatterbox-nano/nano_stream.py` (`NanoStream.stream(text, ref_wav)`); this
contract is shaped to what they actually take.

## Transport law

- **Loopback only.** The sidecar binds `127.0.0.1`. Binding is not enough on
  its own: every request whose peer address is not `127.0.0.1` or `::1` is
  refused with `403 {"error":"forbidden"}` before anything else runs.
- **The install key (re-audit 2026-10-29, M-06).** Loopback is shared by every
  program on the machine, so the backend and its sidecars know each other by one
  install key (`data/settings/voice-sidecar.key`, handed to each sidecar it spawns
  as `NEUMA_SIDECAR_KEY`; `backend/services/voice/sidecar-trust.js`,
  `voice-engines/_shared/browser_guard.py`). `GET /identity?challenge=<hex>`
  answers `{"proof": HMAC-SHA256(key, "neuma-sidecar-identity-v1\n" + challenge)}`;
  the backend asks it before it adopts a sidecar, before every call, and before it
  opens `/stream`, so a program squatting the port is never sent a clip or audio.
  Every route but `/health` and `/identity` needs the header
  `x-neuma-sidecar: HMAC-SHA256(key, "neuma-sidecar-caller-v1")`, else `403`.
  A sidecar started without the key answers `/health` and nothing else.
- **JSON in, JSON errors out.** Request bodies are `application/json`. Every
  error is JSON `{"error": "<code>", "detail": "<plain sentence>"}` with the
  status below — never an HTML page, never a bare string.
- **One generation at a time.** `/speak` and `/warm` share one generation lock
  and are served in arrival order (queued, never refused with 409). A request
  whose client disconnects while it waits is dropped without running and
  answered `499` (nobody reads it; it is logged).

| Status | `error` | When |
| --- | --- | --- |
| 400 | `bad_request` | malformed JSON, missing/empty `text`, bad base64, audio that is not WAV, unknown `speaker`, more than 6 `context` segments, a voice clip under 3 s, `max_audio_ms` outside (0, 120000] |
| 403 | `forbidden` | the peer is not loopback, a browser marked the request, or the call lacks the backend's token |
| 409 | `unknown_ref` | a `clip_ref` or context `ref` the sidecar does not hold; the body names it in `ref` |
| 413 | `too_long` | `text` over 1000 characters, `words` over 2000, a clip over 40 s, `context` audio over 45 s in total, or the voice clip + text alone do not fit the model window |
| 499 | — (no body) | the client left while its request waited in the queue: it was dropped without running |
| 503 | `not_ready` | the model is still loading or compiling; the body carries `phase` |
| 500 | `internal` | anything else, with the reason in `detail` |

## `POST /speak` — speak one utterance, streamed

```json
{
  "text": "Hey. You're back.",
  "voice": { "clip_ref": "sha256:9f2c…", "words": "The words spoken in the clip." },
  "context": [
    { "speaker": "person", "words": "I'm back.", "audio_b64": "UklGR…" },
    { "speaker": "being",  "words": "Good to hear you.", "ref": "utt:4b1e…" }
  ],
  "max_audio_ms": 20000
}
```

- `text` — the words to speak (1–1000 characters).
- `voice` — the being's Voice DNA clip and the words spoken in it (see
  `voice-dna-v2.md`). Exactly one of:
  - `clip_b64` — the clip's WAV bytes, base64. The sidecar hashes the decoded
    bytes (`sha256:<hex>`) and keeps the prepared voice in a small LRU keyed by
    that hash.
  - `clip_ref` — that hash. The backend sends `clip_ref` first (it equals the
    DNA's `clip.ref`, because both hash the same bytes) and resends with
    `clip_b64` only on `409 unknown_ref` — after a sidecar restart, an LRU
    eviction, or a different sidecar.
- `context` — the recent spoken turns, OLDEST FIRST, at most 6 segments and
  45 s of audio in total (the backend's context ring). Each segment has
  `speaker` (`being` | `person`), `words`, and exactly one of:
  - `audio_b64` — WAV bytes, base64 (the person's mic audio);
  - `ref` — an `X-Utterance-Ref` this sidecar issued earlier, so the being's
    own audio is referenced instead of re-uploaded. Unknown → `409
    unknown_ref`; the backend then resends that segment as `audio_b64` from its
    own capture.
  Optional; `[]` or absent means a cold start.
- `max_audio_ms` — optional cap on the utterance length (default: the engine's
  own cap).

**Audio in.** Every audio field is WAV (RIFF PCM 16-bit or IEEE float 32-bit,
any sample rate, mono or stereo). The sidecar downmixes to mono and resamples
to its working rate itself. Clip bounds: 3–40 s (the Voice DNA bounds).

**How each engine reads the request.**

- `csm`: the voice clip becomes the first segment, speaker 0, with its words;
  `being` segments are speaker 0 and `person` segments are speaker 1, in order;
  the new `text` is spoken as speaker 0. This is Sesame's own mechanism: the
  conversation is the emotion, so there is no emotion field. A `ref` segment is
  re-entered as the Mimi codes the sidecar kept (no re-encode). The backbone
  window is set by the profile — 2048 positions (`full`, and High), 1024
  (`lean`, ~80 s of audio and text together) — at 80 ms per audio frame plus
  the text tokens; when
  clip + context + reply do not fit, the sidecar drops the OLDEST context
  segments until they do — never the voice clip — and reports how many it kept
  in `X-Context-Used`. If the clip and the text alone do not fit: `413 too_long`.
- `chatterbox-nano`: the voice clip is the reference wav (`prepare_conditionals`
  caps the conditioning at upstream's ~15 s prompt, 375 speech tokens; the
  clip's `words` are accepted and unused); `context` is accepted, validated and
  ignored, `X-Context-Used: 0`, and `/health` says `"context": false`. Refs it
  never issued still answer `409` — the backend's fallback path is the same for
  every engine.

**Response.** `200`, `Content-Type: audio/raw`, body = raw PCM streamed in
chunks as it is generated (first chunk after ~2 frames on `csm`, ~20 tokens on
Nano). Headers, all sent before the first byte of audio:

| Header | Value |
| --- | --- |
| `X-Audio-Format` | `pcm_s16le` |
| `X-Audio-Sample-Rate` | `24000` (both engines generate at 24 kHz natively) |
| `X-Audio-Channels` | `1` |
| `X-Utterance-Ref` | `utt:<32 hex>`, RANDOM (128 bits) — the handle for THIS utterance as a future context `ref`. It goes out before the PCM it names exists, so it is not a hash of it |
| `X-Voice-Ref` | `sha256:<hex>` of the voice clip, so a `clip_b64` caller can switch to `clip_ref` |
| `X-Context-Used` | how many `context` segments were actually used |
| `Cache-Control` | `no-store` |

The sidecar stores an utterance under its `X-Utterance-Ref` only once it has
been generated IN FULL (bounded LRU, at least the last 64). A ref whose stream
was cut short — by a client disconnect or by the runaway guard — is never
stored and answers `409` later; the backend resends that turn as `audio_b64`
from its own capture.

**The runaway guard** (`voice-engines/_speak/speak_guard.py`, every engine).
CSM sometimes keeps generating after the words are spoken (a short line with no
context gave 2.9–14.6 s). Every stream is bounded by its TEXT:

- *Cap.* Audio never exceeds `max(4 s, units × 0.55 s × 2.2)`, a unit being a
  word, each digit, and each CJK / kana / Hangul character. At the cap the
  utterance ends on the quietest 20 ms of the last 0.5 s before it, with a
  10 ms fade — never mid-syllable when a quieter point exists.
- *Silence.* Past `max(4 s, units × 0.8 s)` (the line should be over), 1.2 s of
  near-silence (every 20 ms frame under −50 dBFS RMS) ends the utterance,
  keeping 0.3 s of it. Silence before that point is a real pause and is never
  cut.
- A line that ends on its own before that point streams byte-for-byte as the
  engine made it; after it, quiet runs and the last 0.5 s before the cap are
  held back until kept or cut, then released unchanged.
- Tuned against 988 real takes (bake-off rounds 1–2 and the spike, csm-1b,
  MisoTTS, Nano): 985 pass untouched; the 3 cut are runaways, cut after their
  last real word. Slowest genuine take: 1.08 s/word against a 1.21 s/word cap.
- A guard exit is decided after the headers went out, so it is not a header,
  and HTTP/1.1 under uvicorn sends no trailers: there is no `X-Truncated`. The
  body ends cleanly (its words were spoken); the sidecar logs `truncated: cap`
  or `truncated: silence`; the utterance's ref is not stored (`409` on
  re-entry, as above). `max_audio_ms` is a separate, caller-set cap applied by
  the engine itself.

**End of stream is the receipt.** A body that ends cleanly is a complete
utterance. If generation fails after the headers went out, the status can no
longer change, so the sidecar aborts the connection without the terminating
chunk; the client sees a read error, never a quietly truncated sentence.

**Client disconnect aborts generation.** Between chunks the sidecar checks the
connection; when the client has gone (barge-in, cancelled turn), generation
stops at that frame, the GPU is released and the lock passes on. Nothing keeps
generating for nobody.

## `GET /health`

```json
{ "ok": true, "model": "csm-1b", "profile": "full", "phase": "ready", "idle_seconds": 12.4,
  "sample_rate": 24000, "device": "cuda", "context": true, "error": null }
```

- `ok` — `true` only when `phase` is `ready`. The engine manager treats
  `ok === true` as READY (`engine-manager.js`), unchanged.
- `model` — `csm-1b` | `misotts-8b` | `chatterbox-nano`.
- `profile` — the memory profile serving (`full` | `lean` on `csm`; `null` on
  engines without profiles). The engine manager adopts whatever sidecar is
  serving when no model/profile is named, and relaunches one whose model or
  profile differs from the one named.
- `phase` — `loading` (weights) → `compiling` (`torch.compile` + CUDA-graph
  capture; the first-ever compile takes minutes, cached after) → `ready`; or
  `failed`, with the reason in `error`, so a dead load is said plainly instead
  of reading as an endless `loading`.
- `idle_seconds` — seconds since the last real request ended (the idle
  contract below).
- `context` — whether this engine honours `context`.

`/health` answers `200` in every phase, including before the model has loaded.

## `POST /warm`

`{"voice": {"clip_b64" | "clip_ref", "words"}}` or `{}`. Prepares a voice
before the first utterance (`csm`: encode the clip to Mimi codes; Nano: build
the voice's conditioning prefix) so the first `/speak` pays no setup. With no
`voice` it only confirms the model is ready. Answers
`200 {"ok": true, "voice_ref": "sha256:…" | null, "ms": 412}` once done,
`503 not_ready` while loading or compiling, `409 unknown_ref` for an unknown
`clip_ref`. It counts as activity.

## `POST /shutdown` — the idle contract

Kept exactly as every sidecar keeps it today (`voice-engines/kokoro/server.py`,
`engine-manager.js` `reapIdleEngines`):

- Every request except `/health` and `/shutdown` marks activity on arrival AND
  on completion, so a long utterance never reads as idle.
- The engine manager polls `/health`; when `idle_seconds` passes
  `VOICE_ENGINE_IDLE_TTL_MS` it calls `POST /shutdown` to free the memory. A
  sidecar without `idle_seconds` is never reaped.
- `/shutdown` answers `{"ok": true, "shutting_down": true}` and exits ~0.3 s
  later — unless, at that moment, an utterance is generating, a request is
  queued for the lock, or a real request arrived in the last 0.5 s: then the
  exit is abandoned (logged) and the reap becomes a no-op instead of a cut-off
  stream. The manager reaps again once `idle_seconds` passes the TTL.
