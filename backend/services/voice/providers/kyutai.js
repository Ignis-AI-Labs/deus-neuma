// Kyutai adapter — CC-BY-4.0 local streaming TTS (tts-1.6b-en_fr, moshi).
//
// Talks to the Python sidecar at voice-engines/kyutai/server.py.
//
// Sidecar API (WAVE2_EXECUTION […]):
//   GET  /health      → { ok, model, device, sample_rate, idle_seconds }
//   POST /synthesize  → streamed PCM (24kHz, mono, s16le; 3840 B / 80 ms frames)
//     body: { text, voice?, embedding_b64?, embedding_ref?, cfg_coef? }
//     resp: audio/raw with X-Audio-Format / X-Audio-Sample-Rate /
//           X-Audio-Channels headers
//     errors: 503 not-ready · 400 client fault · 409 conditioning mismatch ·
//             422 schema · 500 pre-first-frame fault
//   POST /mint        → { ref_audio_b64 } → { embedding_b64 } (B-9 owns mint)
//
// Conditioning is BAKED per sidecar worker (one TTSGen = one voice at one
// cfg_coef): a voice/embedding that isn't the baked one gets 409 — a restart
// signal, NOT an engine failure. The adapter warns and falls back to the
// baked voice (unconditioned retry) rather than fail the turn; re-forge +
// sidecar restart (B-6/B-9) owns the remedy.
//
// Voice DNA wiring:
//   - voiceDNA.engine.voiceId      → voice (omitted unless set — any id ≠ the
//                                    baked voice 409s by contract)
//   - voiceDNA._inlineEmbedding    → embedding_b64 (attached by tts-provider
//                                    from the sealed workspace embedding)
//   - voiceDNA.engine.embeddingRef → embedding_ref (sha256 assertion, only
//                                    when no inline bytes are attached)
//   - voiceDNA.engine.cfgCoef      → cfg_coef (default 2.0, the baked value)
//   - emotion                      → ACCEPTED AND DROPPED, debug-logged:
//                                    kyutai has no emotion API (FR-16)

import { createLogger } from '../../logger.js';
import { streamPcmBody } from './_pcm-stream.js';
import { sidecarFetch } from '../sidecar-trust.js';

const log = createLogger('Voice.Kyutai');

// The sidecar bakes cfg_coef 2.0 at conditioning time and accepts only that
// value (or omission) per request.
const BAKED_CFG_COEF = 2.0;

// pure — build the JSON request body for the sidecar. No emotion mapping:
// the engine has no emotion API, so no emotion field is ever sent.
export const buildKyutaiRequest = ({ text, voiceDNA }) => {
  const body = { text, cfg_coef: voiceDNA?.engine?.cfgCoef ?? BAKED_CFG_COEF };
  if (voiceDNA?.engine?.voiceId) body.voice = voiceDNA.engine.voiceId;
  // Inline bytes are the stronger conditioning assertion (they hash to the
  // ref by construction) — send the bare ref only when no bytes are attached.
  if (voiceDNA?._inlineEmbedding) body.embedding_b64 = voiceDNA._inlineEmbedding;
  else if (voiceDNA?.engine?.embeddingRef) body.embedding_ref = voiceDNA.engine.embeddingRef;
  return body;
};

// pure — sidecar error status → recovery action. 409 means the requested
// conditioning ≠ the baked session (a voice switch is an engine restart):
// warn-and-fallback, never an engine failure. Every other status follows the
// shared adapter contract — throw status + first 200 chars of the cause body.
export const classifyKyutaiError = (status) =>
  (status === 409 ? 'fallback-baked' : 'throw');

// impure — one POST of a JSON body to the sidecar's /synthesize
const postSynthesize = (url, body, signal) =>
  sidecarFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

export const kyutaiAdapter = {
  // Embedding-conditioned voice: tts-provider loads the sealed workspace
  // embedding into voiceDNA._inlineEmbedding; without it the being speaks
  // with the sidecar's baked voice.
  needsInlineEmbedding: true,

  async *synthesize({ text, voiceDNA, emotion, signal, config }) {
    const droppedEmotion = emotion?.label || voiceDNA?.emotionProfile?.default;
    if (droppedEmotion) {
      log.debug('emotion accepted and dropped — kyutai has no emotion API', { label: droppedEmotion });
    }
    const body = buildKyutaiRequest({ text, voiceDNA });
    const url = `${config.endpoint.replace(/\/$/, '')}/synthesize`;
    log.debug('synthesize → kyutai', {
      chars: text.length,
      hasEmbedding: Boolean(body.embedding_b64),
      hasVoice: Boolean(body.voice),
    });

    let response = await postSynthesize(url, body, signal);
    if (!response.ok && classifyKyutaiError(response.status) === 'fallback-baked') {
      // Boolean markers only — the mismatch warning never echoes payloads.
      log.warn('kyutai 409 conditioning mismatch — falling back to the baked voice', {
        hadEmbedding: Boolean(body.embedding_b64 || body.embedding_ref),
        hadVoice: Boolean(body.voice),
      });
      try { await response.body?.cancel(); } catch { /* body already drained */ }
      response = await postSynthesize(url, { text }, signal);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`kyutai synthesize failed (${response.status}): ${errText.slice(0, 200)}`);
    }

    yield* streamPcmBody(response, signal);
  },

  async testConnection(config) {
    const t0 = performance.now();
    try {
      const r = await fetch(`${config.endpoint.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) return { ok: false, error: `health ${r.status}` };
      const data = await r.json().catch(() => ({}));
      return { ok: true, latencyMs: Math.round(performance.now() - t0), device: data.device };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
