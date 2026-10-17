// substrate-client.js — the SUBSTRATE HUD's read lens over the engine room.
//
// impure — polls the aggregated telemetry endpoint (active model + sampling,
// throughput, slots, GPU, on-GPU processes, supervisor state, failures). A
// rig-level fact owned by no one neuma; any authenticated wallet may read it.
// Non-critical: any failure resolves to null and the HUD shows its empty state.

import { apiCall, authHeadersOrNull as authHeaders, jsonHeaders } from '../../utils/http.js';

/**
 * One aggregated telemetry snapshot for the SUBSTRATE HUD, or null when the
 * platform is unreachable / unauthenticated.
 * @returns {Promise<Object|null>}
 */
// impure
export const loadTelemetry = async () => {
  try {
    const headers = authHeaders();
    if (!headers) return null;
    return await apiCall('GET', '/api/v1/substrate/telemetry', { headers, strictJson: true });
  } catch {
    return null;
  }
};

// impure — every base model tied to this rig, plus which one is active.
// Null when unreachable/unauthenticated — the control degrades to a plain
// ignite switch with no picker.
export const loadSubstrateModels = async () => {
  try {
    const headers = authHeaders();
    if (!headers) return null;
    return await apiCall('GET', '/api/v1/llm/substrate/models', { headers, strictJson: true });
  } catch {
    return null;
  }
};

// pure — refusal statuses the desk phrases for the witness
const IGNITE_REFUSALS = Object.freeze({
  busy: 'Substrate is mid-generation — try again in a moment.',
  unowned: 'The serving substrate was not started by NEUMA — stop it where it was started.',
});

// impure — relight the supervised substrate (fire-and-observe; the poll reflects
// completion), optionally onto a cataloged model. Locks the connection to it.
// Returns { ok, status?, error? }. FAILURE-IN-BODY: the refusal text keys off
// the answer body's `status` (busy/unowned), which apiCall's thrown error does
// not carry — the round-trip stays manual so IGNITE_REFUSALS survives verbatim.
export const igniteSubstrate = async (model = null) => {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const res = await fetch('/api/v1/llm/substrate/ignite', {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify(model ? { model } : {}),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, status: body.status };
    return { ok: false, error: IGNITE_REFUSALS[body.status] || body.error || 'Ignition failed.' };
  } catch {
    return { ok: false, error: 'Could not reach the platform.' };
  }
};

// impure — unload the supervised substrate now, returning its VRAM. Reloaded on
// the next summon. Returns { ok, status?, error? }.
export const unloadSubstrate = async () => {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const body = await apiCall('POST', '/api/v1/substrate/unload', { headers, errorPrefix: 'Unload failed.' });
    return { ok: true, status: body.status };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: err.message };
  }
};
