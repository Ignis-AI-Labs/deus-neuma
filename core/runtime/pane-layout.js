/**
 * PANE LAYOUT — the stream, split, so several sittings are on screen at once.
 *
 * Design note, 2026-08-29: […]
 *
 * ── WHAT A PANE IS ──────────────────────────────────────────────────────────
 *
 * A pane is a VIEW OF A TAB, never a second kind of sitting. The strip stays
 * the one source of truth about what this window holds; a pane just says
 * […]. So there is nothing new to close, nothing to lose,
 * and no way for a sitting to exist in a pane but not on the strip.
 *
 * That has one hard consequence, enforced below: a tab occupies AT MOST ONE
 * pane. The same conversation drawn twice, with two composers, is two places
 * to type into one session — the exact confusion the tear-out law already
 * refuses ([…]).
 *
 * ── WHY PRESETS, NOT FREE SPLITTING ─────────────────────────────────────────
 *
 * Founder's own reason: past four […]. Five fixed
 * shapes cover every arrangement he named — one, two side by side, two
 * stacked, three, four — and every one of them is tidy by construction. A
 * free splitter can produce shapes nobody wants and then has to be tidied by
 * hand, which is a worse tool for the job it is being asked to do.
 *
 * ── ONE PANE HEARS YOU ──────────────────────────────────────────────────────
 *
 * Exactly one pane is FOCUSED. It takes typing, Escape, voice and shortcuts;
 * the others keep streaming in the background. A layout where every composer
 * is live has no answer to […], and voice has no
 * answer at all — it is one microphone.
 *
 * Pure. Every function takes a state and returns a new frozen one.
 */

/**
 * The shapes a stream may take. `panes` is how many sittings the shape shows;
 * `grid` is the CSS the desk paints it with, kept here so the shape and its
 * geometry can never drift apart.
 */
export const LAYOUTS = Object.freeze([
  Object.freeze({
    key: 'single', label: 'ONE', panes: 1,
    columns: '1fr', rows: '1fr', template: '"a"',
  }),
  Object.freeze({
    key: 'split-v', label: 'TWO · SIDE BY SIDE', panes: 2,
    columns: '1fr 1fr', rows: '1fr', template: '"a b"',
  }),
  Object.freeze({
    key: 'split-h', label: 'TWO · STACKED', panes: 2,
    columns: '1fr', rows: '1fr 1fr', template: '"a" "b"',
  }),
  Object.freeze({
    key: 'three', label: 'THREE', panes: 3,
    // One tall pane beside two stacked — the shape that reads as […].
    columns: '1fr 1fr', rows: '1fr 1fr', template: '"a b" "a c"',
  }),
  Object.freeze({
    key: 'quad', label: 'FOUR', panes: 4,
    columns: '1fr 1fr', rows: '1fr 1fr', template: '"a b" "c d"',
  }),
]);

/** The grid area a pane index occupies — the same letters the templates use. */
export const AREA_NAMES = Object.freeze(['a', 'b', 'c', 'd']);

/** The most panes a stream may ever show — Founder's line, and the reason for it. */
export const MAX_PANES = 4;

/** Pure — the layout record for a key, or the single-pane shape. */
export const layoutFor = (key) => LAYOUTS.find((l) => l.key === key) || LAYOUTS[0];

/** Pure — a fresh, unsplit stream. */
export const emptyPanes = () => Object.freeze({
  layout: 'single',
  // One entry per pane, holding a tab id or null. Index IS the pane.
  slots: Object.freeze([null]),
  focused: 0,
});

/** Pure — is this a pane-state shape we can reason about? */
const sane = (state) => Boolean(state)
  && Array.isArray(state.slots)
  && Number.isInteger(state.focused);

/** Pure — clamp a focus index into the slots that exist. */
const clampFocus = (focused, count) => Math.min(Math.max(0, focused), Math.max(0, count - 1));

const freeze = (layout, slots, focused) => Object.freeze({
  layout,
  slots: Object.freeze([...slots]),
  focused: clampFocus(focused, slots.length),
});

/**
 * Pure — change the shape.
 *
 * GROWING adds empty panes on the end; nothing already placed moves, because
 * an operator splitting a view expects what they were reading to stay where it
 * was. SHRINKING drops the trailing panes — and the sittings in them are NOT
 * closed, they simply stop being shown. They are still tabs on the strip,
 * still live, still one press from view. A layout change must never be able to
 * end a conversation.
 *
 * @param {object} state
 * @param {string} key - a LAYOUTS key
 */
export const setLayout = (state, key) => {
  if (!sane(state)) return emptyPanes();
  const next = LAYOUTS.find((l) => l.key === key);
  if (!next) return state;
  const slots = [...state.slots];
  while (slots.length < next.panes) slots.push(null);
  slots.length = next.panes;
  return freeze(next.key, slots, state.focused);
};

