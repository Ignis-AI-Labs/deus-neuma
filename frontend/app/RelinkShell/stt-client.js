// stt-client.js — REST client for witness dictation.
//
// impure — the reverse of voice-sink.js (the being's voice OUT): witness audio
// IN, words back.
// Bearer-token auth follows the same pattern.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';
import { toWav16k } from '../../utils/wav16k.js';

// impure — wake the whisper sidecar so the model is loading while the witness
// is still speaking. Fire-and-forget: transcribe() launches it anyway if this
// never lands.
export const warmTranscriber = () => {
  const headers = authHeaders();
  if (!headers) return;
  apiCall('POST', '/api/v1/voice/engines/local/whisper/launch', { headers })
    .catch(() => { /* best-effort warmup — transcribe() is the real gate */ });
};

// impure — send the recorded utterance, resolve to the transcript text.
// A missing-components refusal keeps its structure (err.code + err.missing)
// so the composer can prompt the install instead of flashing a bare error.
// { preview } asks for the fast live read; { signal } lets a stale one be dropped.
// The processor speech engine of an installed app reads only 16 kHz WAV: told so once (STT_WANTS_WAV),
// every later recording is converted before it is sent. It reads a hold once, on release, and answers
// a preview with 204: told so once, no later preview is sent (null = no preview from this engine).
let wantsWav = false;
let noPreviews = false;

export const transcribe = async (blob, { preview = false, signal } = {}) => {
  if (preview && noPreviews) return null;
  const headers = authHeaders();
  if (!headers) throw new Error('not signed in');
  const send = (body) => fetch(`/api/v1/voice/transcribe${preview ? '?preview=1' : ''}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': body.type || 'audio/webm' },
    body,
    signal,
  });
  let res = await send(wantsWav ? await toWav16k(blob) : blob);
  if (preview && res.status === 204) {
    noPreviews = true;
    return null;
  }
  if (res.status === 415 && !wantsWav) {
    const told = await res.json().catch(() => ({}));
    if (told.code === 'STT_WANTS_WAV') {
      wantsWav = true;
      res = await send(await toWav16k(blob));
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `transcription failed (${res.status})`);
    if (body.code) err.code = body.code;
    if (Array.isArray(body.missing)) err.missing = body.missing;
    throw err;
  }
  const body = await res.json();
  return body.text || '';
};

// impure — the whisper engine's readiness as the platform sees it, or null
// when unreachable. { ready, missing: ['uv'|'weights'] }.
export const dictationReadiness = async () => {
  try {
    const headers = authHeaders();
    if (!headers) return null;
    const body = await apiCall('GET', '/api/v1/voice/engines/local/whisper', { headers, strictJson: true });
    return body.readiness ?? null;
  } catch {
    return null;
  }
};

// impure — start the whisper weights download (the app's own data — the
// platform drives it). Resolves { ok, error? }.
export const startModelDownload = async () => {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  try {
    await apiCall('POST', '/api/v1/voice/engines/local/whisper/download', { headers, errorPrefix: 'Download did not start.' });
    return { ok: true };
  } catch (err) {
    if (err.http === 409) return { ok: true }; // 409 = already running — join it
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: err.message };
  }
};

// impure — the running download's state: { state: 'idle'|'running'|'succeeded'|'failed', error? }
export const modelDownloadStatus = async () => {
  try {
    const headers = authHeaders();
    if (!headers) return null;
    return await apiCall('GET', '/api/v1/voice/engines/local/whisper/download/status', { headers, strictJson: true });
  } catch {
    return null;
  }
};
