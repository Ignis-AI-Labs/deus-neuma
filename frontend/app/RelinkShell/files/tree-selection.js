// tree-selection — the Explorer's multi-select model, pure.
//
// File-manager grammar (ruling, 2026-08-16): plain click selects the one row
// (and still toggles/opens); ctrl(meta)+click toggles that row in or out and
// moves the anchor; shift+click selects the visible range from the anchor;
// ctrl+shift extends the standing set with that range. A modified click only
// SELECTS — the caller must not toggle or open on it.

/** The empty selection. Frozen — never mutated, only replaced. */
export const EMPTY_SELECTION = Object.freeze({ paths: Object.freeze(new Set()), anchor: null });

/**
 * The tree's visible row order, exactly as FileNode renders it: each root,
 * then — for an expanded dir whose children are loaded — its non-hidden
 * children in place (hidden ones too when dotfiles are shown). Pure.
 * @param {{roots: string[], expanded: Set<string>, childrenMap: Object, showHidden: boolean}} view
 * @returns {string[]} paths in on-screen order
 */
export const visiblePaths = ({ roots, expanded, childrenMap, showHidden }) => {
  const out = [];
  const walk = (path, isDir) => {
    out.push(path);
    if (!isDir || !expanded.has(path)) return;
    for (const kid of (childrenMap[path] || []).filter((e) => showHidden || !e.hidden)) {
      walk(kid.path, kid.type === 'dir');
    }
  };
  for (const root of roots || []) walk(root, true);
  return out;
};

/**
 * One click's effect on the selection. Pure — returns a fresh selection.
 * @param {{paths: Set<string>, anchor: string|null}} selection
 * @param {string} path - the clicked row
 * @param {{ctrl?: boolean, shift?: boolean}} mods
 * @param {string[]} [order] - visible row order (needed for shift ranges)
 * @returns {{paths: Set<string>, anchor: string|null}}
 */
export const applyRowClick = (selection, path, { ctrl = false, shift = false } = {}, order = []) => {
  if (shift && selection.anchor) {
    const a = order.indexOf(selection.anchor);
    const b = order.indexOf(path);
    if (a !== -1 && b !== -1) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      // The anchor holds through shift clicks, so a second shift re-aims the
      // same range; ctrl+shift extends what already stands instead.
      const paths = ctrl ? new Set(selection.paths) : new Set();
      for (let i = lo; i <= hi; i += 1) paths.add(order[i]);
      return { paths, anchor: selection.anchor };
    }
  }
  if (ctrl) {
    const paths = new Set(selection.paths);
    if (paths.has(path)) paths.delete(path);
    else paths.add(path);
    return { paths, anchor: path };
  }
  return { paths: new Set([path]), anchor: path };
};
