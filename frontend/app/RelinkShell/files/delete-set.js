// delete-set — which paths one delete gesture takes, pure.
//
// File-manager grammar (Design note, 2026-08-16: a delete gesture on a row INSIDE
// the standing multi-selection takes the WHOLE selection; on a row outside
// it, just that row. Open roots never delete (the tree's standing law — a
// root closes, it is not destroyed), and a path whose ancestor is already in
// the set folds into it: deleting the ancestor is the whole act.

/**
 * Whether `path` lives strictly under directory `dir`. Pure.
 * @param {string} path
 * @param {string} dir
 * @returns {boolean}
 */
export const isUnder = (path, dir) => path.startsWith(`${dir.replace(/\/+$/, '')}/`);

/**
 * The effective delete set for one gesture. Pure.
 * @param {Set<string>} selection - the standing selected paths
 * @param {string} clickedPath - the row the gesture landed on
 * @param {string[]} [roots] - the open roots (never deletable)
 * @returns {string[]} top-level paths to delete, sorted
 */
export const deleteSetFor = (selection, clickedPath, roots = []) => {
  const chosen = (selection?.has(clickedPath) && selection.size > 1)
    ? [...selection]
    : [clickedPath];
  const eligible = chosen.filter((p) => !roots.includes(p));
  return eligible
    .filter((p) => !eligible.some((other) => other !== p && isUnder(p, other)))
    .sort();
};
