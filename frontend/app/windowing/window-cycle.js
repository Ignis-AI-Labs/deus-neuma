// window-cycle.js — Shift+\ moves between open windows.
//
// Design note, 2026-07-27: […]
//
// Muscle memory he already has, carried into the desk. The desk's equivalent of
// an editor's tabs is its OPEN WINDOWS, so that is what cycles.
//
// STABLE ORDER, NOT MOST-RECENTLY-USED. Alt+Tab's MRU list only works because
// you HOLD a modifier: the order freezes while you tab and commits on release.
// `Shift+\` is a discrete chord with no hold, so MRU would ping-pong between
// the last two windows forever and never reach the fifth. Open order is what
// the state already gives us — `raise()` changes only `z`, `open()` appends —
// so the same key always lands in the same place.
//
// Pure — no React, no DOM traversal beyond reading the event's target, so the
// decisions are provable without a desk.

/** The physical `\|` key. Keyed by CODE, not character, so a layout that puts
 *  the pipe elsewhere still answers to the key Founder actually named. */
const CYCLE_CODE = 'Backslash';

/**
 * Is focus somewhere that TYPES? If so the shortcut must stay out of the way.
 *
 * `Shift+\` is the `|` character. An unguarded global handler would steal every
 * pipe typed into the composer, the terminal, a path or a regex — a far worse
 * regression than having no shortcut at all. Anything inside a text surface is
 * covered, not just the element itself, so a rich editor's inner nodes count.
 *
 * `plaintext-only` is listed alongside `""` and `"true"`: it is a real editable
 * value in current browsers and satisfies this function's own contract, so
 * omitting it would leave a surface that types AND loses focus. Nothing in the
 * desk uses it today — it is here so that adding one later cannot quietly
 * reopen the hazard.
 *
 * Every `input` counts, including checkboxes and radios. Over-refusing costs a
 * shortcut press on a checkbox; under-refusing costs a keystroke, and the
 * keystroke is worth more.
 *
 * Pure.
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
const TYPING_SELECTOR = 'input, textarea, select, '
  + '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

export const isTypingTarget = (target) => {
  const el = target && typeof target === 'object' ? target : null;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest(TYPING_SELECTOR));
};

/**
 * Does this event ask for a cycle, and in which direction? Pure.
 *
 * Shift+\            → forward
 * Ctrl/Cmd+Shift+\   → backward
 *
 * Alt is deliberately not used: on several layouts Alt+key composes a character
 * rather than acting as a modifier.
 *
 * @param {KeyboardEvent} e
 * @returns {1|-1|0} 0 = not a cycle
 */
export const cycleDirection = (e) => {
  if (!e || !e.shiftKey) return 0;
  // `key` is checked too so a layout reporting only the character still works.
  if (e.code !== CYCLE_CODE && e.key !== '|') return 0;
  if (e.altKey) return 0;
  return (e.ctrlKey || e.metaKey) ? -1 : 1;
};

/**
 * The window to focus next, in stable open order, wrapping at both ends.
 *
 * Returns null when there is nothing to do — no windows, or only one, so a
 * stray keypress never dispatches a pointless focus.
 *
 * Pure.
 * @param {Array<{id: string}>} windows in open order
 * @param {string|null} focusedId
 * @param {1|-1} direction
 * @returns {string|null}
 */
export const nextWindowId = (windows, focusedId, direction = 1) => {
  const ids = (windows || []).map((w) => w?.id).filter((id) => typeof id === 'string');
  if (ids.length < 2) return null;
  const at = ids.indexOf(focusedId);
  // Nothing focused (or a stale id): start at the ends rather than refusing —
  // the operator pressed a key and deserves a window.
  if (at === -1) return direction > 0 ? ids[0] : ids[ids.length - 1];
  const step = direction > 0 ? 1 : -1;
  return ids[(at + step + ids.length) % ids.length];
};
