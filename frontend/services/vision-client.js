// vision-client.js — the operator's image-input switch, over REST.
import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

export const getVision = async () => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall('GET', '/api/v1/vision', { headers, errorPrefix: 'Could not read vision state' });
};

export const setVision = async (enabled) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall('PUT', '/api/v1/vision', {
    headers, body: { enabled: enabled === true }, errorPrefix: 'Could not switch vision',
  });
};
