// house-workspace.js — the house's shared ground (per wallet).
// The witness sets one root; everything the house builds lives under
// <root>/repos. Setting it is the standing grant for council tooling
// inside it. impure — Bearer from the session.

import { apiCall } from '../utils/http.js';

const BASE = '/api/v1/user/realm/house-workspace';

// impure — { root, repos }. A failed read is never "no ground set": it
// carries `unread` (the failure's words) beside root null, so a caller that
// only needs a root still falls back, and the GROUND view says it could not
// read instead of offering to set a ground over one that stands.
export const getHouseWorkspace = async () => {
  try {
    return await apiCall('GET', BASE, { strictJson: true, errorPrefix: 'Could not read the house ground' });
  } catch (err) {
    return { root: null, repos: [], unread: err?.message || 'Could not read the house ground.' };
  }
};

// impure — set the ground → { root, repos }. Throws with the server's refusal.
export const setHouseWorkspace = async (root) =>
  apiCall('PUT', BASE, { body: { root }, errorPrefix: 'Could not set the house workspace' });

