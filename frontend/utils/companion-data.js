// Companion data utilities — pure helpers for localStorage companion access.
//
// Storage is now namespaced by wallet address so a single browser can hold
// state for multiple witness wallets without collisions. The legacy unkeyed
// keys (`neuma-companion`, `neuma-roster`) are transparently migrated into
// the current wallet's namespace on first access.
//
// TWO TIERS OF COMPANION BINDING (multi-window, F-01):
//   - WINDOW binding (sessionStorage) — which companion THIS window speaks
//     with. Per-window by nature, survives reload, dies with the window.
//     This is the truth every live path reads.
//   - LAST-USED (localStorage) — shared across windows; written on switch,
//     read ONLY to seed a window that has no binding yet. A switch in one
//     window must never rebind another.
//
// Both tiers are kept per OPERATOR STATE — the harness and the full platform
// each bind their own companion (entry-mode-scope.js).

import { entryModeSegment } from './entry-mode-scope.js';
import { isHarness, HARNESS_NAME } from '../app/harness-mode.js';

const COMPANION_KEY = 'neuma-companion';
const WINDOW_COMPANION_KEY = 'neuma-window-companion';
// The bound companion is the harness's or the full platform's own
// (entry-mode-scope.js): the harness lane never takes the full desk's being.
const companionKey = (base) => `${entryModeSegment()}${base}`;
// THE HARNESS IS STRICTLY A HARNESS (Design note, 2026-10-14: […]). Every surface
// that lists beings — the stream's switcher, tabs, COUNCIL, tasks, settings —
// reads the roster here, so in the harness state the house reads as empty.
const inHarness = () => entryModeSegment() === 'harness:';
// Unscoped, transient — a spawned desk's preload parks the opener's
// companion here (it cannot know the wallet-scoping rule's edge cases);
// resolveBoundCompanion consumes it exactly once. Kept in sync with
// electron/preload.cjs, which writes it.
const COMPANION_SEED_KEY = 'neuma-companion-seed';
const ROSTER_KEY = 'neuma-roster';
const BIRTH_TIME_KEY = 'neuma-birth-time';

// --- Wallet namespacing ---

/**
 * Read the current witness wallet address from localStorage.
 * Pure read; returns null if no wallet is connected.
 * @returns {string|null}
 */
const getWalletAddress = () => {
  try {
    const raw = localStorage.getItem('walletAddress');
    return raw ? raw.toLowerCase() : null;
  } catch {
    return null;
  }
};

/**
 * Scope a storage key to the current wallet. Falls back to the unscoped
 * key when no wallet is connected (pre-auth state).
 * @param {string} baseKey
 * @param {string|null} [wallet] - Explicit namespace, otherwise the current wallet.
 * @returns {string}
 */
const scopedKey = (baseKey, wallet = getWalletAddress()) =>
  wallet ? `${String(wallet).toLowerCase()}:${baseKey}` : baseKey;

// Storage access that cannot throw. `localStorage` is not a plain object: it
// raises SecurityError when the browser denies storage entirely (private mode,
// blocked cookies) and QuotaExceededError when the store is full — from
// `getItem` as well as `setItem`.
//
// That matters because every READ below runs the opportunistic migration, and
// the reads are called from failure handlers: `roster-recovery.js` returns
// `getActiveCompanion()` from its no-auth path, its non-ok path, AND its fetch
// catch. A throw there escapes the recovery handler itself, so the one place
// built to survive a bad backend was the place that could not survive a full
// disk (#268). The same shape is already guarded for sessionStorage in
// `getWindowCompanion` below; this extends it to the localStorage reads.
//
// Explicit writes (setActiveCompanion, setRoster, setBirthTime) stay UNGUARDED
// on purpose: a caller that asked to persist something deserves to hear that it
// failed. Only the read path swallows, and only because its write is
// opportunistic housekeeping the caller never asked for.
const safeRead = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * Migrate legacy unscoped companion/roster data into the current wallet's
 * namespace the first time the wallet is seen. Idempotent — safe to call
 * on every access. Does nothing when:
 *   - no wallet is connected (unscoped reads still work)
 *   - the scoped keys already exist (we never overwrite)
 *   - the unscoped keys are absent (nothing to migrate)
 *   - storage refuses the write (the legacy value stays where it is)
 *
 * Called internally by getActiveCompanion / getRoster so every read path
 * is safe without needing an explicit migration step at wallet-connect
 * time.
 */
