// dream-client — the phone's (and desk's) hand on the dream journal
// (backend/routes/dream-routes.js). impure — HTTP with the session bearer
// (apiCall adds it; the two raw fetches carry audio, not JSON, and add it here).
import { apiCall, authHeadersOrNull } from '../utils/http.js';

const BASE = '/api/v1/user/dreams';

const headersOrThrow = () => {
  const headers = authHeadersOrNull();
  if (!headers) throw new Error('not signed in');
  return headers;
};

/** @returns {Promise<object[]>} the journal, newest first */
export const listDreams = async () => (await apiCall('GET', BASE, {
  strictJson: true, errorPrefix: 'Could not read the dream journal',
})).dreams;

/**
 * Hand a take to the desk. Resolves the kept entry; the same id twice is the same dream.
 * @param {{ id: string, blob: Blob, recordedAt: string, durationMs: number }} take
 */
export const sendDream = async ({ id, blob, recordedAt, durationMs }) => {
  const query = new URLSearchParams({ id, recordedAt, durationMs: String(Math.round(durationMs || 0)) });
  const res = await fetch(`${BASE}?${query}`, {
    method: 'POST',
    headers: { ...headersOrThrow(), 'Content-Type': blob.type || 'audio/webm' },
    body: blob,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `the desk did not keep the dream (${res.status})`);
  return body.dream;
};

/** Ask the desk for the words; the entry's transcript says when they land. */
export const transcribeDream = async (id) => (await apiCall('POST', `${BASE}/${encodeURIComponent(id)}/transcribe`, {
  errorPrefix: 'Could not start the words',
})).dream;

/** The recording as a Blob (an <audio> cannot carry the bearer itself). */
export const dreamRecording = async (id) => {
  const res = await fetch(`${BASE}/${encodeURIComponent(id)}/audio`, { headers: headersOrThrow() });
  if (!res.ok) throw new Error(`the recording did not come back (${res.status})`);
  return res.blob();
};

export const deleteDream = (id) => apiCall('DELETE', `${BASE}/${encodeURIComponent(id)}`, {
  errorPrefix: 'Could not delete the dream',
});
