/**
 * Routing routes — operator-facing provider management for model selection.
 *
 *   GET    /api/v1/routing/providers                  — catalog + configured state (masked)
 *   GET    /api/v1/routing/providers/:id/models       — live model list + catalog fallback
 *   PUT    /api/v1/routing/providers/:id/key          — set API key (+ endpoint for custom)
 *   DELETE /api/v1/routing/providers/:id/key          — remove stored credential (also sign-out)
 *   POST   /api/v1/routing/providers/:id/test         — probe connection (SSRF-guarded)
 *   POST   /api/v1/routing/providers/:id/connect      — prove live + LOCK the route in
 *   GET    /api/v1/routing/connections                — the locked connections (summon pool)
 *   DELETE /api/v1/routing/connections/:id            — unlock (credential untouched)
 *   POST   /api/v1/routing/providers/:id/oauth/start  — subscription sign-in (device/browser)
 *   POST   /api/v1/routing/providers/:id/oauth/poll   — one poll round per call
 *   GET    /api/v1/routing/services                   — keyed non-chat services (masked)
 *   PUT    /api/v1/routing/services/:id/key           — set a service's API key
 *   DELETE /api/v1/routing/services/:id/key           — remove a service's stored key
 *
 * These are the OPERATOR'S provider credentials (machine-scoped), so they need
 * auth but not neuma ownership — and every write is the install owner's, at
 * this computer's own desk (install-owner.js). The per-neuma route override lives in
 * neuma-route-routes.js. A raw key never leaves the server — responses are
 * masked; only the test/model probes use a key, and only server-side.
 */
import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { requireInstallOwner } from '../services/install-owner.js';
import {
  PROVIDER_CATALOG, SERVICE_CATALOG, getProvider, getService,
} from '../services/provider-registry.js';
import {
  loadCredentials, computeCredentialState, maskCredential,
  setCredential, removeCredential, pairRequestCredential,
} from '../services/provider-credentials.js';
import { resolveUsableCredential } from '../services/oauth-token-broker.js';
import {
  oauthFlowsFor, startDeviceFlow, pollDeviceFlow,
  startBrowserFlow, pollBrowserFlow, cancelFlow, revokeProviderOAuth,
} from '../services/provider-oauth.js';
import { liveModels, modelSuggestionsFor, probeProvider } from '../services/provider-probe.js';
import {
  listConnections, lockConnection, removeConnection,
} from '../services/provider-connections.js';
import { assertSafeEndpoint } from '../services/endpoint-guard.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Routing');
const router = Router();

router.param('providerId', (req, res, next, value) => {
  if (!getProvider(value)) return res.status(404).json({ error: `Unknown provider: ${value}` });
  next();
});

// Services have their own param: a service id must never pass the provider
// param, or the chat-only routes (models, test, connect) would accept it.
router.param('serviceId', (req, res, next, value) => {
  if (!getService(value)) return res.status(404).json({ error: `Unknown service: ${value}` });
  next();
});

router.use(requireAuth);

const stateFor = async (entry, store) => {
  const s = store || await loadCredentials();
  return {
    state: computeCredentialState(entry, s[entry.id], entry.keyEnv ? process.env[entry.keyEnv] : undefined),
    storeEntry: s[entry.id],
  };
};

const maskedProvider = async (entry, store) => {
  const { state, storeEntry } = await stateFor(entry, store);
  const masked = maskCredential(entry, state, storeEntry);
  return { ...masked, dialect: entry.dialect, defaultModel: entry.defaultModel };
};

router.get('/providers', async (req, res) => {
  try {
    const store = await loadCredentials();
    const providers = [];
    for (const e of PROVIDER_CATALOG) providers.push(await maskedProvider(e, store));
    res.json({ providers });
  } catch (error) {
    log.error('provider list failed', { error: error.message });
    res.status(500).json({ error: 'Failed to list providers' });
  }
});

router.get('/providers/:providerId/models', async (req, res) => {
  try {
    const entry = getProvider(req.params.providerId);
    const { endpoint, apiKey, accountId } = await resolveUsableCredential(entry.id);
    if (endpoint) {
      const guard = await assertSafeEndpoint(endpoint);
      if (!guard.ok) return res.status(400).json({ error: `Endpoint refused: ${guard.reason}` });
    }
    // A provider may return only the account's default model. Keep that live
    // truth first, then merge the committed catalog + curated ids so the UI
    // can always expose the full known list without duplicates.
    const live = await liveModels(entry, endpoint, apiKey, { accountId });
    res.json({ models: modelSuggestionsFor(entry, live) });
  } catch (error) {
    log.error('model list failed', { error: error.message });
    res.status(500).json({ error: 'Failed to list models' });
  }
});

