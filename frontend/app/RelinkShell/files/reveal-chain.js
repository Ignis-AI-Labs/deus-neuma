// reveal-chain — the folders the FILES tree must open to show a folder.
//
// "Show in files" (media-menu.js) lands the Explorer on a file's folder. The
// tree is lazy: a folder deep inside an open root is only visible once every
// folder between the root and it is expanded. This names that chain. Pure.

const trimSep = (p) => (p.length > 1 ? p.replace(/[\\/]+$/, '') : p);
const holds = (root, dir) => dir === root || dir.startsWith(`${root}/`) || dir.startsWith(`${root}\\`);

/**
 * Pure — the innermost open root that holds `dir`, then every folder below it
 * down to `dir` itself, outermost first. Empty when no open root holds it.
 * @param {string[]} roots the open roots
 * @param {string} dir an absolute folder
 * @returns {string[]}
 */
export const revealChain = (roots, dir) => {
  if (typeof dir !== 'string' || !dir) return [];
  const target = trimSep(dir);
  const root = (Array.isArray(roots) ? roots : [])
    .filter((r) => typeof r === 'string' && r)
    .map(trimSep)
    .filter((r) => holds(r, target))
    .sort((a, b) => b.length - a.length)[0];
  if (!root) return [];
  const chain = [root];
  let at = root.length;
  while (at < target.length) {
    const next = target.slice(at + 1).search(/[\\/]/);
    at = next === -1 ? target.length : at + 1 + next;
    chain.push(target.slice(0, at));
  }
  return chain;
};

/**
 * Pure — can the Explorer show `dir` through the window's focus lens? An
 * unscoped tree (no focus: `focusRoots` null) can, once the folder is open; a
 * focused tree only when one of its focus roots holds it.
 * @param {string[]|null} focusRoots desk-focus.js focusRootsOf
 * @param {string} dir
 * @returns {boolean}
 */
export const explorerShows = (focusRoots, dir) => focusRoots === null || revealChain(focusRoots, dir).length > 0;
