/**
 * Per-being effort choice — which reasoning rung a being's turns are paid for.
 *
 * The sibling of neuma-routes-store: an OPERATOR preference keyed by id (a
 * neumaId, or a witness lane id — both classes ride this one surface), holding
 * no secrets, so it lives in the same plaintext machine-scoped settings dir.
 * Absence means "the default rung" — clearing IS returning to the default.
 *
 * The stored value is deliberately NOT validated against a model's ladder here:
 * a being moves between models, and a rung one model lacks must not be lost
 * from the record when the operator moves back. model-effort.normalizeChoice
 * narrows the stored choice to what the CURRENT route can honor, at read time.
 */
import fs from 'fs/promises';
import { join, dirname } from 'path';
import { EFFORT_LADDER, DEFAULT_EFFORT } from './model-effort.js';
import { createWriteChain } from './write-chain.js';
import { getSettingsDir } from './data-root.js';

const SETTINGS_DIR = getSettingsDir();

const ID_RE = /^[a-zA-Z0-9_-]+$/;

// Overridable per call so tests never touch the operator's live choices.
export const effortPath = () =>
  process.env.NEUMA_EFFORT_PATH || join(SETTINGS_DIR, 'neuma-effort.json');

// Serialize read-modify-write: two beings set concurrently would otherwise
// interleave their read/write pairs and the last writer would silently drop the
// first choice. The shared primitive (write-chain.js) exists because the repo map
// found this body copied verbatim across a dozen stores.
const serialize = createWriteChain();

/** Validation failures carry a stable code so routes classify without matching text. */
const invalidEffort = (message) => {
  const err = new Error(message);
  err.code = 'INVALID_EFFORT';
  return err;
};

/** Validate an id at the boundary (the workspace layer's format guard). */
export const assertEffortId = (id) => {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw invalidEffort('Invalid id');
  return id;
};

/**
 * Validate + normalize a choice into a frozen record (pure): the RUNG (named on
 * the house ladder) and whether the model reasons at all. Two values, because
 * the desk has two controls — "how hard" and "whether at all" are separate
 * questions the vendors ask separately (model-effort.js, 2026-07-30). THINKING
 * defaults to ON: a being reasons unless the operator says otherwise.
 * @param {{effort?: string, thinking?: boolean}} choice
 * @returns {{effort: string, thinking: boolean}}
 */
export const normalizeStoredChoice = (choice) => {
  // A rung NAMED must be a real one; a rung left unsaid means the default —
  // which is this store's whole doctrine (absence is the default). A lane can
  // have a thinking switch and no ladder at all (Kimi), and flipping that switch
  // must not require the client to invent a rung the route does not offer.
  const effort = choice?.effort === undefined || choice?.effort === null || choice?.effort === ''
    ? DEFAULT_EFFORT
    : String(choice.effort).trim().toLowerCase();
  if (!EFFORT_LADDER.includes(effort)) {
    throw invalidEffort(`Unknown effort rung: ${choice?.effort} (expected ${EFFORT_LADDER.join(' / ')})`);
  }
  if (choice?.thinking !== undefined && typeof choice.thinking !== 'boolean') {
    throw invalidEffort('thinking must be true or false');
  }
  return Object.freeze({ effort, thinking: choice?.thinking !== false });
};

/**
 * One stored entry read as {rung, thinking} — folding the two older record
 * shapes so no being loses what it was left on. Pure.
 *   • CHIP era (before 2026-07-30): `ultra`/`pro` booleans beside a rung
 *   • the one-list hour (2026-07-30): `effort: 'none'` meant thinking off
 * @param {{effort?: string, ultra?: boolean, pro?: boolean, thinking?: boolean}|null} entry
 * @returns {{effort: string, thinking: boolean}|null} null when it names no rung
 */
const entryChoice = (entry) => {
  if (!entry) return null;
  const thinking = entry.thinking !== false && entry.effort !== 'none';
  if (entry.pro === true) return Object.freeze({ effort: 'pro', thinking });
  if (entry.ultra === true) return Object.freeze({ effort: 'ultra', thinking });
  // 'none' named no rung of its own — the being keeps the default one, switched off.
  if (entry.effort === 'none') return Object.freeze({ effort: DEFAULT_EFFORT, thinking: false });
  return EFFORT_LADDER.includes(entry.effort)
    ? Object.freeze({ effort: entry.effort, thinking })
    : null;
};

// impure — reads the choices map; absent file means "nothing chosen yet".
export const loadEfforts = async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(effortPath(), 'utf8'));
    // An array is typeof 'object' but would drop string keys on the next save —
    // a hand-edited/corrupt file reads as "no choices".
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
};

// impure — persists the map through tmp+rename so a concurrent reader sees the
// old or the new file whole, never a torn mid-write one.
const saveEfforts = async (map) => {
  const target = effortPath();
  await fs.mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(map, null, 2));
  await fs.rename(tmp, target);
};

/**
 * One being's stored choice, or null when it runs on the defaults.
 * @param {string} id neumaId or witness lane id
 * @returns {Promise<{effort: string, thinking: boolean}|null>}
 */
// impure
export const getEffort = async (id) => {
  assertEffortId(id);
  // A corrupt entry reads as "no choice" rather than handing a downstream
  // resolver a rung no ladder has.
  return entryChoice((await loadEfforts())[id]);
};

/**
 * Set a being's effort choice (validated) and persist.
 * @param {string} id neumaId or witness lane id
 * @param {{effort: string, thinking?: boolean}} choice
 * @returns {Promise<{effort: string, thinking: boolean}>}
 */
// impure
export const setEffort = async (id, choice) => {
  assertEffortId(id);
  const normalized = normalizeStoredChoice(choice);   // validate before queuing
  return serialize(async () => {
    const map = await loadEfforts();
    map[id] = { ...normalized };
    await saveEfforts(map);
    return normalized;
  });
};

/**
 * Clear a being's choice — return to the default rung.
 * @param {string} id
 * @returns {Promise<boolean>} whether a choice was actually removed
 */
// impure
export const clearEffort = async (id) => {
  assertEffortId(id);
  return serialize(async () => {
    const map = await loadEfforts();
    if (map[id] === undefined) return false;
    delete map[id];
    await saveEfforts(map);
    return true;
  });
};