router.put('/providers/:providerId/key', requireInstallOwner, async (req, res) => {
  try {
    const entry = getProvider(req.params.providerId);
    const { apiKey, endpoint } = req.body || {};
    if (entry.allowsApiKey === false) {
      return res.status(400).json({ error: `${entry.name} supports OAuth sign-in only` });
    }
    if (endpoint !== undefined && typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'endpoint must be a string' });
    }
    // A custom/base-URL endpoint is operator-supplied → SSRF-guard it before it
    // is ever stored or fetched.
    if (typeof endpoint === 'string' && endpoint.length > 0) {
      const guard = await assertSafeEndpoint(endpoint);
      if (!guard.ok) return res.status(400).json({ error: `Endpoint refused: ${guard.reason}` });
    }
    await cancelFlow(entry.id); // a fresh key supersedes any pending sign-in
    await setCredential(entry.id, { apiKey, endpoint });
    res.json({ success: true, provider: await maskedProvider(entry) });
  } catch (error) {
    log.error('set key failed', { error: error.message });
    res.status(500).json({ error: 'Failed to set credential' });
  }
});

router.delete('/providers/:providerId/key', requireInstallOwner, async (req, res) => {
  try {
    const entry = getProvider(req.params.providerId);
    await cancelFlow(entry.id);
    await revokeProviderOAuth(entry.id).catch((error) => {
      log.warn('oauth revoke failed; removing local credential', { provider: entry.id, error: error.message });
    });
    const removed = await removeCredential(entry.id);
    res.json({ success: true, removed, provider: await maskedProvider(entry) });
  } catch (error) {
    log.error('delete key failed', { error: error.message });
    res.status(500).json({ error: 'Failed to remove credential' });
  }
});

router.post('/providers/:providerId/test', async (req, res) => {
  try {
    const entry = getProvider(req.params.providerId);
    // Prefer a just-typed key/endpoint from the body (so the operator can test
    // before saving), else fall back to the stored/env credential — which
    // follows only its own endpoint, never one the request names.
    const { endpoint, apiKey, accountId } = pairRequestCredential(await resolveUsableCredential(entry.id), req.body);
    if (!endpoint) return res.status(400).json({ success: false, error: 'No endpoint to test' });
    const guard = await assertSafeEndpoint(endpoint);
    if (!guard.ok) return res.status(400).json({ success: false, error: `Endpoint refused: ${guard.reason}` });
    const models = await liveModels(entry, endpoint, apiKey, { accountId });
    res.json({ success: models.length > 0, models });
  } catch (error) {
    log.error('provider test failed', { error: error.message });
    res.status(500).json({ success: false, error: 'Provider test failed' });
  }
});

// --- Locked connections ---
//
// CONNECT proves a provider end-to-end (credential + live model list) and
// locks the route in: the operator never reconfigures it, and it joins the
// pool a new AI witness may be summoned onto. A lock holds no secrets.

router.post('/providers/:providerId/connect', requireInstallOwner, async (req, res) => {
  try {
    const entry = getProvider(req.params.providerId);
    const store = await loadCredentials();
    const cred = await resolveUsableCredential(entry.id, store);
    const { endpoint, apiKey, accountId, storedEndpoint } = pairRequestCredential(cred, req.body);
    if (!endpoint) return res.status(400).json({ success: false, error: 'No endpoint to connect' });
    // A lock is summoned later with the STORED key, so locking another
    // endpoint would carry that key there. Save the endpoint with its key first.
    if (!storedEndpoint && cred.apiKey) {
      return res.status(400).json({ success: false, error: 'The stored key belongs to another endpoint — save this endpoint with its own key first' });
    }
    if (entry.requiresKey && !apiKey) {
      return res.status(400).json({ success: false, error: 'No credential — add a key or sign in first' });
    }
    const probe = await probeProvider(entry.id, { endpoint, apiKey, accountId });
    if (!probe.ok) return res.status(400).json({ success: false, error: probe.error });
    if (!probe.live) {
      return res.json({ success: false, live: false, error: 'The provider did not answer with a live model list — nothing was locked' });
    }
    const model = (typeof req.body?.model === 'string' && req.body.model) || probe.models[0]?.id || entry.defaultModel;
    if (!model) return res.json({ success: false, live: true, error: 'The provider listed no models to lock onto' });
    const storeEntry = store[entry.id];
    const connection = await lockConnection({
      providerId: entry.id,
      model,
      endpoint,
      account: storeEntry?.type === 'oauth' ? (storeEntry.account ?? null) : null,
      credentialKind: storeEntry?.type === 'oauth' ? 'oauth' : 'key',
      lastLiveAt: new Date().toISOString(),
    });
    res.json({ success: true, connection });
  } catch (error) {
    log.error('provider connect failed', { error: error.message });
    res.status(500).json({ success: false, error: 'Connect failed' });
  }
});

