// ElevenLabs adapter — proprietary cloud TTS, gold-standard voice cloning.
//
// API: https://elevenlabs.io/docs/api-reference/text-to-speech-stream
//   POST /v1/text-to-speech/{voice_id}/stream?output_format=mp3_44100_128
//     body: { text, model_id, voice_settings?: { stability, similarity_boost, style, use_speaker_boost } }
//   Auth: Header `xi-api-key`
//
// Voice DNA wiring:
//   - voiceDNA.engine.voiceId → ElevenLabs voice ID (preset or cloned)
//   - voiceDNA.style.stability / similarity → voice_settings
//   - emotion is not a direct param — encoded via voice_settings.style (0..1)
//
// Models: eleven_v3 (~best quality, multilingual), eleven_multilingual_v2 (stable),
//         eleven_turbo_v2_5 (~fastest). We default to turbo for companion latency.

import { createLogger } from '../../logger.js';
const log = createLogger('Voice.ElevenLabs');

const DEFAULT_MODEL = 'eleven_turbo_v2_5';
const OUTPUT_FORMAT = 'mp3_44100_128';

// pure
const buildElevenLabsRequest = ({ text, voiceDNA, emotion, config }) => {
  const voiceId = voiceDNA?.engine?.voiceId || config.voice;
  if (!voiceId) throw new Error('elevenlabs synthesize requires a voice_id in voice DNA or provider config');

  const body = {
    text,
    model_id: config.model || DEFAULT_MODEL,
    voice_settings: {
      stability: voiceDNA?.style?.stability ?? config.stability ?? 0.5,
      similarity_boost: voiceDNA?.style?.similarity ?? config.similarity ?? 0.75,
      style: emotion?.intensity !== undefined ? Math.min(1, Math.max(0, emotion.intensity)) : 0.0,
      use_speaker_boost: true,
    },
  };
  return { voiceId, body };
};

export const elevenlabsAdapter = {
  async *synthesize({ text, voiceDNA, emotion, signal, config }) {
    if (!config.apiKey) throw new Error('elevenlabs synthesize requires an API key (ELEVENLABS_API_KEY)');
    const { voiceId, body } = buildElevenLabsRequest({ text, voiceDNA, emotion, config });
    const url = `${config.endpoint.replace(/\/$/, '')}/v1/text-to-speech/${voiceId}/stream?output_format=${OUTPUT_FORMAT}`;
    log.debug('synthesize → elevenlabs', { chars: text.length, voiceId, model: body.model_id });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': config.apiKey,
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`elevenlabs synthesize failed (${response.status}): ${errText.slice(0, 200)}`);
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
      // Hit the user endpoint — verifies auth without spending TTS credits
      const r = await fetch(`${config.endpoint.replace(/\/$/, '')}/v1/user`, {
        headers: { 'xi-api-key': config.apiKey },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        return { ok: false, error: `http ${r.status}: ${errText.slice(0, 120)}` };
      }
      const data = await r.json().catch(() => ({}));
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - t0),
        sub: data?.subscription?.tier,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
