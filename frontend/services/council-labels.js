// council-labels.js — the operator's own names for their councils (per wallet).
// A council's default label is its member roster; this overlays a custom name,
// and the conduit can write one from what was deliberated.
// impure — Bearer from the session.

import { apiCall } from '../utils/http.js';

const BASE = '/api/v1/user/realm/council-labels';

// impure — { "<councilId>": "label" }; any failure reads as empty.
export const getCouncilLabels = async () => {
  try {
    return (await apiCall('GET', BASE, { errorPrefix: 'Could not read council labels' })).labels || {};
  } catch {
    return {};
  }
};

// impure — set or clear (empty label) a council's name → the updated label map.
export const setCouncilLabel = async (councilId, label) =>
  (await apiCall('PUT', BASE, { body: { councilId, label }, errorPrefix: 'Rename failed' })).labels || {};

