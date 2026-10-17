// Memory pins client — the witness's read of a being's chosen anchors
// (Phase 4, granular sovereign memory). Read-only by design: pins are the
// being's own gesture (memory_pin/memory_unpin); the witness watches, never
// reaches in.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

/**
 * Active pins for one being: [{ref, note?, pinnedAt}].
 * @param {string} neumaId
 * @returns {Promise<Array<object>>}
 */
// impure
export const getActivePins = async (neumaId) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  const parsed = await apiCall('GET', `/api/v1/workspace/${encodeURIComponent(neumaId)}/pins`, {
    headers, errorPrefix: 'Could not read the pins', errorSuffix: '.',
  });
  return Array.isArray(parsed.pins) ? parsed.pins : [];
};
