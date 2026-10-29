// THE SPEAK ADAPTER — the one backend client of the speak protocol
// (docs/architecture/voice/speak-protocol.md). Every voice tier serves it:
// csm (Standard, High) and chatterbox-nano (Light). Impure (HTTP).
//
// One sentence in, streamed PCM out, in the uniform AudioChunk shape the
// emitters already read ({bytes, sampleRate, channels, format, sequence,
// final}), plus `utteranceRef` — the sidecar's X-Utterance-Ref, the handle the
// speech-context ring re-enters this utterance by.
//
// The voice travels by reference first: `clip_ref` (= the DNA's clip.ref, the
// sha256 of the same bytes) and being segments by their utterance `ref`. A
// `409 unknown_ref` (sidecar restart, LRU eviction, a different tier's sidecar)
// is answered by resending what it named inline — the clip as `clip_b64`, the
// context as WAV — never by giving up on the voice.
//
// Barge-in: the caller's AbortSignal rides the fetch, so an abort closes the
// connection and the sidecar stops generating at the next frame.

import { streamPcmBody } from './_pcm-stream.js';
import { wireContext } from '../speech-context.js';
import { sidecarFetch } from '../sidecar-trust.js';

const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);

/**
 * pure — the speak protocol is loopback-only (its routes carry no auth); refuse
 * any endpoint that is not plain http on loopback.
 * @param {string} endpoint
 */
export const isLoopbackEndpoint = (endpoint) => {
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname);
};

const guard = (endpoint) => {
  if (!isLoopbackEndpoint(endpoint)) throw new Error(`speak: refusing non-loopback voice endpoint '${endpoint}'`);
  return endpoint.replace(/\/+$/, '');
};

// impure — the voice clip's bytes, from wherever the voice keeps them.
const clipB64 = async (voice) => {
  const bytes = Buffer.isBuffer(voice.wav) ? voice.wav : await voice.loadClip?.();
  if (!bytes) throw new Error(`speak: the voice clip ${voice.ref} is not in custody`);
  return Buffer.from(bytes).toString('base64');
};

const voiceBody = async (voice, inline) => (inline
  ? { clip_b64: await clipB64(voice), words: voice.words }
  : { clip_ref: voice.ref, words: voice.words });

const post = (url, body, signal) => sidecarFetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
});

// impure — POST, resending inline whatever a 409 names (the clip first, then
// the context). Resolves the first non-409 response.
const postWithRefs = async (url, build, voice, signal) => {
  const inline = { clip: false, context: false };
  for (;;) {
    const response = await post(url, await build(inline), signal);
    if (response.status !== 409) return response;
    const { ref } = await response.json().catch(() => ({}));
    if (ref === voice.ref && !inline.clip) inline.clip = true;
    else if (ref !== voice.ref && !inline.context) inline.context = true;
    else throw new Error(`speak: the sidecar does not hold ${ref ?? 'a reference'} even when sent inline`);
  }
};

const failure = async (response, what) => {
  const body = await response.json().catch(() => null);
  return new Error(`${what} failed (${response.status} ${body?.error ?? ''}): ${String(body?.detail ?? '').slice(0, 200)}`);
};

/**
 * Speak one utterance on a speak-protocol sidecar, streamed.
 * @param {{endpoint: string, text: string,
 *   voice: {ref: string, words: string, wav?: Buffer, loadClip?: () => Promise<Buffer|null>},
 *   context?: object[], signal?: AbortSignal, maxAudioMs?: number}} req
 *   context: speech-context ring segments, oldest first
 * @returns {AsyncGenerator<{bytes: Uint8Array, sampleRate: number, channels: number, format: string,
 *   sequence: number, final: boolean, utteranceRef: string|null}>}
 */
export async function* speak({ endpoint, text, voice, context = [], signal, maxAudioMs }) {
  const url = `${guard(endpoint)}/speak`;
  const response = await postWithRefs(url, async (inline) => ({
    text,
    voice: await voiceBody(voice, inline.clip),
    context: wireContext(context, { inline: inline.context }),
    ...(Number.isFinite(maxAudioMs) ? { max_audio_ms: maxAudioMs } : {}),
  }), voice, signal);
  if (!response.ok) throw await failure(response, 'speak');
  const utteranceRef = response.headers.get('x-utterance-ref');
  let finished = false;
  try {
    for await (const chunk of streamPcmBody(response, signal)) yield { ...chunk, utteranceRef };
    finished = true;
  } finally {
    // A consumer that stops early must still close the connection, or the
    // sidecar keeps generating for nobody (the disconnect IS the abort).
    if (!finished) await response.body?.cancel().catch(() => {});
  }
}

/**
 * Prepare a voice before its first sentence (csm encodes the clip, Nano builds
 * its conditioning), so the first /speak pays no setup. impure.
 * @param {{endpoint: string, voice: object, signal?: AbortSignal}} req
 * @returns {Promise<{ok: true, voice_ref: string|null, ms: number}>}
 */
export const warmSpeakVoice = async ({ endpoint, voice, signal }) => {
  const url = `${guard(endpoint)}/warm`;
  const response = await postWithRefs(url, async (inline) => ({ voice: await voiceBody(voice, inline.clip) }), voice, signal);
  if (!response.ok) throw await failure(response, 'warm');
  return response.json();
};
