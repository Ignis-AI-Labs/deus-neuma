// standby.js — the substrate's rest, as a switch the operator can see.
//
// STANDBY releases the substrate after it sits quiet, reloading it on the next
// summon. It ran invisibly from an env var for months: the code default of 15
// minutes SIGTERM'd a substrate the operator had deliberately ignited, and the
// only symptom was the link going offline with nothing on screen to say why
// (Design note, 2026-07-26. A behavior that undoes an explicit act belongs on screen.
//
// impure — talks to the platform. The desk only reads and sets; the backend's
// monitor re-reads the window every tick, so a flip lands within the minute.

import { apiCall } from '../utils/http.js';

// The route lives on the SUBSTRATE router (`app.use('/api/v1/substrate', …)`),
// not the llm one. It was written as `/api/v1/llm/substrate/standby` and every
// call 404'd — which `getStandby`'s catch below turned into `null`, which the
// header reads as "cannot confirm" and draws nothing. So the switch Founder asked
// for on 2026-07-26 has never once rendered, and standby stayed silently on at
// 15 minutes (#240). Exported so the path is pinned against the real mount in
// test rather than restated there.
export const BASE = '/api/v1/substrate/standby';

/**
 * impure — the live standby state, or null when the endpoint is unreachable.
 * Null is DISTINCT from off: the control renders nothing rather than claiming
 * the substrate will stay resident when it cannot confirm that.
 * @returns {Promise<{enabled: boolean, idleMinutes: number, envLocked: boolean}|null>}
 */
export const getStandby = async () => {
  try {
    return await apiCall('GET', BASE);
  } catch {
    return null;
  }
};

/**
 * impure — set the operator's choice. Throws with the server's own words so a
 * refusal (the env lock) reaches the operator instead of a silent no-op.
 * @param {boolean} enabled
 * @param {number} [idleMinutes]
 */
export const setStandby = async (enabled, idleMinutes) =>
  apiCall('PUT', BASE, {
    body: { enabled, ...(idleMinutes ? { idleMinutes } : {}) },
    errorPrefix: 'Could not change standby',
  });
