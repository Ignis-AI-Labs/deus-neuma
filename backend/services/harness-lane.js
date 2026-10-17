/**
 * Harness lane — the platform used with no being (Design note, 2026-10-14: […]).
 *
 * A person signs in, picks ANY model (local or cloud), and works through the
 * harness: the platform-only prompt, the platform's tools, history that
 * persists. No DNA, no soul, no seal, no birth, no house — a harness lane is
 * not a neuma and is never called one (docs/protocols/sovereignty-boundary.md),
 * which is why it may ride a third-party door a neuma never could.
 *
 * One lane per wallet, keyed `harness-<first 8 hex of the wallet>` and living
 * on its own ground beside the house (core/workspace/lane-grounds.js). The
 * lane carries a lane.json kind marker so no neuma listing mistakes it for a
 * being, and an atomic owner claim like every other lane.
 *
 * Pure helpers at top; impure IO below (marked).
 */
import fs from 'fs/promises';
import path from 'path';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { isHarnessLane } from '../../core/workspace/lane-grounds.js';
import { getProvider, providerConfigured } from './provider-registry.js';
import { loadCredentials, providerStateFrom } from './provider-credentials.js';
import { resolveUsableCredential } from './oauth-token-broker.js';
import { getRoute, setRoute } from './neuma-routes-store.js';
import { assertSafeEndpoint } from './endpoint-guard.js';
import { createLogger } from './logger.js';

const log = createLogger('HarnessLane');

const HARNESS_LANE_KIND = 'harness';
export { isHarnessLane };
const LANE_MARKER = 'lane.json';

