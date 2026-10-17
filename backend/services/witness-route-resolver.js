/**
 * Witness route resolution (impure composition).
 *
 * The route a witness participant's turn travels:
 *   1. an operator OVERRIDE from the shared route store (neuma-routes-store,
 *      keyed by the witness lane id — same surface a neuma override uses)
 *   2. else the witness's SUBSTRATE DEFAULT — the provider its vendor maps to
 *      (DEFAULT_PROVIDER_MAP), with the catalog's default model
 *
 * The key always resolves through the encrypted provider-credentials store
 * (store > env > catalog precedence); the returned route carries the raw
 * apiKey and is consumed only by the stream path — never surfaced to a client.
 */
import { getProvider, providerConfigured } from './provider-registry.js';
import { loadCredentials, providerStateFrom } from './provider-credentials.js';
import { resolveUsableCredential } from './oauth-token-broker.js';
import { getRoute } from './neuma-routes-store.js';
import { assertSafeEndpoint } from './endpoint-guard.js';
import { DEFAULT_PROVIDER_MAP, resolveWitnessByLaneId } from './witness-lane.js';
import { createLogger } from './logger.js';

const log = createLogger('WitnessRoute');

const chatPathFor = (providerId) => getProvider(providerId)?.chatPath ?? '/v1/chat/completions';

/**
 * Resolve the concrete route for a witness lane's next turn.
 * @param {string} laneId — e.g. witness-kimi-code-Basunor
 * @returns {Promise<{provider: string, model: string, endpoint: (string|null), apiKey: string, chatPath: string, kind: (string|null), source: string, configured: boolean, reason: (string|null)}>}
 *   `configured: false` means the route cannot carry a turn yet (missing key or
 *   endpoint) — the caller must refuse honestly, not stream into the void.
 */
// impure
export const resolveWitnessRoute = async (laneId) => {
  const witness = await resolveWitnessByLaneId(laneId);
  if (!witness) throw new Error(`No sealed witness for lane '${laneId}'`);

  const store = await loadCredentials();
  const override = await getRoute(laneId);

  let providerId;
  let model;
  let source;
  if (override) {
    providerId = override.provider;
    model = override.model;
    source = 'override';
  } else {
    providerId = DEFAULT_PROVIDER_MAP[witness.vendorSlug] || 'custom';
    model = getProvider(providerId)?.defaultModel || null;
    source = 'substrate-default';
  }

  const entry = getProvider(providerId);
  if (!entry) throw new Error(`Unknown provider in witness route: ${providerId}`);

  const cred = await resolveUsableCredential(providerId, store);

  // Fetch-path SSRF guard (mirrors neuma-route-resolver): a custom endpoint was
  // checked when stored but is re-checked at call time against DNS rebinding.
  // For a witness there is no machine default to fall back to — the route is
  // simply refused as unconfigured.
  if (cred.endpoint) {
    const guard = await assertSafeEndpoint(cred.endpoint);
    if (!guard.ok) {
      log.warn('witness route endpoint refused', { laneId, provider: providerId, reason: guard.reason });
      return Object.freeze({
        provider: providerId, model, endpoint: cred.endpoint, apiKey: '', accountId: cred.accountId,
        chatPath: chatPathFor(providerId), kind: entry.kind, source,
        configured: false, reason: `endpoint-refused: ${guard.reason}`,
      });
    }
  }

  const configured = providerConfigured(
    entry,
    providerStateFrom(store)(entry),
  );

  return Object.freeze({
    provider: providerId,
    model,
    endpoint: cred.endpoint,
    apiKey: cred.apiKey,
    accountId: cred.accountId,
    chatPath: chatPathFor(providerId),
    kind: entry.kind,
    source,
    configured,
    reason: configured ? null : (entry.requiresKey ? 'missing-key' : 'missing-endpoint'),
  });
};
