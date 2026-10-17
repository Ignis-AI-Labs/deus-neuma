/**
 * OAuth token broker — the single choke point every request path crosses to
 * turn a stored credential into a USABLE key.
 *
 * Two credential shapes live in the encrypted store:
 *   - key entries   {apiKey?, endpoint?}            — returned as-is
 *   - oauth entries {type:'oauth', access, refresh?, expiresAt, account}
 *                                                   — refreshed through the
 *                                                   provider's grant when stale
 *
 * Refresh is serialized per provider: two turns racing an expired token share
 * one refresh, never stampede the grant endpoint.
 */
import { loadCredentials, resolveCredential, resolveEndpoint, setCredential } from './provider-credentials.js';
import { getProvider } from './provider-registry.js';
import { oauthEntryStale, refreshOAuthEntry } from './provider-oauth.js';

const refreshChains = new Map();

// impure — refresh under a per-provider chain (a failed refresh never poisons it)
const refreshSerialized = (providerId, entry) => {
  const prev = refreshChains.get(providerId) || Promise.resolve(null);
  const run = prev.catch(() => null).then(() => refreshOAuthEntry(providerId, entry));
  refreshChains.set(providerId, run.then(() => null, () => null));
  return run;
};

/**
 * Resolve a provider's usable key + endpoint for an imminent request.
 * Same return contract as provider-credentials.resolveCredential — callers
 * swap one import, nothing else. Raw keys still never leave the server.
 * @param {string} providerId
 * @param {Object} [store] pre-loaded store (avoids a second disk read)
 * @returns {Promise<{apiKey: string, endpoint: (string|null)}>}
 */
// impure
export const resolveUsableCredential = async (providerId, store) => {
  const s = store || await loadCredentials();
  const entry = s[providerId];
  if (entry?.type === 'oauth') {
    const catalog = getProvider(providerId);
    if (oauthEntryStale(entry)) {
      const renewed = await refreshSerialized(providerId, entry);
      return {
        apiKey: renewed.access,
        endpoint: resolveEndpoint(renewed, catalog),
        accountId: renewed.accountId || null,
      };
    }
    return {
      apiKey: entry.access,
      endpoint: resolveEndpoint(entry, catalog),
      accountId: entry.accountId || null,
    };
  }
  return resolveCredential(providerId, s);
};

/**
 * Store a fresh API key over whatever shape the provider's entry had (sign-out
 * of a subscription into a plain key, or vice versa handled by the oauth flow).
 * Thin pass-through so routes import one module for credential writes too.
 */
export const storeApiKey = (providerId, patch) => setCredential(providerId, patch);
