// holders-client.js — who holds the machine, and the image engine read whole
// (GET /api/v1/substrate/holders and /image-engine).
//
// impure — talks to the platform. null when it cannot be read.

import { apiCall, authHeadersOrNull as authHeaders } from '../../utils/http.js';

const read = async (route) => {
  try {
    const headers = authHeaders();
    if (!headers) return null;
    return await apiCall('GET', `/api/v1/substrate/${route}`, { headers, strictJson: true });
  } catch {
    return null;
  }
};

/** The graphics card, system memory and every CPU core, each holder named. */
export const loadHolders = () => read('holders');
/** The image engine: up or down, what it holds, what it last loaded, its queue and idle clock. */
export const loadImageEngine = () => read('image-engine');