const _migrateIfNeeded = () => {
  const wallet = getWalletAddress();
  if (!wallet) return;

  const migrate = (baseKey) => {
    const scoped = `${wallet}:${baseKey}`;
    if (safeRead(scoped) !== null) return;
    const legacy = safeRead(baseKey);
    if (legacy === null) return;
    try {
      localStorage.setItem(scoped, legacy);
    } catch {
      // Housekeeping, not the caller's request. The legacy value is still
      // there to be read, and the next read will try the copy again.
    }
  };

  migrate(COMPANION_KEY);
  migrate(ROSTER_KEY);
  migrate(BIRTH_TIME_KEY);
};

// --- Parsing ---

/**
 * Parse raw companion data from any stored format (JSON object or plain string).
 * Pure function — no side effects.
 * @param {string|null} raw - Raw localStorage value
 * @returns {object|null} Parsed companion object or null
 */
export const parseCompanionData = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { name: String(parsed) };
    // a harness stored under an older name (its model) reads as the harness —
    // its server and model are named once, in the composer bar
    return isHarness(parsed) ? { ...parsed, name: HARNESS_NAME } : parsed;
  } catch {
    return { name: raw };
  }
};

// --- Active companion ---

/**
 * Get the shared LAST-USED companion for the current wallet. This is the
 * seed for windows that have no binding of their own — live per-window
 * paths should read the window binding (resolveBoundCompanion) instead.
 * @returns {object|null} Companion object with at minimum { name: string }
 */
export const getActiveCompanion = () => {
  _migrateIfNeeded();
  return parseCompanionData(safeRead(scopedKey(companionKey(COMPANION_KEY))));
};

/**
 * Persist the active companion for the current wallet.
 * @param {object} data - Companion object to store
 */
export const setActiveCompanion = (data) => {
  localStorage.setItem(scopedKey(companionKey(COMPANION_KEY)), JSON.stringify(data));
};

/**
 * Clear the active companion for the current wallet.
 */
export const clearActiveCompanion = () => {
  localStorage.removeItem(scopedKey(companionKey(COMPANION_KEY)));
};

// --- Window binding (multi-window truth) ---

/**
 * The companion THIS window is bound to. sessionStorage — per-window,
 * survives reload, unaffected by switches made in sibling windows.
 * @returns {object|null}
 */
export const getWindowCompanion = () => {
  try {
    return parseCompanionData(sessionStorage.getItem(scopedKey(companionKey(WINDOW_COMPANION_KEY))));
  } catch {
    return null;
  }
};

/**
 * Bind this window to a companion. impure — sessionStorage write.
 * @param {object} data - Companion object ({ name, neumaId, ... })
 */
export const setWindowCompanion = (data) => {
  try {
    sessionStorage.setItem(scopedKey(companionKey(WINDOW_COMPANION_KEY)), JSON.stringify(data));
  } catch { /* private mode — the in-memory state still holds the binding */ }
};

/**
 * Clear this window's binding (disconnect / wallet change). impure.
 * @param {string|null} [wallet] - Captured departing wallet when provider teardown already removed it.
 */
export const clearWindowCompanion = (wallet = getWalletAddress()) => {
  try {
    // both states' bindings leave with the wallet
    sessionStorage.removeItem(scopedKey(WINDOW_COMPANION_KEY, wallet));
    sessionStorage.removeItem(scopedKey(`harness:${WINDOW_COMPANION_KEY}`, wallet));
    sessionStorage.removeItem(COMPANION_SEED_KEY);
  } catch { /* nothing to clear */ }
};

