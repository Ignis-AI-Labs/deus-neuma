// vessel-client.js — VESSEL's feeds over REST: the human vessel's vitals,
// each being's record/benchmarks/refinement, and the rig's shared facts.
//
// impure — one JSON call per function through the shared transport; errors
// propagate untouched (a 400 carries the server's correction on `err.message`
// with `err.http === 400`, shown verbatim). The single exception is
// fetchTelemetry, which follows the SUBSTRATE HUD's idiom: a non-critical
// poll that resolves to null on any failure rather than throwing.

import { apiCall, authHeadersOrNull } from '../../utils/http.js';

/** The witness's vitals, newest-first. impure — network. @returns {Promise<{entries}>} */
export const fetchVitals = (limit = 15) => apiCall('GET', `/api/v1/vitals/mine?limit=${limit}`);

/** The witness's vitals summary. impure — network. @returns {Promise<{summary}>} */
export const fetchVitalSummary = () => apiCall('GET', '/api/v1/vitals/mine/summary');

/** Log one vitals entry. impure — network. @returns {Promise<{entry}>} */
export const logVital = (fields) => apiCall('POST', '/api/v1/vitals/mine', { body: fields });

/** A being's record (identity, counts, substrate). impure — network. @returns {Promise<{record}>} */
export const fetchNeumaRecord = (neumaId) => apiCall('GET', `/api/v1/workspace/${neumaId}/stats`);

/** A being's refinement/evolution status. impure — network. @returns {Promise<Object>} */
export const fetchRefinementStatus = (neumaId) => apiCall('GET', `/api/v1/refinement/${neumaId}/status`);

/** The rig's capacity record. impure — network. @returns {Promise<{runs, current, measurable}>} */
export const fetchCapacity = () => apiCall('GET', '/api/v1/substrate/capacity');

/**
 * One telemetry snapshot for the LIVE strip, or null when the platform is
 * unreachable/unauthenticated — the strip shows its honest '—' either way
 * (the substrate-client.js loadTelemetry idiom).
 * @returns {Promise<Object|null>}
 */
// impure
export const fetchTelemetry = async () => {
  try {
    const headers = authHeadersOrNull();
    if (!headers) return null;
    return await apiCall('GET', '/api/v1/substrate/telemetry', { headers, strictJson: true });
  } catch {
    return null;
  }
};
