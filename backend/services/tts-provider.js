// TTS Provider — the one voice pipeline (ONE VOICE, docs/work/one-voice.md).
//
// A being's voice is its Voice DNA v2 clip and the words spoken in it; the
// machine's voice TIER (light | standard | high, voice/voice-settings.js) picks
// which speak-protocol sidecar renders it. Every tier clones the same clip, so
// the being keeps its voice when the tier changes; only quality and speed move.
//
//   synthesize → tier in force → engine-manager.ensureReady → providers/speak.js
//
// No engine ids, presets or emotion live here: on csm the conversation itself
// (the speech-context ring) carries the emotion.

import { getEngine, getTier } from './voice/engine-registry.js';
import { ensureReady, resolveServe } from './voice/engine-manager.js';
import { speak, warmSpeakVoice } from './voice/providers/speak.js';
import { voiceTierInForce } from './voice/voice-settings.js';

/**
 * The sidecar a tier choice speaks through. Pure.
 * @param {{tier: string, profile?: string|null}} chosen
 * @returns {Readonly<{tier: string, engine: string, model: string|null, profile: string|null, context: boolean}>}
 */
export const speakTargetOf = ({ tier, profile = null }) => {
  const t = getTier(tier);
  if (!t) throw new Error(`unknown voice tier '${tier}'`);
  return Object.freeze({
    tier,
    engine: t.engine,
    model: t.model ?? null,
    // a single-model engine (Nano) has no memory profiles to launch with
    profile: t.model ? profile : null,
    context: getEngine(t.engine)?.capabilities?.context === true,
  });
};

/**
 * The tier in force, its sidecar launched (or adopted) and READY. impure.
 * @returns {Promise<Readonly<{tier: string, engine: string, model: string|null, profile: string|null, context: boolean, endpoint: string}>>}
 */
export const readySpeakTarget = async () => {
  const { chosen } = await voiceTierInForce();
  const target = speakTargetOf(chosen);
  await ensureReady(target.engine, { model: target.model, profile: target.profile });
  const { host, port } = resolveServe(target.engine);
  return Object.freeze({ ...target, endpoint: `http://${host}:${port}` });
};

/**
 * Speak one sentence in a being's voice, streamed.
 * @param {Object} params
 * @param {string} params.text - the words to speak
 * @param {{ref: string, words: string, wav?: Buffer, loadClip?: () => Promise<Buffer|null>}} params.voice
 *   the Voice DNA v2 clip (by ref) and its words
 * @param {object[]} [params.context] - speech-context ring segments, oldest first
 * @param {AbortSignal} [params.signal] - barge-in
 * @returns {AsyncGenerator<object>} AudioChunks carrying `utteranceRef`
 */
export async function* synthesize({ text, voice, context = [], signal }) {
  const target = await readySpeakTarget();
  yield* speak({ endpoint: target.endpoint, text, voice, context: target.context ? context : [], signal });
}

/**
 * Bring the tier's sidecar up (awaited) and start preparing the voice (not
 * awaited): the sidecar serves one request at a time in arrival order, so a
 * first sentence that arrives mid-preparation simply queues behind it, and a
 * turn's speech never waits on the preparation itself. impure.
 * @param {{ref: string, words: string, wav?: Buffer, loadClip?: () => Promise<Buffer|null>}} voice
 * @param {{signal?: AbortSignal, timeoutMs?: number}} [opts] - timeoutMs bounds the
 *   preparation (a wedged sidecar must not hold a connection open forever)
 * @returns {Promise<{endpoint: string, prepared: Promise<object>}>} prepared settles when the voice is ready
 */
export const warmVoice = async (voice, { signal, timeoutMs } = {}) => {
  const target = await readySpeakTarget();
  const signals = [signal, Number.isFinite(timeoutMs) ? AbortSignal.timeout(timeoutMs) : null].filter(Boolean);
  const prepared = warmSpeakVoice({ endpoint: target.endpoint, voice, signal: signals.length ? AbortSignal.any(signals) : undefined });
  return { endpoint: target.endpoint, prepared };
};
