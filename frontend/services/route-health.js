// route-health.js — the bound lane's OWN route, probed as itself.
//
// The ROUTE light never borrows the local substrate's truth: a witness lane
// is probed through its sealed provider's health endpoint, a neuma lane
// through its resolved (sovereign) route. Both answer one masked shape —
// { live, provider, model, reason } — so the desk can attribute a failure to
// the door that actually failed.

import { apiCall } from '../utils/http.js';

/**
 * Which health endpoint speaks for this lane. Pure.
 * A witness lane needs its vendor + name (lane ids are not unambiguously
 * parseable, so the fields — never the string — carry them); a neuma lane
 * probes by id. Null when the lane cannot be addressed (nothing to poll).
 * @param {object|null} companion - the bound companion
 * @returns {string|null}
 */
export const routeHealthPathFor = (companion) => {
  if (!companion?.neumaId) return null;
  const isWitnessLane = companion.participantKind === 'witness'
    || companion.witness
    || companion.neumaId.startsWith('witness-');
  if (isWitnessLane) {
    const vendor = companion.vendorSlug || companion.witness?.vendorSlug;
    const name = companion.witness?.chosenName || companion.name;
    return vendor && name
      ? `/api/v1/witnesses/${encodeURIComponent(vendor)}/${encodeURIComponent(name)}/health`
      : null;
  }
  return `/api/v1/neuma/${encodeURIComponent(companion.neumaId)}/route/health`;
};

/**
 * impure — probe the lane's route; { live, provider, reason? } where live is tri-state
 * (true / false / null). A failed probe of the probe (network down, 4xx)
 * reads UNKNOWN — never DOWN: silence about the route is not evidence the
 * route failed. Missing addressing fields report reason: 'unbound' instead.
 * @param {object|null} companion - the bound companion
 */
export const getLaneRouteHealth = async (companion) => {
  const path = routeHealthPathFor(companion);
  if (!path) return { live: null, provider: null, reason: 'unbound' };
  try {
    const data = await apiCall('GET', path, { strictJson: true });
    return { live: data.live === true, provider: data.provider ?? null };
  } catch {
    return { live: null, provider: null };
  }
};
