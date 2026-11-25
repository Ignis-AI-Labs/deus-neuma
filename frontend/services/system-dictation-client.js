// system-dictation-client — dictation in every app, over REST (backend/routes/system-dictation-routes.js).
// impure. A change that could not be made throws the route's reason (install owner only, at the desk).
import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

const headersOrThrow = () => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return headers;
};

/** {on, key, keys, listening, readiness} */
export const getSystemDictation = () =>
  apiCall('GET', '/api/v1/system-dictation', { headers: headersOrThrow(), errorPrefix: 'Could not read dictation in every app' });

/** Turn it on or off, or choose its key; answers the same shape. */
export const setSystemDictation = (body) =>
  apiCall('PUT', '/api/v1/system-dictation', { headers: headersOrThrow(), body, errorPrefix: 'Could not change dictation in every app' });
