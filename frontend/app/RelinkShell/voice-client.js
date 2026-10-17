// voice-client.js — REST client for the Voice Forge ceremony.
//
// impure — fetches the voice routes over REST. Session-token auth via the same
// Bearer header pattern as stats-client.js. Non-critical: any failure resolves
// to null and the UI shows its empty state. A non-JSON reply (a proxy/limit
// error page) reads as {} through apiCall, never a parse crash.

import { apiCall, authHeadersOrNull as authHeaders, jsonHeaders } from '../../utils/http.js';
import { createVoiceScheduler } from './voice-scheduler.js';

// impure
export const hasVoice = async (neumaId) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !headers) return false;
    const body = await apiCall('GET', `/api/v1/voice/has-voice/${neumaId}`, { headers });
    return body.hasVoice === true;
  } catch {
    return false;
  }
};

// impure
export const getVoiceDNA = async (neumaId) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !headers) return null;
    const body = await apiCall('GET', `/api/v1/voice/dna/${neumaId}`, { headers });
    return body.dna || null;
  } catch {
    return null;
  }
};

// impure
export const getForgeEngines = async () => {
  try {
    const headers = authHeaders();
    if (!headers) return [];
    const body = await apiCall('GET', `/api/v1/voice/forge/engines`, { headers });
    return body.engines || [];
  } catch {
    return [];
  }
};

// impure — the curated preset gallery manifest: ids + display names + engine
// + license badges, built server-side (CC-BY-NC voices never leave the
// platform). Non-critical: any failure resolves to [] and the gallery shows
// its empty state.
export const getForgePresets = async () => {
  try {
    const headers = authHeaders();
    if (!headers) return [];
    const body = await apiCall('GET', `/api/v1/voice/forge/presets`, { headers });
    return body.presets || [];
  } catch {
    return [];
  }
};

// impure — fire-and-forget engine pre-warm, fired the moment a mode card is
// picked so the sidecar is loading while the witness makes their offering.
// The forge preview path launches the engine lazily regardless
// (voice-forge-routes.js preview → ensureReady), so a failure here only means
// first-preview latency, never a broken ceremony. Resolves the engine's final
// status snapshot; null when the engine is not a local sidecar or the launch
// failed — the caller drives its warming panel off getEngineStatus polls.
export const prewarmEngine = async (engineId) => {
  try {
    const headers = authHeaders();
    if (!engineId || !headers) return null;
    return await apiCall('POST', `/api/v1/voice/engines/local/${engineId}/launch`, { headers, strictJson: true });
  } catch {
    return null;
  }
};

// impure — the engine's live warm-up state as the platform sees it
// ({ state, readiness, ... } — the engine-manager's real STATES), or null
// when unreachable / not a local engine (the launch surface's own 404).
export const getEngineStatus = async (engineId) => {
  try {
    const headers = authHeaders();
    if (!engineId || !headers) return null;
    return await apiCall('GET', `/api/v1/voice/engines/local/${engineId}`, { headers, strictJson: true });
  } catch {
    return null;
  }
};

// impure — start a forge session
export const startForge = async ({ neumaId, witnessWallet, engine, mode }) =>
  apiCall('POST', `/api/v1/voice/forge/start`, {
    body: { neumaId, witnessWallet, engine, mode },
    errorPrefix: 'start failed',
  });

// impure — submit the witness offering (mode-specific)
export const submitOffering = async (sessionId, offering) =>
  apiCall('POST', `/api/v1/voice/forge/${sessionId}/offering`, {
    body: offering,
    errorPrefix: 'offering failed',
  });

// impure — adjust the candidate voice (style sliders, description, etc.)
export const adjustCandidate = async (sessionId, patch) =>
  apiCall('POST', `/api/v1/voice/forge/${sessionId}/adjust`, {
    body: patch,
    errorPrefix: 'adjust failed',
  });

// pure — the audio metadata the forge sends as preview response headers.
const previewMeta = (res) => ({
  format: res.headers.get('x-audio-format') || 'pcm_s16le',
  sampleRate: Number(res.headers.get('x-audio-sample-rate') || 24000),
  channels: Number(res.headers.get('x-audio-channels') || 1),
  contentType: res.headers.get('content-type') || 'audio/raw',
});

// --- Design mode (qwen3 VoiceDesign) — pure helpers for the DESIGN card ---

