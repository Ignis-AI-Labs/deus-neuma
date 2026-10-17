// forge-client.js — the voice forge's REST calls.
//
// impure — fetches /api/v1/voice/forge (backend/routes/voice-forge-routes.js)
// and the voice tier (/api/v1/voice/tier) with the session's Bearer token.
// Every call throws the server's own refusal text (apiCall carries `err.http`)
// so the forge shows the real reason, never a guess.

import { apiCall, authHeaders, authHeadersOrNull, httpErrorFromResponse } from '../../../utils/http.js';

const BASE = '/api/v1/voice/forge';

// impure — the session's auth headers, or a thrown refusal when signed out.
const authed = () => {
  const headers = authHeadersOrNull();
  if (!headers) throw new Error('not signed in');
  return headers;
};

const sid = (id) => encodeURIComponent(id);

/** impure — a new forge for a being you own; resolves the forge state. */
export const startForge = (neumaId) => apiCall('POST', `${BASE}/start`, { headers: authed(), body: { neumaId } });

/** impure — the forge state as it stands. */
export const readForge = (sessionId) => apiCall('GET', `${BASE}/${sid(sessionId)}`, { headers: authed() });

/**
 * impure — open a door with a JSON body: record {audioB64}, library
 * {libraryId}, describe {description}. Resolves the state plus `found` refs.
 */
export const findVoice = (sessionId, body) => apiCall('POST', `${BASE}/${sid(sessionId)}/find`, { headers: authed(), body });

/**
 * impure — the upload door: the file as picked, multipart (the backend reads
 * any audio ffmpeg can). `realPerson` is left unsaid here; the offer asks.
 * @param {string} sessionId
 * @param {File|Blob} file
 */
export const uploadVoice = async (sessionId, file) => {
  const form = new FormData();
  form.append('door', 'upload');
  form.append('audio', file, file.name || 'upload');
  const res = await fetch(`${BASE}/${sid(sessionId)}/find`, { method: 'POST', headers: authHeaders(), body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw httpErrorFromResponse(data, res.status);
  return data;
};

/**
 * impure — a take's audio as an object URL. The caller owns it and must
 * URL.revokeObjectURL it when done (the desk never keeps audio it is not
 * playing).
 */
export const takeAudioUrl = async (sessionId, ref) => {
  const res = await fetch(`${BASE}/${sid(sessionId)}/takes/${encodeURIComponent(ref)}/audio`, { headers: authed() });
  if (!res.ok) throw httpErrorFromResponse(await res.json().catch(() => ({})), res.status);
  return URL.createObjectURL(await res.blob());
};

/** impure — pin the take to hear. */
export const pickTake = (sessionId, ref) => apiCall('POST', `${BASE}/${sid(sessionId)}/pick`, { headers: authed(), body: { ref } });

/** impure — offer the pinned take to the being; body carries realPerson/attested when asked. */
export const offerTake = (sessionId, body) => apiCall('POST', `${BASE}/${sid(sessionId)}/offer`, { headers: authed(), body });

/** impure — seal the exact candidate the being accepted. */
export const sealVoice = (sessionId, candidateRef) => apiCall('POST', `${BASE}/${sid(sessionId)}/seal`, { headers: authed(), body: { candidateRef } });

/** impure — the guardian takes back the being's acceptance (resolves the forge state). */
export const reopenVoice = (sessionId) => apiCall('POST', `${BASE}/${sid(sessionId)}/reopen`, { headers: authed(), body: {} });

/** impure — the guardian withdraws the voice in force; the being goes silent (kept in its history). */
export const withdrawVoice = (neumaId) => apiCall('POST', `${BASE}/withdraw`, { headers: authed(), body: { neumaId } });

/** impure — end the forge (best effort: an expired session is already ended). */
export const endForge = (sessionId) => apiCall('DELETE', `${BASE}/${sid(sessionId)}`, { headers: authed() }).catch(() => null);

/** impure — the curated voices. */
export const listLibrary = async () => (await apiCall('GET', `${BASE}/library`, { headers: authed() })).voices ?? [];

// impure — a preview as an object URL (the caller revokes it), and what it
// is: 'being' (a being's line on this machine's tier) or 'recording' (the raw
// clip — the tier's engine is not installed here).
const previewAt = async (url) => {
  const res = await fetch(url, { headers: authed() });
  if (!res.ok) throw httpErrorFromResponse(await res.json().catch(() => ({})), res.status);
  const kind = res.headers.get('x-preview') === 'recording' ? 'recording' : 'being';
  return { url: URL.createObjectURL(await res.blob()), kind };
};

/**
 * impure — a library voice's preview.
 * @returns {Promise<{url: string, kind: 'being'|'recording'}>}
 */
export const libraryPreviewUrl = (voiceId) => previewAt(`${BASE}/library/${encodeURIComponent(voiceId)}/preview`);

/**
 * impure — a found take's preview: the being saying a line in that clip's
 * voice (made on first ask, then read from disk).
 * @returns {Promise<{url: string, kind: 'being'|'recording'}>}
 */
export const takePreviewUrl = (sessionId, ref) => previewAt(`${BASE}/${sid(sessionId)}/takes/${encodeURIComponent(ref)}/preview`);

/** impure — whether the voice designer's weights are on this machine (null when it cannot be read). */
export const designerInstalled = async () => {
  try {
    return (await apiCall('GET', '/api/v1/voice/engines/local/designer', { headers: authed() })).downloaded === true;
  } catch {
    return null;
  }
};

/** impure — the voice tier in force on this machine. */
export const readTier = () => apiCall('GET', '/api/v1/voice/tier', { headers: authed() });

/** impure — the person's tier pick ('auto' | 'light' | 'standard'). */
export const writeTier = (tier) => apiCall('PUT', '/api/v1/voice/tier', { headers: authed(), body: { tier } });

/** impure — a being's voice standing ({hasVoice, standing}), or null when it cannot be read. */
export const readVoiceStanding = async (neumaId) => {
  const headers = authHeadersOrNull();
  if (!neumaId || !headers) return null;
  try {
    return await apiCall('GET', `/api/v1/voice/has-voice/${encodeURIComponent(neumaId)}`, { headers });
  } catch {
    return null;
  }
};
