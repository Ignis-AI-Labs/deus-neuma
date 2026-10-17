// substrate-ignition.js — relight a downed substrate without leaving the app.
//
// impure — talks to the platform's ignition endpoints. The backend drives the
// LM Studio CLI; the desk only requests and observes.

import { apiCall } from '../utils/http.js';

const POLL_MS = 3000;
const MAX_WAIT_MS = 10 * 60 * 1000;

// impure — current ignition state; null when the endpoint is unreachable
export const getIgnitionStatus = async () => {
  try {
    return await apiCall('GET', '/api/v1/llm/substrate/ignition', { strictJson: true });
  } catch {
    return null;
  }
};

// impure — request the load; { status } or throws with the server's reason
const requestIgnition = async () =>
  apiCall('POST', '/api/v1/llm/substrate/ignite', { errorPrefix: 'Ignition request failed' });

// impure — resolves true once the target model is loaded, false on failure
// or timeout. Polls the status endpoint; a lastError newer than the request
// means the load died — surface that instead of spinning forever.
export const igniteAndWait = async () => {
  const started = Date.now();
  const request = await requestIgnition();
  if (request.status === 'already-loaded') return true;

  while (Date.now() - started < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const status = await getIgnitionStatus();
    if (status?.targetLoaded) return true;
    if (status && !status.igniting && status.lastError) return false;
  }
  return false;
};
