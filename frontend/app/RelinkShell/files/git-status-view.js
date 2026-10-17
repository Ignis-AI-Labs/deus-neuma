// git-status-view.js — the explorer's git decorations, pure.
//
// Turns the backend's per-repo status ({ branch, ahead, behind, files:
// { repoRelPath: letter } }) into the badge each tree row shows. A file row
// wears its own letter; a directory row rolls up the STRONGEST letter of any
// descendant — one glance at a collapsed folder tells the witness something
// inside is dirty, exactly like VS Code's explorer.

// Rollup strength, strongest first: a conflict outranks a deletion, a
// deletion a modification, a modification an addition, an addition the mere
// presence of the untracked.
const STRENGTH = Object.freeze(['C', 'D', 'M', 'A', 'U']);

// Human words for the badge's title attribute — never a bare letter on hover.
const WORDS = Object.freeze({
  C: 'conflicted',
  D: 'deleted',
  M: 'modified',
  A: 'added',
  U: 'untracked',
});

/**
 * The repo-relative path of an entry under its root ('' for the root itself).
 * @param {string} root absolute root path
 * @param {string} absPath absolute entry path
 * @returns {string}
 */
// pure
export const repoRel = (root, absPath) => absPath.slice(root.length).replace(/^\/+/, '');

/**
 * The badge a row shows, or null for a clean row.
 * @param {Object<string, string>|null|undefined} files repoRelPath → letter
 * @param {string} rel repo-relative path of the row ('' = the root)
 * @param {boolean} isDir
 * @returns {string|null} one of C/D/M/A/U
 */
// pure
export const badgeFor = (files, rel, isDir) => {
  if (!files) return null;
  if (!isDir) return files[rel] ?? null;
  const prefix = rel === '' ? '' : `${rel}/`;
  let best = null;
  for (const [p, letter] of Object.entries(files)) {
    if (prefix && !p.startsWith(prefix)) continue;
    if (!best || STRENGTH.indexOf(letter) < STRENGTH.indexOf(best)) best = letter;
  }
  return best;
};

/**
 * The hover word for a badge letter ('modified', …) — null in, null out.
 * @param {string|null} letter
 * @returns {string|null}
 */
// pure
export const badgeWord = (letter) => WORDS[letter] ?? null;

/**
 * The repo's overall state, for the focus name's color (witness law):
 * 'conflicted' — any path in conflict (red, broken); 'dirty' — any
 * uncommitted change (amber); 'clean' — fully committed (green).
 * @param {Object<string, string>|null|undefined} files
 * @returns {'conflicted'|'dirty'|'clean'}
 */
// pure
export const repoState = (files) => {
  if (!files) return 'clean';
  const letters = Object.values(files);
  if (letters.includes('C')) return 'conflicted';
  return letters.length > 0 ? 'dirty' : 'clean';
};

/**
 * Is this row git-ignored? `--ignored=matching` collapses ignored
 * directories, so a row inside one matches by prefix. The root itself
 * (rel '') is never "ignored".
 * @param {string[]|null|undefined} ignored repo-relative ignored paths
 * @param {string} rel repo-relative row path
 * @returns {boolean}
 */
// pure
export const isIgnored = (ignored, rel) =>
  Array.isArray(ignored) && rel !== '' && ignored.some((p) => rel === p || rel.startsWith(`${p}/`));

/**
 * The header's divergence readout ('↑2 ↓1'), or '' when there is nothing to
 * say (no upstream, or perfectly in step) — never '↑0 ↓0' noise.
 * @param {number} ahead
 * @param {number} behind
 * @returns {string}
 */
// pure
export const divergenceLabel = (ahead, behind) =>
  [ahead > 0 ? `↑${ahead}` : '', behind > 0 ? `↓${behind}` : ''].filter(Boolean).join(' ');
