// Where to get each key — read once from the backend's one map
// (backend/services/credential-links.js) and kept for the session. Public
// links only; a failed read just means no link is shown.
import { apiCall } from '../utils/http.js';

let pending = null;

/** impure — the whole map, fetched once. */
export const loadCredentialLinks = () => {
  pending ??= apiCall('GET', '/api/v1/routing/credential-links', { errorPrefix: 'Could not read credential links' })
    .catch(() => { pending = null; return null; });
  return pending;
};

/**
 * The links for one credential. Pure.
 * @param {object|null} map the loaded map
 * @param {{provider?: string, family?: string, id?: string}} which
 * @returns {Array<{url: string, label: string, note?: string}>}
 */
export const linksFor = (map, { provider = null, family = null, id = null }) => {
  if (!map) return [];
  const found = provider ? map.providers?.[provider] : map[family]?.[id];
  if (!found) return [];
  return (Array.isArray(found) ? found : [found]).filter((l) => /^https:\/\//.test(l?.url || ''));
};
