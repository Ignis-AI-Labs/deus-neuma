// Cartesia adapter — proprietary low-latency cloud TTS (~135ms TTFA).
//
// API: https://docs.cartesia.ai/api-reference/tts/bytes
//   POST /tts/bytes  → streamed MP3 or raw PCM
//     body: { transcript, model_id, voice: { mode: 'id'|'embedding', id|embedding },
//             output_format, language?, speed?, emotion? }
//   Auth: Header `Cartesia-API-Key` OR `X-API-Key` (we use Cartesia-API-Key)
//
// Voice DNA wiring:
//   - voiceDNA.engine.voiceId → Cartesia preset voice ID
//   - voiceDNA.engine.embedding (base64) → custom cloned voice embedding
//
// Streaming latency is the whole point of Cartesia — we pass through chunks
// as soon as they arrive, no buffering.

import { createLogger } from '../../logger.js';
const log = createLogger('Voice.Cartesia');

const MODEL_ID = 'sonic-2';
const OUTPUT_FORMAT = 'mp3';

// generation_config (which carries emotion) exists only on sonic-3 and later —
// sending it to earlier models is undocumented, so it is gated on the model id.
export const modelSupportsEmotion = (modelId) => /^sonic-3/.test(modelId);

// The model can be pinned via app config (voiceModel → config.model) so the
// emotion gate tracks the deployed model; anything not sonic-shaped (e.g. the
// engine registry's display name flowing through config.model) falls back to
// the default. On the default sonic-2, emotion is intentionally inactive.
export const resolveModelId = (config) =>
  (/^sonic-/.test(config?.model || '') ? config.model : MODEL_ID);

// Neuma emotion vocabulary → Cartesia's generation_config.emotion enum
// (docs.cartesia.ai/api-reference/tts/bytes). Unmapped labels are dropped
// rather than sent — an unknown enum value would fail the whole request.
export const CARTESIA_EMOTION = Object.freeze({
  contemplative: 'contemplative',
  joyful: 'happy',
  melancholic: 'melancholic',
  passionate: 'excited',
  serene: 'serene',
  defiant: 'determined',
  curious: 'curious',
  empathic: 'sympathetic',
});

// pure
export const buildCartesiaRequest = ({ text, voiceDNA, emotion, config }) => {
  const voice = voiceDNA?.engine?.embedding
    ? { mode: 'embedding', embedding: voiceDNA.engine.embedding }
    : { mode: 'id', id: voiceDNA?.engine?.voiceId || config.voice || 'c0a8e60f-9c3f-4e2f-8c2c-7c7c7c7c7c7c' };

  const modelId = resolveModelId(config);
  const body = {
    transcript: text,
    model_id: modelId,
    voice,
    output_format: OUTPUT_FORMAT,
  };
  if (voiceDNA?.language) body.language = voiceDNA.language;
  if (voiceDNA?.style?.baseRate) body.speed = voiceDNA.style.baseRate;
  // The old top-level body.emotion was never part of the API surface —
  // emotion rides in generation_config on models that support it.
  const cartesiaEmotion = CARTESIA_EMOTION[emotion?.label];
  if (cartesiaEmotion && modelSupportsEmotion(modelId)) {
    body.generation_config = { emotion: cartesiaEmotion };
  }
  return body;
};

export const cartesiaAdapter = {
  async *synthesize({ text, voiceDNA, emotion, signal, config }) {
    if (!config.apiKey) throw new Error('cartesia synthesize requires an API key (CARTESIA_API_KEY)');
    const body = buildCartesiaRequest({ text, voiceDNA, emotion, config });
    const url = `${config.endpoint.replace(/\/$/, '')}/tts/bytes`;
    log.debug('synthesize → cartesia', { chars: text.length, voiceMode: body.voice.mode });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cartesia-API-Key': config.apiKey,
        'X-API-Key': config.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`cartesia synthesize failed (${response.status}): ${errText.slice(0, 200)}`);
    }

    const reader = response.body.getReader();
    let sequence = 0;
    try {
      while (true) {
        if (signal?.aborted) throw new Error('aborted');
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        yield { bytes: value, sampleRate: 44100, channels: 1, format: 'mp3', sequence: sequence++, final: false };
      }
      yield { bytes: new Uint8Array(0), sampleRate: 44100, channels: 1, format: 'mp3', sequence, final: true };
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  },

  async testConnection(config) {
    if (!config.apiKey) return { ok: false, error: 'no API key set' };
    const t0 = performance.now();
    try {
      const r = await fetch(`${config.endpoint.replace(/\/$/, '')}/tts/bytes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cartesia-API-Key': config.apiKey,
          'X-API-Key': config.apiKey,
        },
        body: JSON.stringify({
          transcript: 'ok',
          model_id: MODEL_ID,
          voice: { mode: 'id', id: 'c0a8e60f-9c3f-4e2f-8c2c-7c7c7c7c7c7c' },
          output_format: OUTPUT_FORMAT,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        return { ok: false, error: `http ${r.status}: ${errText.slice(0, 120)}` };
      }
      // drain so the connection closes cleanly
      await r.arrayBuffer().catch(() => {});
      return { ok: true, latencyMs: Math.round(performance.now() - t0) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
