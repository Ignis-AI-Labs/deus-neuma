// Pure view logic for the desktop right-click menu (LINE & CYCLE).
//
// The item shapes arrive from Electron main's pure builder
// (electron/context-menu.cjs) over the preload bridge; this module decides
// how they read and where the menu sits. Pure — unit-tested without a DOM.

/** Chrome labels are uppercase + letterspaced (LINE & CYCLE); content —
 *  a suggestion word, the misspelling itself — keeps its own case. */
export const ROLE_LABELS = Object.freeze({
  cut: 'CUT',
  copy: 'COPY',
  paste: 'PASTE',
  selectAll: 'SELECT ALL',
});

/**
 * Display label for one menu item. Pure.
 * @param {{kind: string, word?: string, role?: string}} item
 * @returns {string}
 */
export const itemLabel = (item) => {
  if (item.kind === 'suggestion') return item.word;
  if (item.kind === 'add-to-dictionary') return `ADD “${item.word}” TO DICTIONARY`;
  return ROLE_LABELS[item.role] || (item.role || '').toUpperCase();
};

/** Separators render but are never selectable. */
export const isSelectable = (item) => item.kind !== 'separator';

/**
 * Move the keyboard selection over the items, skipping separators, with
 * wrap-around. Pure. `current` of -1 means nothing selected yet.
 * @param {Array} items
 * @param {number} current - Current index (-1 for none)
 * @param {1|-1} dir
 * @returns {number} Next selectable index (-1 when nothing is selectable)
 */
export const moveSelection = (items, current, dir) => {
  if (!items.some(isSelectable)) return -1;
  let i = current;
  for (let step = 0; step < items.length; step += 1) {
    // + items.length before the modulo keeps i non-negative for the whole
    // contracted domain (current >= -1, dir = ±1) — no sign fixup needed.
    i = (i + dir + items.length) % items.length;
    if (isSelectable(items[i])) return i;
  }
  return current;
};

/**
 * Keep the menu fully inside the viewport: flip/clamp toward the opposite
 * side when the natural position would overflow. Pure.
 * @param {{x: number, y: number}} at - Requested position (cursor)
 * @param {{menuW: number, menuH: number, viewW: number, viewH: number}} size
 * @param {number} [margin]
 * @returns {{x: number, y: number}}
 */
export const clampPosition = ({ x, y }, { menuW, menuH, viewW, viewH }, margin = 8) => ({
  x: Math.max(margin, Math.min(x, viewW - menuW - margin)),
  y: Math.max(margin, Math.min(y, viewH - menuH - margin)),
});
