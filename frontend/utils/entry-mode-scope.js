// entry-mode-scope.js — TWO OPERATOR STATES: the harness and the full platform
// (Design note, 2026-10-14: […]). Signed in as the
// harness, the desk came up as the full desk: the same windows, tabs and
// companion, because both modes read one set of keys.
//
// This leaf is the one place that says which state this device entered as
// (frontend/app/entry-mode.js writes it). Every desk store keys through it —
// windowing/storage-scope.js (layout, tabs, rails, drafts, the shelf) and
// utils/companion-data.js (the bound companion). The FULL platform contributes
// nothing, so its keys are exactly the keys it has always had (zero
// migration); the harness gains its own `harness:` namespace. Operator
// preferences that are the person's in either state — language, theme,
// volume, zoom — stay on their own keys. No imports: a leaf, so no cycle.

/** localStorage key of this device's entry choice. */
export const ENTRY_MODE_KEY = 'neuma.entryMode';

/** impure — 'harness' or 'full' (anything else, or no storage, is full) */
export const currentEntryMode = () => {
  try {
    return localStorage.getItem(ENTRY_MODE_KEY) === 'harness' ? 'harness' : 'full';
  } catch {
    return 'full';
  }
};

/** impure — the key segment this state contributes: '' (full) or 'harness:' */
export const entryModeSegment = () => (currentEntryMode() === 'harness' ? 'harness:' : '');
