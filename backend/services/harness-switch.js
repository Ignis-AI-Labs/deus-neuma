/**
 * THE HARNESS'S SERVER AND MODEL, FROM THE COMPOSER — one place, the same bar a
 * being's desk has (Design note, 2026-10-14: […]).
 *
 * The harness talks to ONE server: the one its route names. Nothing here
 * starts, stops or boots a server. A switch re-points the route; when the
 * server left behind still holds a model, the reply says so and the person
 * decides (local-server-release.js) — the platform never decides for them.
 */
import { getProvider } from './provider-registry.js';
import { setCredential } from './provider-credentials.js';
import { resolveUsableCredential } from './oauth-token-broker.js';
import { liveModels } from './provider-probe.js';
import { getJson, servableModelIds, lmStudioCatalog } from './local-server-models.js';
import { ensureHarnessLane, harnessLaneId, harnessRouteView, realModelId } from './harness-lane.js';
import { isLoopbackEndpoint } from './local-server-release.js';

const baseOf = (endpoint) => String(endpoint || '').replace(/\/+$/, '').replace(/\/v1$/, '');

/**
 * impure — every model the route's server can serve, the one the route rides
 * included even when the server no longer lists it.
 * @param {{providerId: string, endpoint: string|null, model: string|null}} server
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
const serverModelList = async ({ providerId, endpoint, model }) => {
  const entry = getProvider(providerId);
  if (!entry) return [];
  let ids;
  if (entry.kind === 'local' && endpoint) {
    ids = providerId === 'ollama'
      ? ((await getJson(`${baseOf(endpoint)}/api/tags`))?.models || []).map((m) => m.name).filter(Boolean)
      : await servableModelIds(baseOf(endpoint));
  } else {
    const cred = await resolveUsableCredential(providerId).catch(() => ({}));
    ids = (await liveModels(entry, cred.endpoint, cred.apiKey, { accountId: cred.accountId }).catch(() => []))
      .map((m) => m.id);
  }
  const real = await Promise.all(ids.map((id) => realModelId(providerId, id)));
  const all = model && !real.includes(model) ? [model, ...real] : real;
  const named = (id) => (id.startsWith('/') ? id.split('/').pop().replace(/\.gguf$/i, '') : id);
  return all.map((id) => Object.freeze({ id, name: named(id) }));
};

/**
 * impure — the composer bar's view of a harness lane: the server it talks to
 * and that server's models. `switchBy: 'harness'` — a pick re-points the route
 * (POST /api/v1/harness/switch), never ignites the house's substrate.
 * @param {string} laneId
 * @param {object} masked the lane's route without secrets (route-view.js)
 */
export const harnessModelOptions = async (laneId, masked) => {
  const view = await harnessRouteView(laneId);
  const server = Object.freeze({ providerId: view.providerId, endpoint: view.endpoint, kind: view.kind });
  return Object.freeze({
    route: masked,
    switchBy: 'harness',
    loadedId: null,
    server,
    modelName: view.modelName || null,
    // a llama.cpp naming itself /proc/self/fd/N reads by the model it holds
    models: (await serverModelList({ ...server, model: view.model }))
      .map((m) => (m.id === view.model && view.modelName ? Object.freeze({ ...m, name: view.modelName }) : m)),
  });
};

// impure — what a local server still holds in memory (names), [] when nothing or unreadable
const heldBy = async ({ providerId, endpoint }) => {
  const base = baseOf(endpoint);
  if (providerId === 'lm-studio') return ((await lmStudioCatalog(base)) || []).filter((m) => m.loaded).map((m) => m.id);
  if (providerId === 'ollama') return ((await getJson(`${base}/api/ps`))?.models || []).map((m) => m.name).filter(Boolean);
  if (providerId === 'llama-server') {
    return Promise.all(((await getJson(`${base}/v1/models`))?.data || []).map((m) => m.id).filter(Boolean)
      .map((id) => realModelId(providerId, id)));
  }
  return [];
};

const refused = (message) => Object.assign(new Error(message), { code: 'INVALID_ROUTE' });

/**
 * impure — move this wallet's harness to a server (and model). A local server
 * must be on this machine and answer; with no model named, the one it has
 * loaded is taken, else the first it can serve. The reply names the server
 * left behind when it still holds a model, so the person can free it or keep it.
 * @param {string} wallet
 * @param {{providerId: string, endpoint?: string, model?: string}} choice
 * @returns {Promise<{route: object, previous: {providerId: string, endpoint: string, holds: string[]}|null}>}
 */
export const switchHarness = async (wallet, { providerId, endpoint, model } = {}) => {
  const entry = getProvider(providerId);
  if (!entry || providerId === 'custom') throw refused(`Unknown server: ${providerId}`);
  const laneId = harnessLaneId(wallet);
  const before = await harnessRouteView(laneId).catch(() => null);
  if (entry.kind === 'local') {
    if (endpoint && !isLoopbackEndpoint(endpoint)) throw refused('A local server must be on this machine.');
    if (endpoint) await setCredential(providerId, { endpoint: baseOf(endpoint) });
  }
  const at = entry.kind === 'local' ? (endpoint || (await resolveUsableCredential(providerId)).endpoint || entry.endpoint) : null;
  let chosen = typeof model === 'string' && model.trim() ? model.trim() : null;
  if (!chosen) {
    const held = entry.kind === 'local' ? await heldBy({ providerId, endpoint: at }) : [];
    chosen = held[0] || (await serverModelList({ providerId, endpoint: at, model: null }))[0]?.id || null;
  }
  if (!chosen) throw refused(`${entry.name} answered with no model to use — load one in it, or start it.`);
  await ensureHarnessLane(wallet, { providerId, model: chosen });
  const route = await harnessRouteView(laneId);
  const moved = before?.providerId && (before.providerId !== providerId || baseOf(before.endpoint) !== baseOf(route.endpoint));
  const left = moved && getProvider(before.providerId)?.kind === 'local' && before.endpoint
    ? { providerId: before.providerId, endpoint: before.endpoint, holds: await heldBy(before) } : null;
  return Object.freeze({ route, previous: left?.holds.length ? Object.freeze(left) : null });
};
