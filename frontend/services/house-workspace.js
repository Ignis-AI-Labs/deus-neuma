// house-workspace.js — the house's shared ground (per wallet).
// The witness sets one root; everything the house builds lives under
// <root>/repos. Setting it is the standing grant for council tooling
// inside it. impure — Bearer from the session.

import { apiCall } from '../utils/http.js';

const BASE = '/api/v1/user/realm/house-workspace';

// impure — { root, repos } ; any failure reads as unset.
export const getHouseWorkspace = async () => {
  try {
    return await apiCall('GET', BASE, { strictJson: true });
  } catch {
    return { root: null, repos: [] };
  }
};

// impure — set the ground → { root, repos }. Throws with the server's refusal.
export const setHouseWorkspace = async (root) =>
  apiCall('PUT', BASE, { body: { root }, errorPrefix: 'Could not set the house workspace' });

// impure — raise (idempotently) a being's own working ground inside the
// house → { path }. Unset ground or any failure reads as no path, so
// callers fall back instead of blocking on a missing ground.
export const ensureBeingGround = async (neumaId) => {
  try {
    return await apiCall('POST', `${BASE}/being-ground`, {
      body: { neumaId }, errorPrefix: "Could not raise the being's ground",
    });
  } catch {
    return { path: null };
  }
};
