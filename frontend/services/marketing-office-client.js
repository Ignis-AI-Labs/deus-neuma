// marketing-office-client.js — the MARKETING board's own reads for its new
// panels over REST (/api/v1/marketing/office; backend marketing-office-routes.js):
// the house's locked weekly plan (CMO LOG), and what changed in one of its
// companies (COMPANY WATCH). Read-only; the signed-in house's own.
//
// impure — network.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

// impure
const get = (path) => {
  const headers = authHeaders();
  if (!headers) return Promise.reject(new Error('Not authenticated.'));
  return apiCall('GET', path, { headers, errorPrefix: 'Marketing read failed', errorSuffix: '.' });
};

/** The house's locked weekly plan ({plan: null} when none is locked). impure. */
export const getWeeklyPlan = () => get('/api/v1/marketing/office/plan');

/** What changed in one of the house's companies over the last 30 days ({watch}). impure. */
export const getCompanyWatch = (companyId) => get(`/api/v1/marketing/office/watch/${encodeURIComponent(companyId)}`);
