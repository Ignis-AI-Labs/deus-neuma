// marketing-results-client.js — the MARKETING overview's reads over REST:
// what the house's posts did (the stats sweep's results), the house's
// tracked links and its site counter, and the acts on them (read now, save
// the site token, publish waiting codes). The token goes in; it never comes
// back.
//
// impure — network.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

// impure
const req = (method, path, body) => {
  const headers = authHeaders();
  if (!headers) return Promise.reject(new Error('Not authenticated.'));
  return apiCall(method, `/api/v1/marketing${path}`, {
    headers, ...(body !== undefined ? { body } : {}), errorPrefix: 'Marketing request failed', errorSuffix: '.',
  });
};

/** Each sent post's latest reading and series, what cannot be read and why, the link counts. impure. */
export const getResults = () => req('GET', '/results');

/** Read the due posts now (the stats sweep, on demand). impure. */
export const sweepResults = () => req('POST', '/results/sweep', {});

/** The house's tracked links and whether its site counter is set up. impure. */
export const getLinks = () => req('GET', '/links');

/** Save (or clear, with '') the house's site counter token. impure. */
export const saveSiteToken = (token) => req('PUT', '/links/site-token', { token });

/** Publish every code the site counter has not taken yet. impure. */
export const publishLinks = () => req('POST', '/links/publish', {});
