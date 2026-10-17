// substrate-health.js — is the neuma's LLM substrate actually reachable?
//
// impure — polls the platform's existing provider-health endpoint (the same
// testConnection() probe the backend uses), so the desk can tell the truth
// about whether a neuma can think, not just whether the portal socket is open.

import { apiCall } from '../utils/http.js';

// impure — { reachable, standby, provider, model }. Reachable is tri-state:
// true / false / null. Only a successful provider body may assert OFFLINE
// (reachable:false). Transport failure, 429, auth refusal, and 5xx are
// CHECKING (reachable:null) — silence about the substrate is not evidence
// it is down. Reachable-true still requires an actual substrate model to
// be linked, not just a responding endpoint: a provider with only auxiliary
// service models loaded (activeModel null) cannot think, and calling that
// ACTIVE broke the stream while the header claimed all was well. `standby`
// is the backend's deliberate-rest truth — an idle-unloaded substrate is
// resting, never down.

/**
 * Pure — map a completed provider-health HTTP result onto the desk's
 * tri-state. `ok` is the fetch Response's ok (2xx). A non-ok reply never
 * fabricates OFFLINE; only a 2xx body may.
 * @param {boolean} ok
 * @param {object|null} data parsed JSON body, ignored when !ok
 * @returns {{ reachable: boolean|null, standby: boolean, provider?: *, model?: * }}
 */
export const substrateHealthFromProbe = (ok, data) => (
  ok
    ? {
        reachable: data.status === 'connected' && Boolean(data.activeModel),
        standby: data.standby === true,
        provider: data.provider,
        model: data.activeModel,
      }
    : { reachable: null, standby: false }
);

export const getSubstrateHealth = async () => {
  try {
    const data = await apiCall('GET', '/api/v1/llm/provider', { strictJson: true });
    return substrateHealthFromProbe(true, data);
  } catch {
    return { reachable: null, standby: false };
  }
};
