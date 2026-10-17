// panel-storage.js — the Explorer panel, the stream's side rails, and the
// tab strips: persisted per window, extracted whole from window-storage
// (size law). Same wallet+slot key-space as geometry (storage-scope.js);
// window-storage re-exports everything here so its readers never move.
//
// impure — localStorage.

import { scopedKey } from './storage-scope.js';
import { normalizeTabs, serializeTabs } from '../../../core/runtime/tabs-model.js';
// A tab carries its own working ground now, and localStorage is writable by
// anything — so the focus module's own boundary validator rides the restore.
// `normalizeTabs` deliberately holds NO second opinion about what a valid
// focus is (a duplicate would drift, and this value becomes a filesystem
// lens); it fails closed without this and drops every stored ground.
import { normalizeFocus } from '../RelinkShell/desk-focus.js';

const PANEL_KEY = 'desk:panel';
// The stream's side rails are EXCLUSIVE — one open at a time (Founder,
// 2026-08-15: […]).
// The persisted value NAMES the open rail instead of folding each rail
// independently; a future rail joins by id rather than adding another fold.
const STREAM_RAIL_KEY = 'stream:rail';
// ⚠️ A NEW RAIL MUST JOIN THIS LIST OR IT CANNOT OPEN. `openRailOf` coerces
// any unknown id to 'tasks', so a rail that registers a button, renders, and is
// clicked will SILENTLY swap the tasks panel in instead — no error, no warning,
// just the wrong panel. (Witnessed 2026-08-30 adding PERMISSIONS.)
export const STREAM_RAILS = Object.freeze(['tasks', 'chats', 'permissions']);

/**
 * Pure — boundary validator for the persisted Explorer panel state (D6).
 * Anything but an object carrying boolean `collapsed` degrades to the
 * default (expanded); hostile extras are dropped by explicit field-picking.
 * @param {unknown} raw
 * @returns {{collapsed: boolean}}
 */
/**
 * The Explorer rail's width, in px. Bounded because a panel is only useful
 * between […] and […] — and because this
 * value comes back off localStorage, where anything can be written.
 */
export const PANEL_WIDTH_MIN = 200;
export const PANEL_WIDTH_MAX = 720;
export const PANEL_WIDTH_DEFAULT = 300;

/**
 * Clamp a candidate width to the usable band. Pure.
 *
 * Junk falls to the DEFAULT, not to the minimum — and the difference matters,
 * because `Number(null)`, `Number([])` and `Number('')` are all `0`, which is
 * finite. A bare `Number()` coercion would read a corrupt record as […] and silently honour it. Only a
 * real number, or a string that actually spells one, counts as a choice.
 */
export const clampPanelWidth = (px) => {
  const n = typeof px === 'number'
    ? px
    : (typeof px === 'string' && px.trim() !== '' ? Number(px) : NaN);
  if (!Number.isFinite(n)) return PANEL_WIDTH_DEFAULT;
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(n)));
};

export const normalizePanel = (raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || typeof raw.collapsed !== 'boolean') {
    return { collapsed: false };
  }
  // `width` is OPTIONAL and only rides when it is really there: the stream rail
  // shares this validator and has no width of its own, so an absent width must
  // stay absent rather than being invented as a default it would then persist.
  return raw.width === undefined
    ? { collapsed: raw.collapsed }
    : { collapsed: raw.collapsed, width: clampPanelWidth(raw.width) };
};

// Pure — boundary validator: a known rail id, or null (everything folded).
// Junk degrades to 'tasks', the historic default — a rail the operator has
// never met should show itself once.
export const openRailOf = (raw) => (raw === null || STREAM_RAILS.includes(raw) ? raw : 'tasks');

// impure
export const loadOpenRail = () => {
  try {
    const raw = localStorage.getItem(scopedKey(STREAM_RAIL_KEY));
    return raw ? openRailOf(JSON.parse(raw)) : 'tasks';
  } catch { return 'tasks'; }
};

// impure
export const saveOpenRail = (which) => {
  try {
    localStorage.setItem(scopedKey(STREAM_RAIL_KEY), JSON.stringify(openRailOf(which)));
  } catch {
    // Convenience, never load-bearing.
  }
};

/**
 * The Explorer panel's persisted collapse state — same wallet+slot key-space
 * as geometry, validated on the way in.
 * @returns {{collapsed: boolean}}
 */
// impure
export const loadPanel = () => {
  try {
    const raw = localStorage.getItem(scopedKey(PANEL_KEY));
    return raw ? normalizePanel(JSON.parse(raw)) : { collapsed: false };
  } catch (err) {
    // Convenience, never load-bearing — but never silent either.
    console.warn('panel state load failed, defaulting to expanded', err?.message);
    return { collapsed: false };
  }
};

// impure
export const savePanel = (panel) => {
  try {
    localStorage.setItem(scopedKey(PANEL_KEY), JSON.stringify(normalizePanel(panel)));
  } catch (err) {
    // Convenience, never load-bearing — but never silent either.
    console.warn('panel state save failed (quota?)', err?.message);
  }
};

const TABS_KEY = 'desk:tabs';

/**
 * A STREAM WINDOW's TAB STRIP — same wallet+slot key-space as geometry, panel
 * and focus.
 *
 * `scope` names WHICH stream window's strip (Design note, 2026-07-31: […]).
 * Every stream window runs its own sitting, so every stream window owns its own
 * strip — sharing one set let two windows holding different beings each
 * retarget the other's tab, and the strip visibly fought itself.
 *
 * No scope is the DESK's own strip, and its key stays byte-identical to what it
 * has always been: the primary window must not lose its tabs to a rename.
 *
 * The BUDGETS are machine-wide and deliberately not stored here: they are
 * answered from the server's live count (`tabs:counts`) and the capacity scan,
 * because a window cannot be trusted to know what the machine is holding.
 *
 * Session ids ARE persisted (Design note, 2026-08-02: […]), and `normalizeTabs` validates them to the
 * workspace's session-id shape on the way back — localStorage is writable by
 * anything. This does not reverse the 2026-07-30 […] law: that
 * law governs BINDING, resume is disk-only, and a restored tab still binds only
 * when focused. See the RESTART note in core/runtime/tabs-model.js.
 *
 * // impure
 * @param {string} [scope] - the stream window's id, or absent for the desk's own
 * @returns {{tabs: Array, focusedId: (string|null)}}
 */
const tabsKey = (scope) => (scope ? `${TABS_KEY}:${scope}` : TABS_KEY);

export const loadTabs = (scope) => {
  try {
    const raw = localStorage.getItem(scopedKey(tabsKey(scope)));
    return normalizeTabs(raw ? JSON.parse(raw) : null, { normalizeFocus });
  } catch (err) {
    // Convenience, never load-bearing — but never silent either.
    console.warn('tab strip load failed, opening with none', err?.message);
    return normalizeTabs(null);
  }
};

// impure
export const saveTabs = (state, scope) => {
  try {
    localStorage.setItem(scopedKey(tabsKey(scope)), JSON.stringify(serializeTabs(state)));
  } catch (err) {
    console.warn('tab strip save failed (quota?)', err?.message);
  }
};
