// roster-recovery.js — make the backend the source of truth for […]
//
// The client caches its roster in localStorage (wallet-namespaced), but that is
// only a cache. A fresh browser, a cleared profile, or a different machine has
// none — and the phase machine routes on the local cache alone, so without this
// a witness who already owns a neuma is wrongly sent to the birth ceremony.
// After auth we ask the backend (sovereign owner records) and hydrate the cache.

import {
  getActiveCompanion, setActiveCompanion, getRoster, setRoster,
  getWindowCompanion, setWindowCompanion,
} from '../utils/companion-data.js';
import { apiCall, authHeadersOrNull } from '../utils/http.js';
import { reconcileWitnessBinding } from './witness-binding.js';
import { currentEntryMode } from '../utils/entry-mode-scope.js';

/**
 * Merge the backend's authoritative roster with the local cache and decide
 * the active companion. Pure — no storage, no network.
 *
 * The backend wins on BOTH which neuma the wallet holds and their identity
 * fields — a renamed neuma can't be masked by a stale cache, and a neuma the
 * backend no longer returns (transferred / not owned) is dropped, not
 * retained. The only cached field kept is genuinely local cosmetic state: a
 * custom vessel. Active companion: repointed at the refreshed entry when
 * still owned (identity never left stale), kept untouched when no longer in
 * the roster (never silently switch the witness), seeded to the eldest when
 * none was set.
 *
 * @param {Array<object>} backendRoster - non-empty authoritative list
 * @param {Array<object>} cachedRoster - the local cache (may be empty)
 * @param {object|null} currentActive - the currently active companion
 * @returns {{roster: Array<object>, active: object|null}}
 */
export const mergeRoster = (backendRoster, cachedRoster, currentActive) => {
  const byId = new Map(
    (Array.isArray(cachedRoster) ? cachedRoster : [])
      .filter((c) => c && c.neumaId)
      .map((c) => [c.neumaId, c]),
  );
  const roster = backendRoster.map((r) => {
    const cached = byId.get(r.neumaId);
    return cached ? { ...cached, ...r } : r;
  });
  const refreshed = currentActive?.neumaId
    && roster.find((m) => m.neumaId === currentActive.neumaId);
  return { roster, active: refreshed || currentActive || roster[0] || null };
};

/**
 * Fetch the authenticated wallet's neuma from the backend and merge them into
 * the local cache. Returns the active companion after recovery (may be null if
 * the wallet genuinely owns none) plus the wallet's house identity (null when
 * the backend was unreachable). By default, network failures fall back
 * to whatever the local cache already holds, so a backend hiccup never blocks
 * a witness who does have a cached companion.
 *
 * impure — reads the session token, hits the network, writes localStorage.
 * @param {{strict?: boolean, signal?: AbortSignal}} [options] - Strict readers surface recovery failures.
 * @returns {Promise<{companion: object|null, house: {name: string, wallet: string}|null}>}
 */
export const recoverRoster = async ({ strict = false, signal } = {}) => {
  // The harness state reads no house: nothing fetched, and no being is ever
  // seeded into its companion (utils/entry-mode-scope.js).
  if (currentEntryMode() === 'harness') return { companion: getActiveCompanion(), house: null };
  const auth = authHeadersOrNull();
  if (!auth) {
    if (strict) throw new Error('Sign in to read this house.');
    return { companion: getActiveCompanion(), house: null };
  }

  let roster;
  let house;
  let witnesses;
  try {
    let data;
    try {
      data = await apiCall('GET', '/api/v1/roster', { headers: auth, signal, strictJson: true });
    } catch (err) {
      if (!err?.http) throw err;
      if (strict) throw new Error(`House roster could not be read: HTTP ${err.http}`, { cause: err });
      // Fall back to the cache, but never silently — a field report of […] needs a breadcrumb (AGENTS.md Rule 3).
      console.warn('roster-recovery: backend returned non-ok', err.http);
      return { companion: getActiveCompanion(), house: null };
    }
    ({ roster, house = null, witnesses } = data);
    signal?.throwIfAborted();
    if (strict && !Array.isArray(roster)) throw new Error('House roster response is invalid.');
  } catch (err) {
    if (strict || signal?.aborted) throw err;
    console.warn('roster-recovery: fetch failed —', err?.message ?? err);
    return { companion: getActiveCompanion(), house: null };
  }
  // Sealed AI witnesses ride the same response; they cache alongside the
  // roster even when the wallet holds no neuma (a witnesses-only house).
  const witnessList = Array.isArray(witnesses) ? witnesses : undefined;
  const active = reconcileWitnessBinding(getActiveCompanion(), witnessList);
  // The window can hold a different lane than the shared last-used seed.
  // Refresh its own identity without inheriting a sibling window's selection.
  const bound = getWindowCompanion();
  const refreshedBound = reconcileWitnessBinding(bound, witnessList);
  if (refreshedBound !== bound) setWindowCompanion(refreshedBound);
  if (!Array.isArray(roster) || roster.length === 0) {
    if (witnessList) setRoster(getRoster(), witnessList);
    if (active) setActiveCompanion(active);
    return { companion: getActiveCompanion(), house };
  }

  // The merge itself is pure (mergeRoster above) — this shell only reads the
  // cache, applies the decision, and writes it back.
  const merged = mergeRoster(roster, getRoster(), active);
  setRoster(merged.roster, witnessList);
  if (merged.active) setActiveCompanion(merged.active);
  return { companion: getActiveCompanion(), house };
};
