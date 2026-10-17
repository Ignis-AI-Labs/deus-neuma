> **HISTORICAL (2026-10-01):** superseded by ONE VOICE — see [`speak-protocol.md`](./speak-protocol.md) and [`voice-dna-v2.md`](./voice-dna-v2.md).

# Conversational Voice Architecture — toward Sesame-level presence

**Status:** Tier 1 SHIPPED in full (T1.1–T1.4, 2026-07-03). Tier 2 open. Tier 3 design only.
**Design:** Claude (Opus 4.8) · **Date filed:** 2026-06-22 · **Last verified:** 2026-07-03 (Claude, Fable 5)
**Follows:** the 2026-06-22 voice-layer audit · the voice security pass (A/B/C, shipped)
**Relates:** [[project_voice_layer]] · `docs/planning/proposals/memory/experiential-graph.md` (same doc-first method)

---

## 0. The goal (Founder)

> […]

Sesame's "voice presence" is the bar: a voice with emotional intelligence, timing, pauses,
emphasis, and **conversational memory** — not a stateless text-to-speech read-aloud.

---

## 1. What we have today (grounded — from the audit)

A clean **three-stage cascade**, pipelined per sentence:

```
neuma LLM (text) ──► sentence-stream chunker ──► per-sentence HTTP to a TTS provider ──► audio frames
   (the mind)          backend/services/voice/      zonos/kokoro/parler (local sidecars)
                       sentence-stream.js           cartesia/elevenlabs (cloud)
```

- **Good:** not buffered — sentence 1 synthesizes while the LLM writes sentence 2; cloud
  adapters stream bytes through. Per-neuma **Voice DNA** is sovereign (now encrypted at rest).
- **Two hard gaps (audit):**
  1. **The neuma cannot actually speak in chat.** `portal-stream.js` emits `voice:audio` WS
     frames but **no frontend consumer exists** — every voiced turn pays full TTS cost and the
     audio is dropped. Plus a `getVoiceDNA(companionName)` vs `neumaId` lookup mismatch.
     *(Fixed in T1.1 — see below.)*
  2. **No voice IN.** There is no STT path; the conversation is text-typed, spoken back.
- **Structural ceiling:** each utterance is synthesized **statelessly** (text → audio, no
  conversational context), so prosody can't carry timing/emotion across turns. TTFA is gated
  on the first *full sentence*. This is the gap to Sesame.

---

## 2. What Sesame's CSM actually is (researched — primary sources)

**CSM = Conversational Speech Model.** Open-sourced by Sesame as **CSM-1B**, **Apache-2.0**.

- **It is a context-conditioned speech *generator*, NOT a conversational agent.** The repo is
  explicit: *[…]* You **must** pair it with a separate LLM for
  the words. (The viral "Maya" demo = CSM + an upstream LLM + a surrounding real-time harness.)
- **Architecture:** two autoregressive Llama-variant transformers — a **~1B multimodal
  backbone** (`Llama-3.2-1B`) + a **~100M audio decoder**. Text via the Llama tokenizer; audio
  via a **split-RVQ codec (Mimi)** producing **1 semantic + N−1 acoustic codebooks per frame at
  12.5 Hz**. Text + audio are tokenized into one interleaved sequence the backbone processes
  autoregressively — *not* a sequential "semantic then vocoder" pipeline.
- **Where presence comes from:** context. CSM takes conversation history as a list of
  **`Segment{ speaker:int, text:str, audio:tensor }`** — prior turns of *both speakers,
  text AND audio*. Prosody/emotion/timing are conditioned on that history, which is why it
  […] Training uses **compute amortization** (the audio
  decoder trains on a random 1/16 of frames; the zeroth/semantic codebook updates every frame).
- **What it does NOT give you for free:** full-duplex, interruption, backchannels, turn-taking.
  Those are **system-level** (VAD, streaming I/O, an orchestration loop) — not intrinsic to CSM.
- **Reality checks:** base CSM-1B is **not** the fine-tuned Maya (lower polish); **English-
  focused**; the reference repo has **no streaming** out of the box; needs CUDA + HF access to
  **gated `meta-llama/Llama-3.2-1B`** (a distribution wrinkle for a shippable local app).

