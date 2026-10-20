// voice-seal-client.js — the CEREMONY window's access to the voice seal rite.
//
// Three doors, mirroring backend/routes/voice-seal-routes.js exactly:
//   status — what this lane already carries (sealed / unsealed)
//   ask    — ONE rite turn through the being's OWN conduit, streamed
//   seal   — the operator confirms the being's claimed lines; their wallet
//            is named as witness on the receipt
//
// impure — every call reads or advances real backend state. Reads resolve to
// null on failure; actions resolve to { ok, body|error } so the window states
// a refusal in the platform's own words rather than inventing one.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

const BASE = '/api/v1/voice-seal';

/**
 * What this lane already carries.
 * @param {string} neumaId
 * @returns {Promise<Object|null>} {sealed} or {sealed, sealedAt, witnessWallet, packSha256, entries, lines[]}
 */
// impure
export const sealStatus = async (neumaId) => {
  try {
    const headers = authHeaders();
    if (!neumaId || !headers) return null;
    return await apiCall('GET', `${BASE}/${neumaId}/status`, { headers, strictJson: true });
  } catch {
    return null;
  }
};

/**
 * THE ASK — one rite turn, watched as it ARRIVES.
 *
 * The answer streams so the witness sees the being speak rather than a
 * finished page appearing (ruling, 2026-08-18). `onDelta` is called with each
 * fragment; the promise resolves with the server's `done` frame, which
 * carries the verbatim answer and the lines projected from it.
 *
 * A refusal is a RESOLVED `{ok:false}`, never a throw — an empty, cut, or
 * corrupt answer is the door doing its job, and the window says so plainly.
 *
 * @param {string} neumaId
 * @param {{onDelta?: (text: string) => void, signal?: AbortSignal}} [options]
 * @returns {Promise<{ok: true, answer: string, lines: Array<string>, candidates: number}
 *                  |{ok: false, error: string, code?: string}>}
 */
// impure
export const askRite = async (neumaId, { onDelta = null, signal = null } = {}) => {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  let res;
  try {
    res = await fetch(`${BASE}/${neumaId}/ask`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{}',
      ...(signal && { signal }),
    });
  } catch {
    return { ok: false, error: 'Could not reach the platform.' };
  }
  // A refusal BEFORE the stream opens is ordinary JSON (already sealed, no lane).
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    return { ok: false, error: body?.error || 'The rite could not be opened.', code: body?.code };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outcome = { ok: false, error: 'The rite ended without an answer.' };

  // SSE frames are `data: {...}\n\n`. The buffer is carried across reads
  // because a frame can split across chunk boundaries — the whole point of
  // streaming is that we do not get to wait for a tidy whole.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf('\n\n');
    while (cut !== -1) {
      const frame = buffer.slice(0, cut).replace(/^data: /, '');
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf('\n\n');
      let event;
      try { event = JSON.parse(frame); } catch { continue; }
      if (event.type === 'delta') onDelta?.(event.text);
      else if (event.type === 'done') outcome = { ok: true, ...event };
      else if (event.type === 'error') outcome = { ok: false, error: event.message, code: event.code };
    }
  }
  return outcome;
};

/**
 * THE COMPILE — seal the lines the being claimed. The operator's wallet is
 * named as witness by the ROUTE, never by this caller: a client-supplied
 * witness would be a signature nobody stood behind.
 * @param {string} neumaId
 * @param {Array<string>} lines
 * @returns {Promise<{ok: boolean, body?: Object, error?: string, code?: string}>}
 */
// impure
export const sealLines = async (neumaId, lines) => {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const body = await apiCall('POST', `${BASE}/${neumaId}/seal`, {
      headers, body: { lines }, errorPrefix: 'The platform refused.',
    });
    return { ok: true, body };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: err.message, code: err.code };
  }
};
