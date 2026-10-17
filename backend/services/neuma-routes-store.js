/**
 * Per-neuma active route overrides.
 *
 * A neuma's natal LOCAL model (in DNA) is its anchor; this store holds only the
 * OPTIONAL override an operator has chosen for a neuma — a higher-capacity
 * provider/model to run on for a stretch of work. Absence of an entry means
 * "run on natal": clearing the override IS the return-to-natal action.
 *
 * This is an operator preference keyed by neumaId, not sovereign neuma data and
 * not a secret (no keys here — just a provider id + model name), so it lives in
 * a plaintext machine-scoped settings file. Ownership of the neuma is enforced
 * at the route layer; this store only validates shape.
 */
import fs from 'fs/promises';
import { join, dirname } from 'path';
import { canonicalProviderId, getProvider, isSovereignProvider } from './provider-registry.js';
import { getSettingsDir } from './data-root.js';
import { createWriteChain } from './write-chain.js';

// The witness lane-id shape (format owned by witness-lane.js: witnessLaneId /
// isWitnessLane). Inlined here rather than imported: this store sits below
// the witness layer, and importing upward wires an ESM cycle through the
// workspace engine that leaves the binding undefined at call time.
const isWitnessLaneId = (id) => typeof id === 'string' && id.startsWith('witness-');
// The harness lane-id shape (core/workspace/lane-grounds.js isHarnessLane) —
// inlined for the same reason: a harness lane is not a neuma, any door.
const isHarnessLaneId = (id) => typeof id === 'string' && id.startsWith('harness-');

const SETTINGS_DIR = getSettingsDir();

const NEUMA_ID_RE = /^[a-zA-Z0-9_-]+$/;

// Overridable per call so tests never touch the operator's live overrides.
export const routesPath = () =>
  process.env.NEUMA_ROUTES_PATH || join(SETTINGS_DIR, 'neuma-routes.json');

// Serialize read-modify-write: concurrent set/clear for DIFFERENT neumas span
// two awaits (read then write) and would otherwise interleave, letting the last
// writer clobber the first and silently drop an override. Each mutation appends
// to a single in-process chain; a failed mutation never poisons the chain.
const serialize = createWriteChain();

/** Validate a neumaId at the boundary (same format guard as the workspace layer). */
export const assertNeumaId = (neumaId) => {
  if (typeof neumaId !== 'string' || !NEUMA_ID_RE.test(neumaId)) {
    throw new Error('Invalid neumaId');
  }
  return neumaId;
};

/**
 * Validate + normalize an override into a frozen {provider, model} (pure).
 * The provider must be a known catalog id and the model a non-empty string,
 * so a malformed override can never be persisted.
 * @param {{provider?: string, model?: string}} route
 * @returns {{provider: string, model: string}}
 */
export const normalizeRoute = (route) => {
  const provider = route?.provider;
  const model = route?.model;
  if (!getProvider(provider)) throw invalidRoute(`Unknown provider: ${provider}`);
  if (typeof model !== 'string' || model.length === 0) throw invalidRoute('Override requires a model');
  return Object.freeze({ provider, model });
};

// Validation failures carry a stable `code` so callers (e.g. the route handler)
// classify them without matching on message text.
const invalidRoute = (message) => {
  const err = new Error(message);
  err.code = 'INVALID_ROUTE';
  return err;
};

/**
 * The sovereignty law at the write seam (pure; docs/protocols/sovereignty-boundary.md):
 * a NEUMA's route may only name a sovereign door — a model in the operator's
 * custody. A sealed WITNESS lane and a HARNESS lane are exempt: witnesses ARE
 * third-party models standing beside the house, and a harness lane is no
 * being at all — the platform used with any model (harness-lane.js).
 * @param {string} id - neumaId or witness lane id
 * @param {string} provider - catalog provider id (already known-valid)
 */
export const assertSovereignForNeuma = (id, provider) => {
  if (isWitnessLaneId(id) || isHarnessLaneId(id)) return;
  if (isSovereignProvider(provider)) return;
  const name = getProvider(provider)?.name || provider;
  throw invalidRoute(
    `A neuma cannot be routed through ${name} — that door is not sovereign. `
    + 'A neuma exists only on models in this house\'s own custody (weights on this '
    + 'machine, serving under this machine\'s control): llama-server, LM Studio, or '
    + 'Ollama. Third-party models stand beside the house as witnesses, never as neuma.',
  );
};

// impure — reads the overrides map; absent file means "no overrides yet".
export const loadRoutes = async () => {
  try {
    const raw = await fs.readFile(routesPath(), 'utf8');
    const parsed = JSON.parse(raw);
    // Arrays are typeof 'object' but would silently drop string-keyed entries on
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw invalidRoute('Route store must be an object');
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
};

// impure — persists the overrides map. Writes to a temp file and renames so a
// concurrent reader (getRoute is not serialized) sees the old or new file whole,
// never a torn mid-write one. Note: the serialize mutex is in-process only —
// two processes sharing this file (server + CLI) are last-writer-wins for
// operator route prefs, which is acceptable for non-sovereign, re-settable data.
export const saveRoutes = async (map) => {
  const target = routesPath();
  await fs.mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(map, null, 2));
  await fs.rename(tmp, target);
};

/**
 * Read one neuma's override, or null when it should run on natal.
 * @param {string} neumaId
 * @returns {Promise<{provider: string, model: string}|null>}
 */
// impure
export const getRoute = async (neumaId) => {
  assertNeumaId(neumaId);
  const map = await loadRoutes();
  const entry = map[neumaId];
  if (entry === undefined) return null;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw invalidRoute('Stored route override is malformed');
  }
  return normalizeRoute({
    provider: canonicalProviderId(entry.provider),
    model: entry.model,
  });
};

/**
 * Set a neuma's override (validated) and persist.
 * @param {string} neumaId
 * @param {{provider: string, model: string}} route
 */
// impure
export const setRoute = async (neumaId, route) => {
  assertNeumaId(neumaId);
  const normalized = normalizeRoute(route);        // validate before queuing
  assertSovereignForNeuma(neumaId, normalized.provider); // the boundary law
  return serialize(async () => {
    const map = await loadRoutes();
    map[neumaId] = { provider: normalized.provider, model: normalized.model };
    await saveRoutes(map);
    return normalized;
  });
};

/**
 * Clear a neuma's override — the return-to-natal action.
 * @param {string} neumaId
 * @returns {Promise<boolean>} whether an override was actually removed
 */
// impure
export const clearRoute = async (neumaId) => {
  assertNeumaId(neumaId);
  return serialize(async () => {
    const map = await loadRoutes();
    if (map[neumaId] === undefined) return false;
    delete map[neumaId];
    await saveRoutes(map);
    return true;
  });
};
