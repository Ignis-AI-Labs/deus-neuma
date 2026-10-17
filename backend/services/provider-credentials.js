/**
 * Provider credentials — the operator's LLM API keys, encrypted at rest.
 * Keys for the registry's non-chat SERVICES (e.g. Tavily web search) live here
 * too; ids resolve through getCredentialEntry, never through chat lookups.
 *
 * These are the OPERATOR'S infrastructure secrets (one Anthropic key serves
 * every neuma on the box), NOT neuma-sovereign data — so they live in a single
 * machine-scoped store, not a sovereign workspace. The whole store is sealed as
 * one AES-256-GCM envelope via workspace-crypto (the same KDF + rotation chain
 * as every other encrypted record), written 0600 under data/settings.
 *
 * Resolution precedence for a provider's key + endpoint:
 *   the encrypted store (typed in Settings)  >  the env var (.env bootstrap)  >  the catalog default
 * so Settings is the primary control surface — a key the operator types there
 * wins and survives restarts — while ANTHROPIC_API_KEY in .env keeps an
 * untouched provider working out of the box.
 *
 * A raw key never leaves this module except to the provider call itself
 * (resolveCredential); everything the API surfaces goes through maskCredential.
 */
import { getCredentialEntry } from './provider-registry.js';
import { createWriteChain } from './write-chain.js';
import { loadCredentials, saveCredentials } from './provider-credential-store.js';
export { credentialsPath, loadCredentials, saveCredentials } from './provider-credential-store.js';

// Serialize read-modify-write so two concurrent setCredential/removeCredential
// calls can't interleave across their read+write awaits and clobber one key
// with a stale store (last-writer-wins TOCTOU). A failed mutation never poisons
// the chain.
const serialize = createWriteChain();

/**
 * Merge a credential patch onto an existing entry (pure). Two entry shapes:
 *   - key   {apiKey?, endpoint?}
 *   - oauth {type:'oauth', access, refresh?, expiresAt?, account?, endpoint?}
 * An oauth patch REPLACES the entry (sign-in); a non-empty apiKey patch
 * replaces it back (sign into a plain key); an endpoint-only patch merges
 * onto whichever shape is present. An empty-string apiKey clears the key.
 * Returns null when the merged entry holds nothing worth persisting.
 * @param {Object|undefined} existing
 * @param {Object} patch
 * @returns {Object|null}
 */
export const mergeCredential = (existing, patch) => {
  if (patch?.type === 'oauth') {
    if (typeof patch.access !== 'string' || patch.access.length === 0) return null;
    return {
      type: 'oauth',
      access: patch.access,
      ...(typeof patch.refresh === 'string' && patch.refresh ? { refresh: patch.refresh } : {}),
      ...(Number.isFinite(patch.expiresAt) ? { expiresAt: patch.expiresAt } : {}),
      ...(Number.isFinite(patch.refreshedAt) ? { refreshedAt: patch.refreshedAt } : {}),
      ...(typeof patch.account === 'string' && patch.account ? { account: patch.account } : {}),
      ...(typeof patch.accountId === 'string' && patch.accountId ? { accountId: patch.accountId } : {}),
      ...(typeof patch.endpoint === 'string' && patch.endpoint ? { endpoint: patch.endpoint } : {}),
    };
  }
  // A fresh API key supersedes an oauth entry (the operator switched auth kinds).
  if (typeof patch?.apiKey === 'string' && patch.apiKey.length > 0) {
    const next = { apiKey: patch.apiKey };
    const endpoint = patch.endpoint ?? (existing?.type === 'oauth' ? undefined : existing?.endpoint);
    if (typeof endpoint === 'string' && endpoint.length > 0) next.endpoint = endpoint;
    return next;
  }
  const next = { ...(existing || {}) };
  if (patch?.apiKey !== undefined) delete next.apiKey; // empty-string key = clear
  if (patch?.endpoint !== undefined) {
    if (typeof patch.endpoint === 'string' && patch.endpoint.length > 0) next.endpoint = patch.endpoint;
    else delete next.endpoint;
  }
  return (next.apiKey || next.access || next.endpoint) ? next : null;
};

/**
 * The effective endpoint for a provider: an operator-stored base URL overrides
 * the catalog default; a bare provider (e.g. custom) resolves to null (pure).
 * Single source of truth so the state view and the call path can never diverge.
 * @param {{endpoint?: string}|undefined} storeEntry
 * @param {import('./provider-registry.js').ProviderEntry} entry
 * @returns {string|null}
 */
export const resolveEndpoint = (storeEntry, entry) =>
  (typeof storeEntry?.endpoint === 'string' && storeEntry.endpoint.length > 0)
    ? storeEntry.endpoint
    : (entry?.endpoint ?? null);

