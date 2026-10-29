// Qwen3-TTS adapter — Apache-2.0 local BATCH voice clone + voice design.
//
// Talks to the Python sidecar at voice-engines/qwen3/server.py (port 7867).
// BATCH ONLY: qwen-tts exposes no streaming path — the sidecar runs a full
// generation, then chunks the PCM. First-audio scales ~0.05 s/char (measured
// on the real rig, qwen3-engine-q3gh Wave-1), so first frame is never
// instant and nothing here claims streaming.
//
// Sidecar API (qwen3-engine-q3gh WAVE1_EXECUTION […]):
//   GET  /health      → { ok, model, device, sample_rate, idle_seconds, busy }
//   POST /synthesize  → audio/raw (24kHz, mono, s16le; uniform 3840 B / 80 ms
//     chunks after the full generation)
//     clone mode:  { text, ref_audio_b64, seed?, language? }
//     design mode: { text, description, seed (REQUIRED), language? }
//     errors: 400 mode-branch/validation (cause-named, ≤200 chars) ·
//             422 pydantic bounds · 500 generation/watchdog · 503 not-ready
//   The sidecar 400s the four illegal shapes — description+ref, neither,
//   design-without-seed, voice id (the Base clone model serves NO preset
//   voices and fails closed) — so buildQwen3Request never emits them.
//
// Voice DNA wiring (MODE-BRANCH RULE — binding):
//   - voiceDNA.engine.description → DESIGN branch: { text, description, seed },
//                                   NEVER a ref — even when _inlineRefAudio is
//                                   somehow attached
//   - voiceDNA.engine.voiceSeed   → seed (integer 0..2³¹−1); REQUIRED in
//                                   design — determinism is the design voice's
//                                   identity
//   - voiceDNA._inlineRefAudio    → CLONE branch: { text, ref_audio_b64 } from
//                                   the sealed seed.wav (attached by
//                                   tts-provider via the existing
//                                   needsInlineRef seam), NEVER a description.
//                                   x-vector-only: the sidecar feeds the model
//                                   validated (ndarray, sr) tuples, never
//                                   strings (qwen-tts's loader fetches URLs →
//                                   SSRF-shaped)

import { createLogger } from '../../logger.js';
import { streamPcmBody } from './_pcm-stream.js';
import { sidecarFetch } from '../sidecar-trust.js';

const log = createLogger('Voice.Qwen3');

// The sidecar's pydantic seed bounds (ge=0, le=2³¹−1) — validated here so the
// builder never emits a body the sidecar must reject.
const SEED_MAX = 2 ** 31 - 1;

// pure — an in-range integer seed, or a throw naming the cause. A seed is a
// small public integer (never voice data), so naming its value is safe.
const requireValidSeed = (seed, cause) => {
  if (!Number.isInteger(seed) || seed < 0 || seed > SEED_MAX) {
    throw new Error(`qwen3 ${cause} (got ${seed})`);
  }
  return seed;
};

// pure — build the JSON request body for the sidecar. The mode branches on
// engine.description ALONE: a design voice never carries a ref onto the wire
// (the description+ref shape 400s), and a clone voice never carries a
// description. A clone turn without its inline ref has NO fallback — the Base
// model has no default speaker — so the builder refuses rather than emit the
// neither-shape the sidecar 400s.
export const buildQwen3Request = ({ text, voiceDNA }) => {
  const description = voiceDNA?.engine?.description;
  if (description) {
    return {
      text,
      description,
      seed: requireValidSeed(voiceDNA?.engine?.voiceSeed, 'design mode requires an integer seed'),
    };
  }
  const ref = voiceDNA?._inlineRefAudio;
  if (!ref) {
    throw new Error(
      'qwen3 clone mode requires the sealed reference clip (voiceDNA._inlineRefAudio) '
      + '— the Base model serves no preset voices, so there is no default voice to fall back to',
    );
  }
  const body = { text, ref_audio_b64: ref };
  const seed = voiceDNA?.engine?.voiceSeed;
  if (seed !== undefined && seed !== null) {
    body.seed = requireValidSeed(seed, 'seed must be an integer 0..2³¹−1');
  }
  return body;
};

export const qwen3Adapter = {
  // Clone conditioning rides the sealed seed.wav: tts-provider loads it into
  // voiceDNA._inlineRefAudio per turn — the existing needsInlineRef seam
  // shared with zonos, no new ref mechanism.
  needsInlineRef: true,

  async *synthesize({ text, voiceDNA, emotion, signal, config }) {
    const droppedEmotion = emotion?.label || voiceDNA?.emotionProfile?.default;
    if (droppedEmotion) {
      log.debug('emotion accepted and dropped — qwen3 has no emotion API', { label: droppedEmotion });
    }
    const body = buildQwen3Request({ text, voiceDNA });
    const url = `${config.endpoint.replace(/\/$/, '')}/synthesize`;
    // Boolean markers only — the ref clip is retained voiceprint data and the
    // description is the voice's identity; neither is ever logged.
    log.debug('synthesize → qwen3', {
      chars: text.length,
      mode: body.description ? 'design' : 'clone',
      hasSeed: body.seed !== undefined,
    });

    const response = await sidecarFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      // Every sidecar error throws with its bounded cause: 400 names a
      // mode-branch/user fault (not retryable), 503 means not-ready (warm-up
      // is the route layer's job), 500 is a generation/watchdog fault.
      const errText = await response.text().catch(() => '');
      throw new Error(`qwen3 synthesize failed (${response.status}): ${errText.slice(0, 200)}`);
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