/**
 * Pure — show this tab in this pane.
 *
 * A tab lives in AT MOST ONE pane: placing one that is already shown elsewhere
 * MOVES it, leaving its old pane empty. Two panes on one session would be two
 * composers writing into one conversation.
 *
 * Placing a tab also FOCUSES its pane — the operator put it there to look at
 * it. Passing null empties the pane without moving focus.
 */
export const assignPane = (state, pane, tabId) => {
  if (!sane(state)) return emptyPanes();
  if (!Number.isInteger(pane) || pane < 0 || pane >= state.slots.length) return state;
  const slots = state.slots.map((id) => (tabId !== null && id === tabId ? null : id));
  slots[pane] = tabId ?? null;
  return freeze(state.layout, slots, tabId === null ? state.focused : pane);
};

/** Pure — which pane is showing this tab, or -1. */
export const paneOf = (state, tabId) => (
  sane(state) && tabId ? state.slots.indexOf(tabId) : -1
);

/** Pure — the tab a pane is showing, or null. */
export const tabInPane = (state, pane) => (
  sane(state) && Number.isInteger(pane) ? state.slots[pane] ?? null : null
);

/** Pure — move the live pane. Out-of-range asks are ignored, never clamped
 *  into some other pane the operator did not choose. */
export const focusPane = (state, pane) => {
  if (!sane(state)) return emptyPanes();
  if (!Number.isInteger(pane) || pane < 0 || pane >= state.slots.length) return state;
  return freeze(state.layout, state.slots, pane);
};

/**
 * Pure — reconcile against the tabs that actually exist.
 *
 * A closed tab leaves its pane empty rather than leaving a pane pointed at a
 * sitting that is gone. The SHAPE is kept: an operator who split into four
 * still has four panes after closing one conversation, and the empty one
 * invites the next.
 *
 * @param {object} state
 * @param {Array<{id: string}>} tabs
 */
export const prunePanes = (state, tabs) => {
  if (!sane(state)) return emptyPanes();
  const live = new Set((Array.isArray(tabs) ? tabs : []).map((t) => t?.id).filter(Boolean));
  const slots = state.slots.map((id) => (id && live.has(id) ? id : null));
  return freeze(state.layout, slots, state.focused);
};

/**
 * Pure — the focused pane's tab id, falling back to the first pane that holds
 * one. A split with the live pane empty still has to draw SOMETHING as the
 * window's bound sitting, or the title and controls would answer for nobody.
 */
export const activeTabId = (state) => {
  if (!sane(state)) return null;
  const focused = state.slots[state.focused];
  if (focused) return focused;
  return state.slots.find(Boolean) ?? null;
};

/**
 * Pure — put a tab on screen without being told where.
 *
 * The gesture behind […]: if it is already in a pane, focus
 * that pane. Otherwise take the first empty pane. If every pane is full, it
 * replaces the FOCUSED one — the operator's own cursor is the least surprising
 * thing to displace, and the displaced sitting is still a tab on the strip.
 */
export const showTab = (state, tabId) => {
  if (!sane(state) || !tabId) return sane(state) ? state : emptyPanes();
  const already = state.slots.indexOf(tabId);
  if (already !== -1) return focusPane(state, already);
  const empty = state.slots.indexOf(null);
  return assignPane(state, empty === -1 ? state.focused : empty, tabId);
};

/** Pure — is the stream split at all? The desk paints a single pane as the
 *  plain stream it always was, with no pane chrome anywhere. */
export const isSplit = (state) => sane(state) && state.slots.length > 1;

/** Serialize for window storage — the shape and its tab ids, nothing live. */
export const serializePanes = (state) => (sane(state)
  ? { layout: state.layout, slots: [...state.slots], focused: state.focused }
  : { layout: 'single', slots: [null], focused: 0 });

/**
 * Pure — restore a stored shape, defensively. Anything unreadable becomes the
 * plain single stream rather than a half-built grid.
 */
export const normalizePanes = (raw) => {
  if (!raw || typeof raw !== 'object') return emptyPanes();
  const layout = layoutFor(raw.layout);
  const stored = Array.isArray(raw.slots) ? raw.slots : [];
  const slots = [];
  const seen = new Set();
  for (let i = 0; i < layout.panes; i += 1) {
    const id = typeof stored[i] === 'string' && stored[i] && !seen.has(stored[i]) ? stored[i] : null;
    if (id) seen.add(id);
    slots.push(id);
  }
  const focused = Number.isInteger(raw.focused) ? raw.focused : 0;
  return freeze(layout.key, slots, focused);
};
