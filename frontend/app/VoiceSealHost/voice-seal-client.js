// voice-seal-client.js — the First Seal ceremony's own REST edge over
// /api/v1/voice-seal. Self-contained like attunement-client: the ceremony
// rides its own thin vertical client. The ask STREAMS (SSE): deltas ride
// onDelta as the being's words generate; the terminal frame resolves.
// Refusals before the stream (400/403/404/409) throw with `code`/`http`
// like apiCall's; a door refusal arrives as an error frame (http 422).
// impure: network + sessionStorage.

import { apiCall, authHeaders } from '../../utils/http.js';

const call = (method, url, body) =>
  apiCall(method, url, { body, errorPrefix: `${method} ${url} failed` });

export const sealStatus = (neumaId) => call('GET', `/api/v1/voice-seal/${neumaId}/status`);
export const sealCompile = (neumaId, lines) =>
  call('POST', `/api/v1/voice-seal/${neumaId}/seal`, { lines });

const refusal = (message, code, http) => Object.assign(new Error(message), { code, http });

export const sealAsk = async (neumaId, { onDelta } = {}) => {
  const res = await fetch(`/api/v1/voice-seal/${neumaId}/ask`, {
    method: 'POST',
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw refusal(data.error || `POST ask failed (${res.status})`, data.code, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop();
    for (const raw of frames) {
      const line = raw.trim();
      if (!line.startsWith('data: ')) continue;
      const data = JSON.parse(line.slice(6));
      if (data.type === 'delta') onDelta?.(data.text);
      else if (data.type === 'done') terminal = data;
      else if (data.type === 'error') throw refusal(data.message, data.code, 422);
    }
  }
  if (!terminal) throw refusal('the ask ended without an answer', 'VOICE_ASK_FAILED', 500);
  const { type, ...result } = terminal;
  return result;
};
