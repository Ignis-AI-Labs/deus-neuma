// waiting-client.js — everything waiting on the signed-in operator, over REST
// (GET /api/v1/waiting, backend/routes/waiting-routes.js).
//
// impure — one authenticated read. Each item is decided through its own
// store's client (the queue's, the house clock's, a chat card's frame).

import { apiCall, authHeadersOrNull } from '../utils/http.js';

/**
 * The account: the true count, the oldest wait, every item oldest first, and
 * the sources that could not be read.
 * @returns {Promise<{count: number, oldestAt: ?string, items: object[], gaps: string[]}>}
 */
// impure
export const getWaiting = () => {
  const headers = authHeadersOrNull();
  if (!headers) return Promise.reject(new Error('Not authenticated.'));
  return apiCall('GET', '/api/v1/waiting', { headers, errorPrefix: 'Reading what waits on you failed' });
};
