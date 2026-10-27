// table-cell.js — which markdown table cells are SHORT (Design note, 2026-10-24:
// […]). A short cell — a name, a mark, a
// number, […] — reads as one unit, so it keeps one line and
// its column sizes to it; longer prose cells wrap at their spaces. Pure.

/** A cell this long or shorter stays on one line. */
export const SHORT_CELL_MAX = 20;

/**
 * The visible text of a hast node (a table cell), all descendants joined.
 * @param {object|null} node
 * @returns {string}
 */
export const cellText = (node) => {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  return Array.isArray(node.children) ? node.children.map(cellText).join('') : '';
};

/**
 * @param {object|null} node - the th/td hast node
 * @returns {boolean} true when the cell should keep one line
 */
export const isShortCell = (node) => [...cellText(node).trim()].length <= SHORT_CELL_MAX;