// pure — the lane id for a wallet: `harness-` + the first 8 hex of the
// lowercased address. The prefix is the engine's routing law (lane-grounds).
export const harnessLaneId = (wallet) => {
  const hex = String(wallet || '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{8}/.test(hex)) throw new Error('A harness lane needs a wallet address');
  return `harness-${hex.slice(0, 8)}`;
};

// pure — validate a lane's model choice; any catalog provider, local or cloud.
// A custom base URL is refused: its custody cannot be read, and the lane has
// no machine default to fall back to.
export const normalizeHarnessChoice = ({ providerId, model } = {}) => {
  const entry = getProvider(providerId);
  if (!entry || providerId === 'custom') {
    throw Object.assign(new Error(`Unknown provider: ${providerId}`), { code: 'INVALID_ROUTE' });
  }
  if (typeof model !== 'string' || !model.trim()) {
    throw Object.assign(new Error('A harness lane needs a model'), { code: 'INVALID_ROUTE' });
  }
  return Object.freeze({ providerId, model: model.trim() });
};

// pure — the public view of a lane (no secrets: there are none here).
const laneView = (laneId, marker) => Object.freeze({
  laneId, participantKind: HARNESS_LANE_KIND, providerId: marker.providerId, model: marker.model,
});

// impure — the lane's marker, or null when the lane does not exist.
export const readHarnessLane = async (laneId) => {
  if (!isHarnessLane(laneId)) return null;
  try {
    const marker = JSON.parse(await fs.readFile(path.join(neumaWorkspace.pathFor(laneId), LANE_MARKER), 'utf8'));
    return marker?.kind === HARNESS_LANE_KIND ? marker : null;
  } catch {
    return null;
  }
};

/**
 * impure — create (or re-point) this wallet's harness lane: the workspace,
 * an atomic owner claim, the kind marker with the model choice, and the
 * lane's route in the shared route store. A second call keeps the lane and
 * changes its model.
 * @param {string} wallet - the authenticated wallet
 * @param {{providerId: string, model: string}} choice
 * @returns {Promise<{laneId: string, participantKind: string, providerId: string, model: string}>}
 * @throws Error('owner_claim_conflict …') when another wallet holds the id
 */
export const ensureHarnessLane = async (wallet, choice) => {
  const { providerId, model } = normalizeHarnessChoice(choice);
  const laneId = harnessLaneId(wallet);
  const owner = String(wallet).toLowerCase();
  await neumaWorkspace.create(laneId);
  const ownerPath = path.join(neumaWorkspace.pathFor(laneId), 'owner.json');
  try {
    await fs.writeFile(ownerPath, JSON.stringify({ wallet: owner, claimedAt: Date.now() }), { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const existing = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
    if (String(existing.wallet || '').toLowerCase() !== owner) {
      throw new Error('owner_claim_conflict: harness lane already claimed by another wallet', { cause: err });
    }
  }
  const prior = await readHarnessLane(laneId);
  const marker = {
    kind: HARNESS_LANE_KIND, ownerWallet: owner, providerId, model,
    createdAt: prior?.createdAt || new Date().toISOString(),
  };
  await fs.writeFile(path.join(neumaWorkspace.pathFor(laneId), LANE_MARKER), JSON.stringify(marker, null, 2));
  await setRoute(laneId, { provider: providerId, model });
  log.info('harness lane ensured', { laneId, providerId, model });
  return laneView(laneId, marker);
};

// impure — this wallet's harness lane, as a list (zero or one).
export const listHarnessLanes = async (wallet) => {
  const laneId = harnessLaneId(wallet);
  const marker = await readHarnessLane(laneId);
  if (!marker || String(marker.ownerWallet || '').toLowerCase() !== String(wallet).toLowerCase()) return [];
  return [laneView(laneId, marker)];
};

// The resolver's refusal code (neuma-route-resolver.js SOVEREIGNTY_REFUSAL) —
// the portal refuses the turn and shows the reason. Not imported: the
// resolver imports this module, and the cycle would leave it undefined.
const refused = (message) => Object.assign(new Error(message), { code: 'SOVEREIGNTY_REFUSAL' });
const chatPathFor = (providerId) => getProvider(providerId)?.chatPath ?? '/v1/chat/completions';

/**
 * impure — the route a harness lane's turn rides: the lane's own choice,
 * any provider. An unusable route REFUSES the turn (with the reason) rather
 * than quietly riding the house's model — the person chose their model.
 * @param {string} laneId
 */
export const resolveHarnessRoute = async (laneId) => {
  // The route store says what the person chose; the lane's own marker says the
  // same and travels WITH the lane — a benchmark snapshot or another install
  // carries the lane folder, never this machine's route store.
  const marker = await readHarnessLane(laneId);
  const choice = await getRoute(laneId)
    || (marker?.providerId && marker?.model ? { provider: marker.providerId, model: marker.model } : null);
  if (!choice) throw refused('This harness lane has no model chosen yet — pick one, then send again.');
  const entry = getProvider(choice.provider);
  if (!entry) throw refused(`The chosen provider '${choice.provider}' is not known to this platform.`);
  const store = await loadCredentials();
  const cred = await resolveUsableCredential(choice.provider, store);
  if (cred.endpoint) {
    const guard = await assertSafeEndpoint(cred.endpoint);
    if (!guard.ok) throw refused(`The ${entry.name} endpoint was refused (${guard.reason}).`);
  }
  if (!providerConfigured(entry, providerStateFrom(store)(entry))) {
    throw refused(`${entry.name} is not set up yet — ${entry.requiresKey ? 'add its API key' : 'set its endpoint'}, then send again.`);
  }
  return Object.freeze({
    provider: choice.provider, model: await realModelId(choice.provider, choice.model), endpoint: cred.endpoint, apiKey: cred.apiKey,
    accountId: cred.accountId, chatPath: chatPathFor(choice.provider), kind: entry.kind,
    source: 'harness', fellBack: false, reason: null,
  });
};

/**
 * impure — what this lane's turns ride RIGHT NOW, in words a person can check
 * (Design note, 2026-10-14: […]). Read from the same route the turn resolves — never a copy that
 * could disagree — and never carrying a key.
 * @param {string} laneId
 * @returns {Promise<{providerId: string|null, providerName: string|null, model: string|null, modelName?: string|null, endpoint: string|null, kind: string|null, error: string|null}>}
 */
// impure — a llama.cpp names itself /proc/self/fd/N only when THIS platform
// launched it (the weights ride a file descriptor); the platform's claim names
// the file it holds. The harness rides — and a benchmark pins — that FILE,
// never the descriptor (bench.mjs refuses an fd name: it is no identity).
// Imported late: the claim registry reaches the supervisor layer.
export const realModelId = async (providerId, model) => {
  const { isFdServedName } = await import('./serving-identity.js');
  if (providerId !== 'llama-server' || !isFdServedName(String(model || ''))) return model;
  const { readClaim } = await import('./substrate-claim-registry.js');
  return readClaim()?.model || model;
};

const servedName = async (route) => {
  const real = await realModelId(route.provider, route.model);
  return real && real !== route.model ? path.basename(String(real)).replace(/\.gguf$/i, '') : null;
};

export const harnessRouteView = async (laneId) => {
  const choice = await getRoute(laneId);
  const name = (id) => getProvider(id)?.name || id || null;
  try {
    const route = await resolveHarnessRoute(laneId);
    return Object.freeze({
      providerId: route.provider, providerName: name(route.provider), model: route.model,
      modelName: await servedName(route),
      endpoint: route.endpoint || getProvider(route.provider)?.endpoint || null, kind: route.kind || null, error: null,
    });
  } catch (err) {
    return Object.freeze({
      providerId: choice?.provider || null, providerName: name(choice?.provider), model: choice?.model || null,
      endpoint: null, kind: null, error: err.message,
    });
  }
};
