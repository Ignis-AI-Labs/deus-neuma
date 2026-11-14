// window-storage.js — persist a window's geometry per key.
//
// impure — localStorage. Wallet-scoped so two witnesses sharing a browser
// don't inherit each other's layout, and slot-scoped (F-02) so every desk
// keeps its own: the window opened as desk N reclaims desk N's persisted
// layout across app restarts. Geometry is { x, y, w, h, maxed }.
//
// Size law split: key scoping lives in storage-scope.js; the panel/rail/tabs
// stores in panel-storage.js; unsent drafts in draft-storage.js. The barrel
// at the tail re-exports every moved name, so readers of this path never move.

import { normalizeFocus } from '../RelinkShell/desk-focus.js';
import { normalizeShelf, normalizeShelfSections } from '../RelinkShell/folder-shelf.js';
import { orderMode } from '../../../core/tasks/task-order.js';
import { scopedKey, walletKey } from './storage-scope.js';

export {
  STREAM_RAILS, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX, PANEL_WIDTH_DEFAULT,
  clampPanelWidth, normalizePanel, openRailOf, loadOpenRail, saveOpenRail,
  loadPanel, savePanel, loadTabs, saveTabs,
} from './panel-storage.js';
export {
  DRAFT_UNBOUND, draftKeyFor, loadDraft, nextDrafts, saveDraft,
} from './draft-storage.js';

/**
 * @param {string} key
 * @returns {{x,y,w,h,maxed?:boolean}|null}
 */
// impure
export const loadGeometry = (key) => {
  try {
    const raw = localStorage.getItem(scopedKey(key));
    if (!raw) return null;
    const g = JSON.parse(raw);
    return typeof g?.x === 'number' && typeof g?.w === 'number' ? g : null;
  } catch {
    return null;
  }
};

// impure
export const saveGeometry = (key, geom) => {
  try {
    localStorage.setItem(scopedKey(key), JSON.stringify(geom));
  } catch {
    // Layout persistence is a convenience, never load-bearing
  }
};

const DESK_KEY = 'desk:windows';

/**
 * The desk's open-set: which apps are open and which are minimized.
 * @returns {Array<{id: string, minimized?: boolean}>|null}
 */