// pure — the qwen3 sidecar's measured batch cost for design generation
// (wave-1 sidecar contract: design TTFB ≈ 0.0485 s/char, rounded up to 0.05).
// Batch, not streaming: first audio lands only after the full render.
export const DESIGN_WAIT_SECONDS_PER_CHAR = 0.05;

// pure — honest wait estimate in whole seconds (ceil, floor 1) for a design
// preview of `chars` characters. The label this feeds must never promise an
// instant first frame.
export const estimateDesignWait = (chars) =>
  Math.max(1, Math.ceil(Math.max(0, Number(chars) || 0) * DESIGN_WAIT_SECONDS_PER_CHAR));

// pure — design seed bounds from the sidecar contract: integer 0..2³¹−1.
export const DESIGN_SEED_MAX = 2 ** 31 - 1;

// pure — normalize any input into a valid design seed.
export const normalizeDesignSeed = (seed) => {
  const n = Math.floor(Number(seed));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, DESIGN_SEED_MAX);
};

// pure — REROLL bump: the next seed, wrapping at the contract bound.
export const bumpDesignSeed = (seed) => (normalizeDesignSeed(seed) + 1) % (DESIGN_SEED_MAX + 1);

// pure — the design-mode preview request shape: {text, description, seed} and
// NEVER a ref field — the sidecar 400s description+ref in one request, and
// design mode without a seed. Seed is REQUIRED, normalized into contract range.
export const buildDesignPreviewRequest = ({ text, description, seed } = {}) => ({
  text: String(text ?? ''),
  description: String(description ?? ''),
  seed: normalizeDesignSeed(seed),
});

// pure — the forge preview POST body per mode: a design session carries the
// design triple through to the provider; a clone/preset session keeps the
// untouched {text, recordSnapshot} shape (clone's ref rides the session's
// candidate server-side, never this body).
export const buildPreviewBody = ({ text, recordSnapshot, design } = {}) =>
  JSON.stringify(design ? { ...design, text, recordSnapshot } : { text, recordSnapshot });

// impure — POST the preview request; resolves the raw Response plus its audio
// metadata. Keeps its own fetch: the success body is binary and the metadata
// rides response headers — apiCall resolves parsed JSON.
const fetchPreview = async (sessionId, { text, recordSnapshot, design } = {}) => {
  const res = await fetch(`/api/v1/voice/forge/${sessionId}/preview`, {
    method: 'POST',
    headers: { ...jsonHeaders(), Accept: 'audio/*' },
    body: buildPreviewBody({ text, recordSnapshot, design }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `preview failed (${res.status})`);
  }
  return { res, meta: previewMeta(res) };
};

// impure — read a raw-PCM preview stream: whole sample frames are scheduled
// as they arrive (first audio starts while the body is still streaming) and
// every byte accumulates into the returned take. Bytes are carried across
// reads until they fill a whole frame, so a sample the transport splits is
// never played torn; a trailing partial frame stays in the take but is not
// scheduled (the same truncation pcmToFloat32Channels applies).
export const readPcmStream = async (body, { format, sampleRate, channels, scheduler }) => {
  if (!body || typeof body.getReader !== 'function') throw new Error('preview stream unreadable');
  const frameBytes = ((format || '').toLowerCase() === 'pcm_f32le' ? 4 : 2) * Math.max(1, (channels | 0) || 1);
  const meta = { format, sampleRate, channels };
  const reader = body.getReader();
  const chunks = [];
  let carry = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    chunks.push(value);
    const merged = new Uint8Array(carry.length + value.length);
    merged.set(carry, 0);
    merged.set(value, carry.length);
    const whole = merged.length - (merged.length % frameBytes);
    if (whole > 0 && scheduler) scheduler.pushChunk(merged.subarray(0, whole), meta);
    carry = merged.slice(whole);
  }
  if (scheduler) await scheduler.idle();
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  return bytes;
};

