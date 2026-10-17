/**
 * Voice emission for one streamed sentence: synthesize via tts-provider, emit
 * voice:audio WS frames. The pair it keeps — base64 framing, the turnId stamp
 * that lets a barge-in refuse stale audio, and the words-released-by-their-
 * own-voice ordering — is sequenced at its one call site (voice/speech-turn.js).
 * Leaf module: imports tts-provider and the logger directly (direction law:
 * leaf ← family ← orchestrator).
 *
 * It answers with what was spoken — the PCM and the sidecar's utterance ref —
 * so the caller can keep a sentence that was spoken IN FULL as context for the
 * next one. A cut sentence never answers: it throws.
 */
import { createLogger } from '../logger.js';
import { safeSend as _safeSend } from '../ws-send.js';
import { synthesize as synthesizeVoice } from '../tts-provider.js';

const log = createLogger('Portal');

/**
 * impure — synthesize one sentence and emit voice:audio frames. Audio bytes
 * are base64-encoded so they fit a JSON message well under the WS payload cap
 * (4KB chunks → ~5.5KB base64, cap is 64KB). onFirstChunk fires ONCE,
 * immediately before the sentence's first audio frame goes out — the seam that
 * lets a VOX turn release its words with its voice instead of ahead of it.
 * @param {import('ws').WebSocket} ws
 * @param {string} companionName
 * @param {string} text - the speakable sentence
 * @param {{ref: string, words: string}} voice - Voice DNA v2 clip + words
 * @param {{context?: object[], signal?: AbortSignal, onFirstChunk?: () => void, turnId?: string}} [opts]
 * @returns {Promise<{utteranceRef: string|null, pcm: Buffer, sampleRate: number}>}
 */
export const synthesizeAndEmit = async (ws, companionName, text, voice, {
  context = [], signal, onFirstChunk, turnId,
} = {}) => {
  // S-20 latency instrumentation: time to the FIRST audio chunk of this
  // sentence (timings only — never text, never PCM; threat control #5).
  const synthAnchor = performance.now(); // impure — wall-clock read
  let firstChunkLogged = false;
  const pcm = [];
  let utteranceRef = null;
  let sampleRate = 24_000;
  for await (const chunk of synthesizeVoice({ text, voice, context, signal })) {
    if (chunk.bytes.length === 0) continue;
    utteranceRef = chunk.utteranceRef ?? utteranceRef;
    sampleRate = chunk.sampleRate;
    pcm.push(Buffer.from(chunk.bytes));
    const isFirst = !firstChunkLogged;
    if (isFirst) {
      firstChunkLogged = true;
      log.info('voice TTS first-chunk', {
        companion: companionName,
        ttfbMs: Math.round((performance.now() - synthAnchor) * 10) / 10,
      });
    }
    _safeSend(ws, {
      type: 'voice:audio',
      companion: companionName,
      bytes: Buffer.from(chunk.bytes).toString('base64'),
      format: chunk.format,
      sampleRate: chunk.sampleRate,
      channels: chunk.channels,
      sequence: chunk.sequence,
      final: chunk.final,
      // WHOSE VOICE THIS IS: with the turn stamped on the frame the sink can
      // refuse a cancelled sentence's audio that was already on the wire when
      // the barge-in reached the server.
      ...(turnId ? { turnId } : {}),
    });
    // The words, released by their own voice — strictly AFTER the frame that
    // sounds them. A throw in the display path must never cost the audio.
    if (isFirst) {
      try { onFirstChunk?.(); } catch { /* display gating never blocks speech */ }
    }
  }
  return { utteranceRef, pcm: Buffer.concat(pcm), sampleRate };
};