// impure
export const loadDesk = () => {
  try {
    const raw = localStorage.getItem(scopedKey(DESK_KEY));
    if (!raw) return null;
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
};

// impure
export const saveDesk = (list) => {
  try {
    localStorage.setItem(scopedKey(DESK_KEY), JSON.stringify(list));
  } catch {
    // Desk persistence is a convenience, never load-bearing
  }
};

const FOCUS_KEY = 'desk:focus';

/**
 * The window's persisted working focus (D2) — same wallet+slot key-space as
 * geometry, so desk 1 keeps its unprefixed keys. Whatever localStorage holds
 * is validated on the way in: hostile or stale JSON yields null, never a
 * malformed focus.
 * @returns {{kind:'folder',path:string}|null}
 */
// impure
export const loadFocus = () => {
  try {
    const raw = localStorage.getItem(scopedKey(FOCUS_KEY));
    return raw ? normalizeFocus(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

// impure
export const saveFocus = (focus) => {
  try {
    if (focus === null) localStorage.removeItem(scopedKey(FOCUS_KEY));
    else localStorage.setItem(scopedKey(FOCUS_KEY), JSON.stringify(focus));
  } catch {
    // Focus persistence is a convenience, never load-bearing
  }
};

const SHELF_KEY = 'desk:folder-shelf';

/**
 * The witness's FAVORITES/RECENTS folder shelf, validated on the way in —
 * hostile or stale JSON degrades to an empty shelf, never a throw.
 * @returns {{favorites: string[], recents: string[]}}
 */
// impure
export const loadShelf = () => {
  try {
    const raw = localStorage.getItem(walletKey(SHELF_KEY));
    return normalizeShelf(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeShelf(null);
  }
};

// impure
export const saveShelf = (shelf) => {
  try {
    localStorage.setItem(walletKey(SHELF_KEY), JSON.stringify(normalizeShelf(shelf)));
  } catch (err) {
    // Convenience, never load-bearing — but never silent either.
    console.warn('folder shelf save failed (quota?)', err?.message);
  }
};

const PREFS_KEY = 'desk:prefs';

/**
 * Pure — boundary validator for the witness's desk behavior preferences.
 * `confirmDelete` guards the tree's destructive gesture: TRUE is the law of
 * the default AND of hostile/malformed storage — a junk value must never
 * silence a confirmation the witness didn't turn off themselves. Explicit
 * field-picking, same discipline as normalizePanel.
 * @param {unknown} raw
 * @returns {{confirmDelete: boolean}}
 */
export const normalizeDeskPrefs = (raw) => Object.freeze({
  confirmDelete:
    (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && typeof raw.confirmDelete === 'boolean')
      ? raw.confirmDelete
      : true,
});

/**
 * The desk prefs ride the wallet-scoped SLOT-FREE key-space (walletKey):
 * […] is the witness's answer, not one window's.
 * @returns {{confirmDelete: boolean}}
 */
// impure
export const loadDeskPrefs = () => {
  try {
    const raw = localStorage.getItem(walletKey(PREFS_KEY));
    return normalizeDeskPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeDeskPrefs(null);
  }
};

// impure
export const saveDeskPrefs = (prefs) => {
  try {
    localStorage.setItem(walletKey(PREFS_KEY), JSON.stringify(normalizeDeskPrefs(prefs)));
  } catch (err) {
    // Convenience, never load-bearing — but never silent either.
    console.warn('desk prefs save failed (quota?)', err?.message);
  }
};

const TASK_ORDER_KEY = 'desk:task-order';

/**
 * Which order the operator wants their work in — heaviest first, lightest
 * first, or the list's own (Design note, 2026-08-03: […]).
 *
 * Wallet-scoped and SLOT-FREE, like the desk prefs: how you like to take on
 * work is yours, not one window's — so the stream rail and the TASKS window
 * answer to the same choice instead of drifting apart.
 *
 * A malformed or unknown stored value degrades to `mine` rather than throwing:
 * the list's own order is the only one that claims nothing.
 * @returns {string}
 */
// impure
export const loadTaskOrder = () => {
  try {
    return orderMode(localStorage.getItem(walletKey(TASK_ORDER_KEY)));
  } catch {
    return 'mine';
  }
};

/** The one channel every surface hears the order change on. A `storage` event
 *  would not do: the browser fires that for OTHER documents, never the one that
 *  wrote — and the rail and the TASKS window live in the SAME document. */
export const TASK_ORDER_EVENT = 'neuma:task-order';

// impure
export const saveTaskOrder = (mode) => {
  const clean = orderMode(mode);
  try {
    localStorage.setItem(walletKey(TASK_ORDER_KEY), clean);
  } catch (err) {
    // Convenience, never load-bearing — but never silent either.
    console.warn('task order save failed (quota?)', err?.message);
  }
  // ANNOUNCED, not merely stored. Both surfaces read this on mount, so without
  // a notice the one you did NOT click keeps its old order until a reload —
  // two lists, sorted two ways, from a choice made once. The write can fail on
  // quota and the announcement still stands: what is on screen already changed.
  try {
    window.dispatchEvent(new CustomEvent(TASK_ORDER_EVENT, { detail: clean }));
  } catch { /* no window (tests, SSR) — the caller's own state is still right */ }
};

const SHELF_SECTIONS_KEY = 'desk:shelf-sections';

/**
 * The open/collapsed state of the two shelf sections — per-WINDOW UI state,
 * so it rides the same wallet+slot key-space as panel collapse.
 * @returns {{favorites: boolean, recents: boolean}}
 */
// impure
export const loadShelfSections = () => {
  try {
    const raw = localStorage.getItem(scopedKey(SHELF_SECTIONS_KEY));
    return normalizeShelfSections(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeShelfSections(null);
  }
};

// impure
export const saveShelfSections = (sections) => {
  try {
    localStorage.setItem(scopedKey(SHELF_SECTIONS_KEY), JSON.stringify(normalizeShelfSections(sections)));
  } catch (err) {
    // Convenience, never load-bearing — but never silent either.
    console.warn('shelf sections save failed (quota?)', err?.message);
  }
};
