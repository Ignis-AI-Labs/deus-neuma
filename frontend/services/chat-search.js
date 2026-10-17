import { apiCall } from '../utils/http.js';

/** impure — search only the authenticated participant's saved chat contents. */
export const searchChatContents = async (neumaId, query, signal) => {
  const result = await apiCall('GET', `/api/v1/workspace/${encodeURIComponent(neumaId)}/session-search?q=${encodeURIComponent(query)}`, {
    signal, strictJson: true,
  });
  if (!Array.isArray(result.matches)) throw new Error('Chat search returned an invalid result.');
  return result.matches;
};
