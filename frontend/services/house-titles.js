// house-titles — the house's titles, as they stand and as they were: read them, correct or give one, trade
// two (backend/routes/roster-routes.js /titles, house-title-ledger.js). impure — network.
import { apiCall, authHeadersOrNull } from '../utils/http.js';

const BASE = '/api/v1/roster/titles';

/** Every member with its current title, its founding title and its résumé. */
export const listHouseTitles = async () => {
  const headers = authHeadersOrNull();
  if (!headers) return { members: [] };
  return apiCall('GET', BASE, { headers, strictJson: true });
};

/** Give one member a title (a correction, a new seat), with why. Resolves { change, members }. */
export const setHouseTitle = (neumaId, title, reason = '') =>
  apiCall('PUT', `${BASE}/${encodeURIComponent(neumaId)}`, { headers: authHeadersOrNull(), body: { title, reason }, errorPrefix: 'The title did not change.' });

/** Two members trade the titles they hold. Resolves { change, members }. */
export const tradeHouseTitles = (a, b, reason = '') =>
  apiCall('POST', `${BASE}/trade`, { headers: authHeadersOrNull(), body: { a, b, reason }, errorPrefix: 'The titles were not traded.' });