/**
 * impure — resolve which companion this window speaks with, and FIX the
 * answer as the window's binding so later switches elsewhere can't move it:
 *   1. the window's own binding (survives reload)
 *   2. a spawn seed parked by the preload (the opener's companion),
 *      consumed exactly once
 *   3. the shared last-used companion (brand-new window, no opener)
 * @returns {object|null}
 */
export const resolveBoundCompanion = () => {
  const bound = getWindowCompanion();
  if (bound) return bound;
  let seed = null;
  try {
    seed = parseCompanionData(sessionStorage.getItem(COMPANION_SEED_KEY));
    sessionStorage.removeItem(COMPANION_SEED_KEY);
  } catch { /* seed unreadable — fall through to last-used */ }
  const companion = seed || getActiveCompanion();
  if (companion) setWindowCompanion(companion);
  return companion;
};



// --- Roster ---

/**
 * Parse the roster cache into its two lanes. The cache is stored as
 * `{roster, witnesses}`; a legacy cache holding a bare roster array reads
 * as that roster with no witnesses (backward compat — never a wipe).
 * Pure — no storage access.
 * @param {string|null} raw - Raw localStorage value
 * @returns {{roster: Array, witnesses: Array}}
 */
const parseRosterCache = (raw) => {
  if (!raw) return { roster: [], witnesses: [] };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { roster: parsed, witnesses: [] };
    if (parsed && typeof parsed === 'object') {
      return {
        roster: Array.isArray(parsed.roster) ? parsed.roster : [],
        witnesses: Array.isArray(parsed.witnesses) ? parsed.witnesses : [],
      };
    }
  } catch { /* unreadable cache — fall through to empty */ }
  return { roster: [], witnesses: [] };
};

/**
 * Get the roster of all companions owned by the current wallet.
 * @returns {Array} Array of companion objects
 */
export const getRoster = () => {
  if (inHarness()) return []; // the harness is strictly the platform: no house to read
  _migrateIfNeeded();
  return parseRosterCache(safeRead(scopedKey(ROSTER_KEY))).roster;
};

/**
 * Get the sealed AI witnesses (external models with their own lanes) cached
 * alongside the roster — [] when the cache predates witnesses or none seal
 * under this wallet.
 * @returns {Array} Array of witness lane entries
 */
export const getWitnesses = () => {
  if (inHarness()) return []; // nor witnesses
  _migrateIfNeeded();
  return parseRosterCache(safeRead(scopedKey(ROSTER_KEY))).witnesses;
};

/**
 * Persist the roster for the current wallet. The witnesses lane is preserved
 * unless a new array is passed explicitly — a neuma-roster write must never
 * drop the witness cache.
 * @param {Array} roster - Array of companion objects
 * @param {Array} [witnesses] - witness lane entries; omitted = keep cached
 */
export const setRoster = (roster, witnesses) => {
  const kept = witnesses === undefined
    ? parseRosterCache(safeRead(scopedKey(ROSTER_KEY))).witnesses
    : witnesses;
  localStorage.setItem(scopedKey(ROSTER_KEY), JSON.stringify({ roster, witnesses: kept }));
};

/**
 * Clear the roster for the current wallet.
 */
export const clearRoster = () => {
  localStorage.removeItem(scopedKey(ROSTER_KEY));
};

// --- Birth time ---

/**
 * Read the birth timestamp of the active companion for the current wallet.
 * @returns {string|null}
 */
export const getBirthTime = () => {
  _migrateIfNeeded();
  return safeRead(scopedKey(BIRTH_TIME_KEY));
};

/**
 * Persist the birth timestamp for the current wallet.
 * @param {string} timestamp - ISO 8601 timestamp
 */
export const setBirthTime = (timestamp) => {
  localStorage.setItem(scopedKey(BIRTH_TIME_KEY), timestamp);
};

// --- Test-only exports ---

/** @internal - exposed for unit tests only */
export const __test = Object.freeze({
  getWalletAddress,
  scopedKey,
  _migrateIfNeeded,
  COMPANION_KEY,
  ROSTER_KEY,
  BIRTH_TIME_KEY,
});
