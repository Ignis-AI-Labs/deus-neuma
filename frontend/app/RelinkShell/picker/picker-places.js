// picker-places.js — the pure core of the FolderPicker's rail and list.
//
// The rail answers […] in four standings, each a vertical list
// that reads the same way: PLACES (home, the filesystem root), PINNED (the
// witness shelf's favorites — the same shelf the Explorer shows), DRIVES
// (real mountpoints), RECENT (folders opened lately, minus the pinned ones so
// a place is listed once where it matters most). Every item carries a `sub`
// line — where it lives — because a bare basename lies: `/home` and the home
// folder both read "home", and two repos can share a name. Free of React and
// browser globals so it is node-testable on its own.

import { baseName, dirOf } from '../../../utils/path.js';

const item = (path, name, sub) => Object.freeze({ path, name, sub });

/**
 * The rail's sections, empty ones dropped.
 * @param {{ home?: string|null, drives?: Array<{path: string}>, favorites?: string[], recents?: string[] }} input
 * @returns {ReadonlyArray<{key: string, label: string, items: ReadonlyArray<{path: string, name: string, sub: string}>}>}
 */
export const railSections = ({ home = null, drives = [], favorites = [], recents = [] }) => {
  const root = drives.find((d) => d.path === '/' || /^[A-Za-z]:[\\/]$/.test(d.path));
  const places = [
    ...(home ? [item(home, 'Home', home)] : []),
    ...(root ? [item(root.path, 'Filesystem', root.path)] : []),
  ];
  const placed = new Set(places.map((p) => p.path));
  const pinned = new Set(favorites);
  const sections = [
    { key: 'places', label: 'PLACES', items: places },
    { key: 'pinned', label: 'PINNED', items: favorites.map((p) => item(p, baseName(p), dirOf(p))) },
    {
      key: 'drives',
      label: 'DRIVES',
      items: drives.filter((d) => !placed.has(d.path)).map((d) => item(d.path, baseName(d.path), d.path)),
    },
    {
      key: 'recent',
      label: 'RECENT',
      items: recents.filter((p) => !pinned.has(p)).map((p) => item(p, baseName(p), dirOf(p))),
    },
  ];
  return Object.freeze(sections.filter((s) => s.items.length > 0).map((s) => Object.freeze({ ...s, items: Object.freeze(s.items) })));
};

// Is `base` the path itself or one of its ancestors? Separator-aware so
// `/mnt/data` never claims `/mnt/data-archive`.
const contains = (base, p) => {
  if (p === base) return true;
  const withSep = /[\\/]$/.test(base) ? base : `${base}${base.includes('\\') ? '\\' : '/'}`;
  return p.startsWith(withSep);
};

/**
 * The rail item to light for the current folder: the deepest rail path that
 * is the cwd or contains it — you are "in" that place. Null when none does.
 * @param {string|null} cwd
 * @param {string[]} paths every rail item's path
 * @returns {string|null}
 */
export const activeRailPath = (cwd, paths) => {
  if (!cwd) return null;
  let best = null;
  for (const p of paths) {
    if (contains(p, cwd) && (best === null || p.length > best.length)) best = p;
  }
  return best;
};

/**
 * The list rows to show: hidden entries only when asked, then a
 * case-insensitive name filter.
 * @param {Array<{name: string, hidden: boolean}>|null} entries
 * @param {{ showHidden: boolean, query: string }} opts
 * @returns {Array<{name: string, hidden: boolean}>}
 */
export const visibleEntries = (entries, { showHidden, query }) => {
  const q = query.trim().toLowerCase();
  return (entries || []).filter((e) => (showHidden || !e.hidden) && (!q || e.name.toLowerCase().includes(q)));
};
