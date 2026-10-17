// draft-storage.js — UNSENT DRAFTS, extracted whole from window-storage
// (size law). window-storage re-exports everything here so its readers
// never move.
//
// Design note, 2026-08-02: […] A half-typed message is part of where you left off.
//
// One wallet-scoped record holding every chat's draft, keyed
// `<neumaId>:<sessionId>` — one key, so the whole set can be pruned in one
// place rather than leaking a localStorage entry per sitting forever. A chat
// that has not minted a session yet drafts under DRAFT_UNBOUND, so text typed
// before the first message survives a reload too.
//
// Wallet-scoped and NOT desk-scoped: a draft belongs to the CHAT, so tearing
// its tab into another window must carry the unsent text with it.

import { walletKey } from './storage-scope.js';

const DRAFTS_KEY = 'drafts';

/** The bucket a chat that has not minted a session yet drafts into. */
export const DRAFT_UNBOUND = '__unbound__';

/** At most this many drafts are kept, most-recently-touched first. A draft is
 *  a convenience, and an unbounded one is a slow leak of the operator's own
 *  words into a store nothing ever prunes. */
const MAX_DRAFTS = 50;

/**
 * The key one chat's draft lives under. Pure.
 * @param {string|null} neumaId
 * @param {string|null} sessionId - null before the server mints one
 * @returns {string|null} null when there is no chat to draft into
 */
export const draftKeyFor = (neumaId, sessionId) =>
  (neumaId ? `${neumaId}:${sessionId || DRAFT_UNBOUND}` : null);

// impure — the whole map; anything malformed reads as empty rather than throwing.
const readDrafts = () => {
  try {
    const raw = localStorage.getItem(walletKey(DRAFTS_KEY));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * The unsent text for one chat, or '' when there is none.
 * @param {string|null} key from draftKeyFor
 * @returns {string}
 */
// impure
export const loadDraft = (key) => {
  if (!key) return '';
  const text = readDrafts()[key];
  return typeof text === 'string' ? text : '';
};

/**
 * PURE — the draft map after one edit: the whole decision, with no storage in
 * it, so every rule below is provable by calling it with real inputs.
 *
 * Empty text REMOVES the entry rather than storing '' — a sent draft leaves
 * nothing behind. (One bucket is not retired this way: a chat that mints its
 * first session moves key, leaving its pre-send bucket behind. That is what the
 * cap below is for — it is bounded and self-pruning, and the residue is the
 * operator's own already-sent words on their own machine.) A kept draft is
 * re-inserted at the END, because own-key order IS the recency the cap reads;
 * re-touching an old draft therefore rescues it from the next prune.
 *
 * @param {Object} drafts the current map
 * @param {string} key from draftKeyFor
 * @param {string} text the unsent text ('' clears)
 * @param {number} [max]
 * @returns {Object|null} the next map, or null when nothing would change
 */
export const nextDrafts = (drafts, key, text, max = MAX_DRAFTS) => {
  const current = drafts && typeof drafts === 'object' && !Array.isArray(drafts) ? drafts : {};
  const keeping = typeof text === 'string' && text.length > 0;
  if (!keeping && !(key in current)) return null; // no-op — never write for nothing
  const next = {};
  for (const k of Object.keys(current)) {
    if (k !== key) next[k] = current[k];
  }
  if (keeping) next[key] = text;
  const keys = Object.keys(next);
  if (keys.length <= max) return next;
  return Object.fromEntries(keys.slice(keys.length - max).map((k) => [k, next[k]]));
};

/**
 * Keep (or clear) one chat's unsent text.
 * @param {string|null} key from draftKeyFor
 * @param {string} text
 */
// impure — the storage shell around nextDrafts
export const saveDraft = (key, text) => {
  if (!key) return;
  try {
    const next = nextDrafts(readDrafts(), key, text);
    if (next === null) return;
    localStorage.setItem(walletKey(DRAFTS_KEY), JSON.stringify(next));
  } catch (err) {
    // Convenience, never load-bearing — but never silent either.
    console.warn('draft save failed (quota?)', err?.message);
  }
};