// impure — branch a preview Response by content-type. Cloud mp3 honestly keeps
// the whole-take blob path (NFR-6: decodeAudioData / the <audio> element
// handles mp3 — it is never fake-streamed as PCM); raw PCM streams into a
// voice scheduler while the body is still arriving.
export const readPreviewResponse = async (res, { createContext, onScheduler, shouldAbort } = {}) => {
  const meta = previewMeta(res);
  if (meta.contentType.includes('mpeg') || meta.contentType.includes('mp3') || !res.body) {
    const blob = await res.blob();
    return { blob, ...meta, streamed: false, scheduler: null };
  }
  const scheduler = createVoiceScheduler({ createContext });
  if (shouldAbort?.()) {
    // Cancel landed before publish — dispose terminally so the draining body
    // never sounds a single chunk from this take.
    scheduler.dispose();
  } else {
    // Gesture-backed: every preview starts from a click, so resume immediately.
    // And publish the scheduler BEFORE the first chunk lands — a cancel/
    // teardown mid-stream must be able to interrupt the audio that is
    // actually sounding, not wait for the body to drain.
    scheduler.resume();
    if (onScheduler) onScheduler(scheduler);
  }
  const pcmBytes = await readPcmStream(res.body, { ...meta, scheduler });
  // `streamed` means actually heard live: unsupported Web Audio falls back to
  // whole-take playback (the player autoplays, exactly like the mp3 path).
  return { blob: new Blob([pcmBytes], { type: meta.contentType }), ...meta, streamed: scheduler.isSupported(), scheduler };
};

// impure — streaming preview synthesis. A raw-PCM engine's take plays through
// a scheduler while it is still arriving; a cloud mp3 take honestly resolves
// whole (NFR-6: the blob path is reserved for mp3, never fake-streamed).
// Always resolves the full take as a Blob plus audio metadata, `streamed`
// (false on the mp3/blob path), and the live `scheduler` (null when not
// streaming). `onScheduler` fires with the live scheduler the moment it is
// created — before the first chunk — so callers can interrupt mid-stream.
// `shouldAbort` is checked once at creation: if the caller was cancelled
// before the scheduler existed, it is disposed terminally so nothing sounds.
// `design` is the design-mode request triple (buildDesignPreviewRequest) —
// present only on design sessions, never carrying a ref field.
export const streamPreview = async (sessionId, { text, recordSnapshot = false, design, createContext, onScheduler, shouldAbort } = {}) => {
  const { res } = await fetchPreview(sessionId, { text, recordSnapshot, design });
  return readPreviewResponse(res, { createContext, onScheduler, shouldAbort });
};

// The DESIGN card's two preview texts — the short probe for a fast first
// listen on the batch path, and the full line. Exported so the card and its
// tests share one source of truth (never a duplicated literal to desync).
export const DESIGN_PROBE_TEXT = 'A voice forms from the void.';
export const DESIGN_FULL_TEXT = 'The neuma speaks its first words from the void.';

// impure — one-off preset audition at the offering stage: no forge session,
// just the named engine speaking the named preset. The route answers with the
// exact forge-preview contract, so the same streaming reader plays it.
export const auditionEngineVoice = async (engineId, { voiceId, text, onScheduler, shouldAbort } = {}) => {
  const res = await fetch(`/api/v1/voice/engines/local/${engineId}/audition`, {
    method: 'POST',
    headers: { ...jsonHeaders(), Accept: 'audio/*' },
    body: JSON.stringify({ voiceId, text }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `audition failed (${res.status})`);
  }
  return readPreviewResponse(res, { onScheduler, shouldAbort });
};

// impure — seal the voice DNA, optionally with a first-utterance journal entry.
// Never carries seed bytes: the route rejects them (consent gate lives at the
// offering) and the server seals the validated offering's audio.
export const sealVoice = async (sessionId, { firstUtterance } = {}) =>
  apiCall('POST', `/api/v1/voice/forge/${sessionId}/seal`, {
    body: { firstUtterance },
    errorPrefix: 'seal failed',
  });

// impure — abandon a session (it'll also TTL out on the server)
export const abandonForge = async (sessionId) => {
  try {
    await apiCall('DELETE', `/api/v1/voice/forge/${sessionId}`, { headers: authHeaders() || {} });
  } catch { /* best-effort */ }
};

// pure — wrap raw PCM bytes in a WAV container so <audio> can play it.
// Mirrors the test-harness wrapping. Returns a Blob (audio/wav).
export const pcmToWavBlob = (pcmBytes, { sampleRate = 24000, channels = 1, bytesPerSample = 2 }) => {
  const dataLen = pcmBytes.byteLength;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);                                 // fmt sub-chunk size (4-byte field)
  view.setUint16(20, 1, true);                                  // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcmBytes));
  return new Blob([view], { type: 'audio/wav' });
};
