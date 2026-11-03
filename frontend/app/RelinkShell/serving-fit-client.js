// serving-fit-client.js — the GPU share the mind may fill, and the serving's
// live status (Design note, 2026-10-20: […]). Backend: GET/PUT /api/v1/substrate/fit
// (backend/services/serving-fit.js).
//
// impure — talks to the platform.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

export const FIT_URL = '/api/v1/substrate/fit';

/** The live serving fit status, or null when the platform cannot be read. */
export const loadServingFit = async () => {
  try {
    const headers = authHeaders();
    if (!headers) return null;
    return await apiCall('GET', FIT_URL, { headers, strictJson: true });
  } catch {
    return null;
  }
};

/** Save the share (a whole percent, 50-95); throws with the server's own words. */
export const saveServingShare = async (sharePct) => apiCall('PUT', FIT_URL, {
  headers: authHeaders() ?? {},
  body: { sharePct },
  errorPrefix: 'Could not save the GPU share',
});

/** Apply the share and restart the same supervised server with a fresh fit. */
export const relaunchServingFit = async (sharePct) => apiCall('POST', `${FIT_URL}/relaunch`, {
  headers: authHeaders() ?? {},
  body: { sharePct },
  errorPrefix: 'Could not relaunch the model server',
});