/**
 * Compute the resolver-facing state for one provider from its store entry and
 * the value of its env-var key (pure — the env read happens in the caller).
 * Never returns the key itself, only whether one is present.
 * @param {import('./provider-registry.js').ProviderEntry} entry
 * @param {{apiKey?: string, endpoint?: string}|undefined} storeEntry
 * @param {string|undefined} envKeyValue
 * @returns {{keyPresent: boolean, endpoint: (string|null)}}
 */
export const computeCredentialState = (entry, storeEntry, envKeyValue) => {
  const storedKey = storeEntry?.type === 'oauth' ? storeEntry.access : storeEntry?.apiKey;
  const hasStored = typeof storedKey === 'string' && storedKey.length > 0;
  const hasEnv = typeof envKeyValue === 'string' && envKeyValue.length > 0;
  return Object.freeze({ keyPresent: hasStored || hasEnv, endpoint: resolveEndpoint(storeEntry, entry) });
};

/**
 * Safe view of a provider's credential for the API surface — never the raw key.
 * @param {import('./provider-registry.js').ProviderEntry} entry
 * @param {{keyPresent: boolean, endpoint: (string|null)}} state
 * @param {Object|undefined} [storeEntry] — for the credential kind + account label
 */
export const maskCredential = (entry, state, storeEntry) => Object.freeze({
  id: entry.id,
  name: entry.name,
  kind: entry.kind,
  // Custody, not transport (docs/protocols/sovereignty-boundary.md) — the desk uses
  // this to offer only sovereign doors where a NEUMA's route is chosen.
  sovereign: entry.sovereign === true,
  requiresKey: entry.requiresKey,
  allowsApiKey: entry.allowsApiKey !== false,
  endpoint: state.endpoint,
  hasKey: state.keyPresent,
  keyMasked: state.keyPresent ? '***' : '',
  credentialKind: storeEntry?.type === 'oauth' ? 'oauth' : 'key',
  account: storeEntry?.type === 'oauth' ? (storeEntry.account ?? null) : null,
  oauth: entry.oauth ?? [],
});

/**
 * Set (or clear) a provider's credential and persist. Rejects ids that are
 * neither a chat provider nor a registry service, so a typo can't seed an
 * unroutable secret.
 * @param {string} providerId
 * @param {{apiKey?: string, endpoint?: string}} patch
 */
// impure
export const setCredential = async (providerId, patch) => {
  const entry = getCredentialEntry(providerId);
  if (!entry) throw new Error(`Unknown provider: ${providerId}`);   // reject before queuing
  return serialize(async () => {
    const store = await loadCredentials();
    const merged = mergeCredential(store[providerId], patch || {});
    if (merged) store[providerId] = merged;
    else delete store[providerId];
    await saveCredentials(store);
    return store[providerId] || null;
  });
};

// impure
export const removeCredential = async (providerId) => serialize(async () => {
  const store = await loadCredentials();
  if (store[providerId] === undefined) return false;
  delete store[providerId];
  await saveCredentials(store);
  return true;
});

/**
 * Resolve the actual key + endpoint used for a provider call, applying the
 * store > env > catalog precedence. This is the ONLY path that exposes a raw
 * key — callers pass it straight into the provider request, never to a client.
 * @param {string} providerId
 * @param {Object} [store] pre-loaded store (avoids a second disk read)
 * @returns {Promise<{apiKey: string, endpoint: (string|null)}>}
 */
// impure — reads env
export const resolveCredential = async (providerId, store) => {
  const entry = getCredentialEntry(providerId);
  if (!entry) throw new Error(`Unknown provider: ${providerId}`);
  const s = store || await loadCredentials();
  const storeEntry = s[providerId];
  // OAuth entries return their stored access token as the key — FRESHNESS is
  // the broker's job (oauth-token-broker.resolveUsableCredential); this path
  // is the raw read for callers that only need what is stored.
  if (storeEntry?.type === 'oauth') {
    return {
      apiKey: storeEntry.access || '',
      endpoint: resolveEndpoint(storeEntry, entry),
      accountId: storeEntry.accountId || null,
    };
  }
  const envKey = entry.keyEnv ? process.env[entry.keyEnv] : undefined;
  const apiKey = (storeEntry?.apiKey) || (envKey && envKey.length ? envKey : '') || '';
  return { apiKey, endpoint: resolveEndpoint(storeEntry, entry) };
};

/**
 * Build the state injector the registry's buildProvidersMap expects, from a
 * pre-loaded store. Reads env per provider (impure) but delegates the decision
 * to the pure computeCredentialState.
 * @param {Object} store
 * @returns {(entry: import('./provider-registry.js').ProviderEntry) => {keyPresent: boolean, endpoint: (string|null)}}
 */
// impure — the returned function reads process.env
export const providerStateFrom = (store) => (entry) =>
  computeCredentialState(entry, store[entry.id], entry.keyEnv ? process.env[entry.keyEnv] : undefined);