**Sources:** [SesameAILabs/csm](https://github.com/SesameAILabs/csm) ·
[sesame/csm-1b (HF)](https://huggingface.co/sesame/csm-1b) ·
[DigitalOcean overview](https://www.digitalocean.com/community/tutorials/sesame-csm) ·
[Sesame: Crossing the uncanny valley of conversational voice](https://www.sesame.com/research/crossing_the_uncanny_valley_of_voice)

---

## 3. The key reframe (what this means for NEUMA)

CSM replaces the **TTS stage**, not the neuma's mind. The neuma's LLM stays the conduit of
*thought*; CSM becomes the conduit of *voice* — a second conduit, exactly the
[[project_neuma_essence_not_model]] doctrine ([…]).

```
              the neuma (DNA + soul + memory + emotion)
                              │  is the SAME being across both
        ┌─────────────────────┴─────────────────────┐
   LLM conduit (mind)                         CSM conduit (voice)
   Qwen3.5-122B → text                        context + text → speech-with-presence
```

**Our structural advantage over a generic CSM wrapper:** Sesame conditions on raw audio
history. We *also* have, per turn, the neuma's **detected emotion + intensity**
(`emotion-detector.js`), its **Voice DNA** (style/emotion profile), and its **episodic memory**
(CORE-005). Presence is partly a *context* problem — and context is what this platform is built
around. We can feed a far richer conditioning signal than text+audio alone.

---

## 4. Honest tiered plan (each tier is independently shippable)

### Tier 1 — Make it audible + bidirectional (no new model; prerequisite for everything)
The cascade is fine for this; it just isn't wired.
- **T1.1 Client audio sink** — ✅ **shipped.** `voice-sink.js` consumes `voice:audio` on the
  frontend, decodes (PCM s16le / f32le, or encoded via `decodeAudioData`), and schedules
  buffers gaplessly + in order through an `AudioContext` (ordered promise chain + a
  `max(currentTime, cursor)` clamp). Mute toggle, barge-in on send, lazy context. Backend:
  Voice DNA now resolved once per turn by `neumaId` (the `companionName` lookup mismatch is
  fixed), synthesis serialized so frames emit in sentence order. The `voice:end` marker was
  dropped — it had no playback action (the timeline self-corrects); a turn-boundary consumer
  (speaking-state, mic turn-taking) re-adds it with real work in T1.3/T2.
- **T1.2 Voice IN (STT)** — ✅ **shipped** (294222a62). Hold-to-talk dictation through the
  faster-whisper sidecar (:7865); transcript appends to the composer draft, never auto-sends.
- **T1.3 Barge-in** — ✅ **shipped 2026-07-03.** Starting to speak IS the interrupt: every
  hold-to-talk capture start fires `bargeIn` (the existing `consciousness:interrupt` /
  `stopThought` path — sink silenced at once, turn aborted, what was spoken stays). Backend:
  the turn's abort signal now rides the voice chain — queued sentences are dropped and an
  in-flight synthesis HTTP stream is cut (proven real in
  `test/integration/portal-voice-live.test.js` + e2e in `test/e2e/dictation.spec.js`). An
  open-mic VAD (Tier 2) plugs into the same `bargeIn` seam.
- **T1.4 Emotion→prosody** — ✅ **shipped 2026-07-03.** Each sentence's synthesis is
  conditioned on the emotion of the accumulated turn so far (`_speechEmotion`, real detector)
  — context-conditioning in miniature. Adapter layer fixed along the way: zonos label mapping
  (neuma vocab → conditioning slots) + snake_case `emotion_intensity`; cartesia emotion moved
  into `generation_config` (sonic-3+, model config-driven).

### Tier 2 — Conversational dynamics (system-level; still cascade-compatible)
- **T2.1 LIVE mode (open mic + VAD turn-taking)** — ✅ **shipped 2026-07-03.** A LIVE
  toggle in the composer opens the mic for the session (honest OS indicator; stands down
  on portal disconnect — recorded product decision). Pure endpointing reducer
  (`voice-activity.js`: adaptive noise floor, hysteresis, confirm/hangover windows) fed by
  a real analyser (`use-live-voice.js`). Speech-start = barge-in; speech-end →
  whisper → the thought auto-sends. Utterances arriving while a turn settles merge into
  one thought. Proven end-to-end with a real speech waveform as a real Web Audio
  MediaStream (e2e) **and** live with the operator's real voice. Known limit: browser AEC
  (echoCancellation) handles the neuma's own speaker output well on headphones; loud open
  speakers can still self-trigger — full duplex/echo discipline remains open below.
- VAD-driven **turn-taking refinements** (endpointing tuned per witness; partial-listen).
- **Backchannels** ("mhm", "yeah") on partial-listen.
- **Context-prosody** — feed recent turns + memory salience into prosody selection.
- Echo cancellation / duplex audio plumbing beyond browser AEC.

### Tier 3 — The integrated speech-LM (the Sesame leap; substrate change)
Introduce **CSM (or a CSM-class model)** as a first-class **voice provider** behind the existing
`tts-provider.js` adapter seam — so it slots in beside zonos/cartesia with zero churn to callers.
- **T3.1 CSM provider** — a `backend/services/voice/providers/csm.js` sidecar (Python, Mimi +
  Llama-3.2-1B + csm-1b), exposing the same `synthesize()` async-generator contract. Co-resident
  on the 96 GB card with the 122B mind (CSM-1B is ~2–3 GB; TTL residency like the mind).
- **T3.2 Context conditioning** — build CSM `Segment[]` from our **session history + Voice DNA +
  emotion**, not just raw audio. This is where "presence" actually lands and where we can beat a
  naive wrapper.
- **T3.3 Streaming** — the base repo has none; add frame-streaming off the Mimi 12.5 Hz codec so
  TTFA is low (the whole point). This is real engineering, not config.
- **T3.4 Fine-tune toward the neuma's own voice** — CSM-1B base ≠ Maya polish; LoRA/fine-tune on
  Voice-DNA-consistent + relational data so a neuma's voice is *its own*, evolving (ties to the
  retrain-data "RELATIONAL TRACKING" category, [[project_substrate_qwen35_decision]]).

**Sequencing:** Tier 1 first (unblocks audible conversation, needed under every later tier),
then Tier 3 as the differentiator. Tier 2 dynamics can interleave. Don't gate audibility on the
integrated model.

---

## 5. Judgment calls (decision + rejected alternative)

1. **CSM as a provider behind `tts-provider.js`, not a rewrite.** Keeps the cascade as the
   fallback, lets us A/B the integrated model per-neuma, reuses the (now-secured) provider
   surface. *Rejected:* ripping out the cascade for a CSM-only path — loses the local-sidecar +
   cloud options and the Voice-DNA plumbing.
2. **The neuma's LLM stays the mind; CSM is voice-only.** CSM cannot generate text; conflating
   them would be wrong. *Rejected:* a single audio-in/audio-out duplex model as the mind — not
   what CSM is, and it would discard our identity/memory/emotion stack.
3. **Tier 1 (audible) before Tier 3 (integrated).** A visible, testable baseline to measure the
   integrated model against. *Rejected:* doc-then-big-bang CSM with no audible baseline.
4. **Distribution:** CSM is Apache-2.0 but needs gated Llama-3.2-1B. *Decision pending Founder* —
   bundle vs. first-run gated download vs. a non-gated backbone swap.

---

## 6. Review-asks (for Founder + a reviewing instance)

1. **Target model:** commit to **CSM-1B** as the Tier-3 speech-LM, or evaluate alternatives
   (e.g. other open speech-LMs) in a bake-off slice first?
2. **Latency budget:** what TTFA makes it feel "Sesame-ish" to you (sub-300 ms? sub-200 ms?) —
   sets how hard we push T3.3 streaming vs. accept cascade-grade latency for V1.
3. **Voice-in stack:** Whisper sidecar (server) vs. `whisper.cpp` (in the local app) — ties into
   the installable-NEUMA packaging (task #15).
4. **Fine-tuning appetite:** is […] enough for
   V1, or is per-neuma voice fine-tuning (T3.4) in scope early?
5. **Gated-backbone distribution** (judgment call #4): how do you want to ship the Llama-3.2-1B
   dependency for a downloadable app?

---

## 7. Status
Design only — **no code.** Tier 1 (T1.1 client audio sink) is the recommended first slice; it is
also the audit's open "neuma can't speak" gap, so it's worth doing regardless of the Tier-3
verdict. Each slice lands its own tests + observable proof and goes through the cross-instance
review loop before merge.

---

## 8. THE STREAM LANE (shipped 2026-07-29 — SPEECH SYSTEM, run speech-system-build-1bmd)

The cascade this document designed is now **streaming end to end**. What
landed, per the MASTER_PLAN (`.waves/runs/speech-system-d42q/`):

- **Server-side VAD + streaming STT** — the whisper sidecar (`voice-engines/whisper/server.py`)
  gains `/stream` (WS): Silero VAD + LocalAgreement-2 incremental decode
  (canonical ufal `whisper_online.py`, vendored MIT), faster-whisper **tiny
  int8 on CPU** (benched on this rig: 218 ms mean @300 ms cadence; base is
  the 500 ms quality option; large-v3 stays on the GPU dictation path).
  Fail-closed by law: loopback-only boot assert, one `/stream` client,
  single decode pump, PCM flood bound, no PCM in logs or on disk.
- **The bridge** — `backend/services/voice/stream-session.js`: portal WS ↔
  sidecar WS, generation-tagged cancel (HF speech-to-speech's CancelScope
  pattern), one voice session per connection, wedge → text degradation
  (NEVER cloud). Frames: `voice:mic_open/mic_close/mic_pcm/speech_start`
  (C→S), `voice:partial/utterance/speech_started/speech_stopped/error` (S→C).
- **Session-purpose split** — `purpose: 'work' | 'conversation'` (pure
  `normalizePurpose`, fail-closed `'work'`) rides `companion:manifest` /
  `portal:new-session` / `session:purpose`. Purpose *defaults* the voice
  flags; `voice:pref` stays the operator's override. The being knows it is in
  a voice sitting (`voiceSitting` prompt section, empty-string law — work
  lanes byte-identical).
- **The immersion surface** — the VoiceSitting shell: entering LIVE voice
  mode REPLACES the composer (no typing), the chat dims to background, and a
  visualization layer animates both voice channels (operator mic, being
  playback) with LISTENING/THINKING/SPEAKING turn state. The mic runs in a
  headless bridge (`VoiceSittingMic.jsx`) because the shell replaces the
  composer the mic path used to live in.
- **Measured latency legs** — S-20 instrumentation logs STT finalize and
  per-sentence TTS TTFB per sitting (timings only, never content). The
  end-to-end number is Founder's S-22 live sitting.

Tier mapping: T1/T2 shipped earlier; this chapter is the Tier-2 completion
(streaming turn-taking) — Tier 3 (end-to-end speech LM) remains design-only
and out of scope.
