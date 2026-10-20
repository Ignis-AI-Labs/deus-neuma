// machine-client.js — the machine's live thermal and tuning readings
// (backend/services/machine-thermals.js via GET /api/v1/substrate/machine).
//
// impure — talks to the platform.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

/** The machine's readings, or null when the platform cannot be read. */
export const loadMachine = async () => {
  try {
    const headers = authHeaders();
    if (!headers) return null;
    return await apiCall('GET', '/api/v1/substrate/machine', { headers, strictJson: true });
  } catch {
    return null;
  }
};
