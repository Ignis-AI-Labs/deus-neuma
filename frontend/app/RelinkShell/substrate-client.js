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

/**
 * What an ignite answer means to the desk. A house on another provider is not
 * a refusal but a QUESTION: the platform moves it to the local llama-server
 * only on the operator's word, so the answer carries `ask` for the bar to put
 * to them. Pure.
 * @param {boolean} ok - the HTTP answer was 2xx
 * @param {{status?: string, from?: string, error?: string}} body
 * @param {string|null} model - the model the ignite asked for (re-sent on confirm)
 * @returns {{ok: boolean, status?: string, error?: string, ask?: {from: string, model: (string|null)}}}
 */
export const igniteAnswer = (ok, body, model = null) => {
  if (ok) return { ok: true, status: body.status };
  if (body.status === 'switch-unconfirmed') return { ok: false, ask: { from: body.from || 'another provider', model } };
  return { ok: false, error: IGNITE_REFUSALS[body.status] || body.error || 'Ignition failed.' };
};

// impure — relight the supervised substrate (fire-and-observe; the poll reflects
// completion), optionally onto a cataloged model. Locks the connection to it.
// `confirmSwitch` is the operator's yes to moving a house off another provider.
// Returns igniteAnswer's shape. FAILURE-IN-BODY: the refusal text keys off
// the answer body's `status` (busy/unowned), which apiCall's thrown error does
// not carry — the round-trip stays manual so IGNITE_REFUSALS survives verbatim.
export const igniteSubstrate = async (model = null, { confirmSwitch = false } = {}) => {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const res = await fetch('/api/v1/llm/substrate/ignite', {
      method: 'POST', headers: jsonHeaders(),
      body: JSON.stringify({ ...(model ? { model } : {}), ...(confirmSwitch ? { confirmSwitch: true } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    return igniteAnswer(res.ok, body, model);
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
