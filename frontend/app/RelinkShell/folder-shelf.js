// folder-shelf.js — the pure core of the Explorer's FAVORITES / RECENTS shelf.
//
// The shelf holds the witness's folder MACROS (VS Code's Outline/Timeline
// slot, repurposed): RECENTS records every folder the open-folder gesture
// lands — most-recent first, capped — and FAVORITES holds the ones pinned by
// hand. Entries are absolute FOLDER paths only; files never land here — the
// one recording site is useOpenFolder, which only opens folders. Kept free of
// React and browser globals so it is node-testable on its own (D1). Persisted
// state is UNTRUSTED on the way back in — normalizeShelf is the boundary
// validator, same discipline as normalizeFocus: explicit field-picking, never
// a spread, hostile extras dropped on the floor.

import { baseName, dirOf, isAbsolutePath } from '../../utils/path.js';

// Recents self-populate — the cap keeps the rail a shelf, not a history.
// Favorites are hand-placed; their cap only bounds hostile storage.
export const RECENTS_CAP = 10;
export const FAVORITES_CAP = 32;

// Same rejection normalizeFocus applies to a focus path: control characters
// have no place in a POSIX folder path, and a relative path is meaningless as
// a macro (a hostile one is a traversal attempt). The backend re-validates
// every open against the real disk regardless (D3) — this closes the label
// surface at the boundary.
const hasControlChars = (s) => {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
};

// ABSOLUTE on any platform the desk runs on. This read `startsWith('/')` until
// 2026-08-13, so `cleanList` below silently dropped EVERY Windows folder and the
// panel read "NOTHING PINNED YET" under an Explorer showing the very folder that
// had just been pinned (#227).
const validFolderPath = (p) => isAbsolutePath(p) && !hasControlChars(p);

// A clean, deduped, capped list of valid paths — first occurrence wins, so
// order (MRU for recents, pin order for favorites) survives the wash.
const cleanList = (raw, cap) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const p of raw) {
    if (validFolderPath(p) && !out.includes(p)) out.push(p);
    if (out.length >= cap) break;
  }
  return out;
};

/**
 * Boundary validator for anything claiming to be a shelf (parsed JSON from
 * localStorage). Anything hostile or malformed degrades to an empty shelf or
 * drops the bad entries — never a throw, never a malformed row.
 * @param {unknown} raw
 * @returns {{favorites: string[], recents: string[]}}
 */
export const normalizeShelf = (raw) => {
  const obj = (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) ? raw : {};
  return Object.freeze({
    favorites: Object.freeze(cleanList(Object.hasOwn(obj, 'favorites') ? obj.favorites : null, FAVORITES_CAP)),
    recents: Object.freeze(cleanList(Object.hasOwn(obj, 'recents') ? obj.recents : null, RECENTS_CAP)),
  });
};

/**
 * A folder landed as a working focus — record it at the head of RECENTS
 * (most-recent-first; a re-open bumps, never duplicates). Favorites are
 * untouched: pinning is always a hand gesture. An invalid path records
 * nothing. Pure — returns a fresh normalized shelf.
 * @param {{favorites: string[], recents: string[]}} shelf
 * @param {string} path
 */
export const recordRecent = (shelf, path) => normalizeShelf({
  favorites: shelf.favorites,
  recents: validFolderPath(path) ? [path, ...shelf.recents.filter((p) => p !== path)] : shelf.recents,
});

/**
 * Pin / unpin a folder — pinned lands at the head of FAVORITES, unpin removes
 * it. Recents are untouched either way: a favorite that was recently opened
 * still reads as recent (it was).
 * @param {{favorites: string[], recents: string[]}} shelf
 * @param {string} path
 */
export const toggleFavorite = (shelf, path) => normalizeShelf({
  favorites: shelf.favorites.includes(path)
    ? shelf.favorites.filter((p) => p !== path)
    : [path, ...shelf.favorites],
  recents: shelf.recents,
});

/**
 * Dismiss one entry from RECENTS (the row's × affordance). Favorites keep
 * their own copy — dismissing a recent never unpins.
 * @param {{favorites: string[], recents: string[]}} shelf
 * @param {string} path
 */
export const removeRecent = (shelf, path) => normalizeShelf({
  favorites: shelf.favorites,
  recents: shelf.recents.filter((p) => p !== path),
});

/** @param {{favorites: string[]}} shelf @param {string} path */
export const isFavorite = (shelf, path) => shelf.favorites.includes(path);

/**
 * What a shelf row shows: the folder's name, with the parent path as the dim
 * hint that disambiguates two repos sharing a basename.
 * @param {string} path
 * @returns {{name: string, hint: string}}
 */
export const shelfEntryLabel = (path) => {
  const name = baseName(path);
  // The parent, through the one shared helper — this hand-rolled `lastIndexOf('/')`
  // gave a Windows path the whole string as its "name" and an empty hint (#227).
  const parent = dirOf(path);
  return { name, hint: parent === name || parent === '/' ? '' : parent };
};

/**
 * Boundary validator for the persisted open/collapsed state of the two shelf
 * sections. Anything malformed degrades to both OPEN — the shelf introduces
 * itself; a witness who folds it stays folded.
 * @param {unknown} raw
 * @returns {{favorites: boolean, recents: boolean}}
 */
export const normalizeShelfSections = (raw) => {
  const obj = (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) ? raw : {};
  return Object.freeze({
    favorites: typeof obj.favorites === 'boolean' ? obj.favorites : true,
    recents: typeof obj.recents === 'boolean' ? obj.recents : true,
  });
};
