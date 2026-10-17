// capacity-client.js — the rig's parallel-capacity record, honestly.
//
// impure — talks to the non-:id substrate endpoints. Capacity is a RIG fact
// (shared by every neuma on this machine), so nothing here takes a neumaId:
// the same numbers render identically under every neuma's RECORD window,
// which is the visible proof they belong to the substrate, not the being.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

/**
 * A CAPACITY RECORD CHANGED. Every surface that holds a copy re-reads on this.
 *
 * Design note, 2026-08-29, with the SUBSTRATE window and the tab strip open side by
 * side: […] The SUBSTRATE window said
 * `~6 neuma working at once · MEASURED 1M AGO` while the strip, in the same
 * instant, refused a tab because […] Both read the SAME `latest` field — but the desk fetched it
 * ONCE on mount and nothing ever told it a scan had landed, so it went on
 * quoting a record the operator had already replaced. Only a full restart
 * cleared it.
 *
 * The window event idiom is the one settings-focus.js and task-focus.js
 * already use: no shared store, no coupling between the card and the desk, and
 * it crosses component trees that never meet.
 */
export const CAPACITY_CHANGED = 'neuma:capacity-changed';

// impure — tell every holder of a capacity copy that theirs is now old news.
export const announceCapacityChange = () => {
  try { window.dispatchEvent(new CustomEvent(CAPACITY_CHANGED)); } catch { /* no window: a test, or a worker */ }
};

/**
 * Load the capacity-scan history + latest full run + what the rig is serving
 * RIGHT NOW + whether this provider is measurable at all (remote APIs have no
 * local knee to observe).
 *
 * `current` and `latest.substrate` are stamped by the SAME substrate detector,
 * which is what makes them comparable: a measured ceiling belongs to the model
 * it was measured ON, and the only honest way to tell a live ceiling from a
 * stale one is to compare two names drawn from the same namespace. (The engine
 * room's telemetry names the served artifact — `gemma-4-31B-it-Q8_0.gguf` —
 * where the scan records the configured key `gemma-4-31b`. Comparing across
 * those two reports every correctly-measured rig as stale.)
 * @returns {Promise<{runs: Array, latest: Object|null, current: Object|null,
 *   measurable: boolean}|null>}
 */
// impure
export const loadCapacity = async () => {
  try {
    const headers = authHeaders();
    if (!headers) return null;
    return await apiCall('GET', '/api/v1/substrate/capacity', { headers, strictJson: true });
  } catch {
    return null;
  }
};

/**
 * Run a capacity scan — real concurrent inference against the live substrate.
 * Consent is the witness triggering this. Aborting the signal is a SOFT stop:
 * the request drops, the backend stops ramping between ladder levels, and
 * nothing is recorded — surfaced as { ok: false, stopped: true }, not an error.
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ok: boolean, result?: Object, error?: string, stopped?: boolean}>}
 */
// impure
export const runCapacityScan = async (signal) => {
  const headers = authHeaders();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const body = await apiCall('POST', '/api/v1/substrate/capacity', { headers, signal, errorPrefix: 'The scan could not be completed.' });
    // A NEW MEASUREMENT EXISTS — say so before returning, so the tab budget and
    // every other holder of a stale ceiling re-reads without a restart. An
    // aborted or failed scan records nothing and announces nothing.
    announceCapacityChange();
    return { ok: true, result: body.result };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, stopped: true };
    if (!error.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: error.message };
  }
};