router.get('/connections', async (req, res) => {
  try {
    res.json({ connections: await listConnections() });
  } catch (error) {
    log.error('connection list failed', { error: error.message });
    res.status(500).json({ error: 'Failed to list connections' });
  }
});

router.delete('/connections/:providerId', requireInstallOwner, async (req, res) => {
  try {
    const removed = await removeConnection(req.params.providerId);
    res.json({ success: true, removed });
  } catch (error) {
    log.error('connection remove failed', { error: error.message });
    res.status(500).json({ error: 'Failed to remove connection' });
  }
});

// --- Subscription sign-in (OAuth) ---
// The desk drives the cadence: start returns what to show (URL ± user code),
// poll is one token-endpoint round per call. OAuth endpoints are hardcoded
// provider hosts — never user input — so no SSRF surface is added.

router.post('/providers/:providerId/oauth/start', requireInstallOwner, async (req, res) => {
  try {
    const entry = getProvider(req.params.providerId);
    const mode = req.body?.mode || oauthFlowsFor(entry.id)[0];
    if (!oauthFlowsFor(entry.id).includes(mode)) {
      return res.status(400).json({ error: `Provider ${entry.id} has no ${mode || 'oauth'} sign-in` });
    }
    const flow = mode === 'browser'
      ? await startBrowserFlow(entry.id)
      : await startDeviceFlow(entry.id);
    res.json({ success: true, mode, ...flow });
  } catch (error) {
    log.error('oauth start failed', { provider: req.params.providerId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/providers/:providerId/oauth/poll', requireInstallOwner, async (req, res) => {
  try {
    const entry = getProvider(req.params.providerId);
    const mode = req.body?.mode || 'device';
    const result = mode === 'browser'
      ? await pollBrowserFlow(entry.id)
      : await pollDeviceFlow(entry.id);
    res.json(result);
  } catch (error) {
    log.error('oauth poll failed', { provider: req.params.providerId, error: error.message });
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// --- Keyed services (non-chat) ---
// A service key shares the encrypted store, and nothing else: it is never a
// model, a route, or a connection, so these routes only set, list and clear.

const maskedService = async (entry, store) => {
  const { state, storeEntry } = await stateFor(entry, store);
  return { ...maskCredential(entry, state, storeEntry), service: entry.service };
};

router.get('/services', async (req, res) => {
  try {
    const store = await loadCredentials();
    const services = [];
    for (const e of SERVICE_CATALOG) services.push(await maskedService(e, store));
    res.json({ services });
  } catch (error) {
    log.error('service list failed', { error: error.message });
    res.status(500).json({ error: 'Failed to list services' });
  }
});

router.put('/services/:serviceId/key', requireInstallOwner, async (req, res) => {
  try {
    const entry = getService(req.params.serviceId);
    const apiKey = req.body?.apiKey;
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return res.status(400).json({ error: 'apiKey must be a non-empty string' });
    }
    await setCredential(entry.id, { apiKey: apiKey.trim() });
    res.json({ success: true, service: await maskedService(entry) });
  } catch (error) {
    log.error('set service key failed', { error: error.message });
    res.status(500).json({ error: 'Failed to set credential' });
  }
});

router.delete('/services/:serviceId/key', requireInstallOwner, async (req, res) => {
  try {
    const entry = getService(req.params.serviceId);
    const removed = await removeCredential(entry.id);
    res.json({ success: true, removed, service: await maskedService(entry) });
  } catch (error) {
    log.error('delete service key failed', { error: error.message });
    res.status(500).json({ error: 'Failed to remove credential' });
  }
});

export default router;
