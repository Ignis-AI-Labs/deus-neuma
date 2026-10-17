// Path primitives — small pure helpers for the platform-native path strings the
// desk actually receives (project folders, shared files, map node ids, the
// `path` a being's tool act carries).
//
// They were POSIX-only until 2026-08-13, and the backend hands the renderer
// whatever the host uses. On Windows that broke three separate surfaces
// silently: the Explorer never refreshed after a being wrote a file (#224 —
// `dirOf('C:\\repos\\x\\f.txt')` returned `'/'`, so the refresh listed a
// directory that is not an open root), and FAVORITES and RECENTS could never
// populate because every guard was written `startsWith('/')` (#227).
//
// THE SEPARATOR IS READ FROM THE PATH'S SHAPE, NOT FROM THE HOST.
//
// The obvious fix — split on `/` and `\` everywhere — is wrong, and #224's own
// body proposed it: on POSIX a backslash is legal filename data, so
// `/home/x/notes\draft.md` would lose half its basename. Reading the host's
// platform instead would make these helpers impure and untestable, for no gain.
//
// The shapes do not overlap, which is what makes shape detection exact:
//   - an absolute POSIX path begins `/`            → `/` is the only separator
//   - a Windows drive path begins `C:\` or `C:/`   → both are separators
//   - a Windows UNC path begins `\\`               → both are separators
//
// A RELATIVE Windows path (`docs\file.md`) is indistinguishable from a POSIX
// filename containing a backslash, and is deliberately treated as the latter.
// Nothing on the desk passes one: every guard here requires an absolute path,
// and the backend sends absolute paths. That is why the ambiguity is safe rather
// than merely unlikely.

const DRIVE = /^[A-Za-z]:[\\/]/;
const UNC = /^\\\\/;

/** pure — does this path use Windows separators? Read from its own shape. */
const isWindowsShaped = (p) => DRIVE.test(p) || UNC.test(p);

/** pure — split a path into its segments, in its own separator alphabet. */
const segments = (p) => (isWindowsShaped(p) ? p.split(/[\\/]/) : p.split('/'));

/**
 * The root a path can never be trimmed past: `/` on POSIX, `C:\` for a drive,
 * `\\server\share` for UNC. Pure.
 * @param {string} p
 * @returns {string}
 */
const rootOf = (p) => {
  if (DRIVE.test(p)) return p.slice(0, 3);
  if (UNC.test(p)) {
    const parts = p.split(/[\\/]/).filter(Boolean);   // ['server','share',…]
    return parts.length >= 2 ? `\\\\${parts[0]}\\${parts[1]}` : p;
  }
  return '/';
};

/**
 * Is this an ABSOLUTE path on any platform the desk runs on? Pure.
 *
 * Every desk guard that used to read `p.startsWith('/')` reads this instead:
 * `folder-shelf.js` (favourites + recents), `desk-focus.js` (the persisted
 * window focus), `path-link.js` (a clickable address in a being's speech).
 * Each one silently discarded every Windows folder it was ever given (#227).
 *
 * Control characters are NOT judged here — each call site screens those
 * separately, because "not a path" and […] are
 * different refusals.
 * @param {string} p
 * @returns {boolean}
 */
export const isAbsolutePath = (p) =>
  typeof p === 'string' && (p.startsWith('/') || DRIVE.test(p) || UNC.test(p));

/**
 * Last non-empty segment of a path. Tolerates trailing separators (`/a/b/` →
 * `b`, `C:\a\b\` → `b`) and empty input (`''`), falling back to the whole
 * string when there is no separator to split on.
 *
 * A drive or UNC root answers with the root itself (`C:\` → `C:\`), because a
 * root's own name is the only honest label for it.
 * @param {string} [p='']
 * @returns {string}
 */
export const baseName = (p = '') => {
  if (!p) return '';
  const parts = segments(p).filter(Boolean);
  // `C:\` splits to ['C:'] — a drive root, whose only honest label is the root.
  if (DRIVE.test(p) && parts.length === 1) return rootOf(p);
  return parts.pop() || p;
};

/**
 * Parent directory of a path. `/a/b/c` → `/a/b`; `C:\a\b\c` → `C:\a\b`; a
 * top-level entry falls back to that platform's root.
 *
 * A TRAILING separator is trimmed first (`/root/newdir/` → `/root`). It used to
 * return the path itself, so a `create_directory` refresh re-listed the new
 * folder instead of the parent that has to reveal it — pinned as a known defect
 * in this function since #269 and fixed here against a test bed, as that note
 * asked.
 * @param {string} p
 * @returns {string}
 */
export const dirOf = (p) => {
  if (typeof p !== 'string' || p === '') return '/';
  const root = rootOf(p);
  // Trim trailing separators, but never into the root itself.
  let trimmed = p;
  while (trimmed.length > root.length && /[\\/]$/.test(trimmed)) trimmed = trimmed.slice(0, -1);
  if (trimmed.length <= root.length) return root;
  const cut = isWindowsShaped(p)
    ? Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
    : trimmed.lastIndexOf('/');
  const parent = cut < 0 ? '' : trimmed.slice(0, cut);
  // Slicing at the separator can land INSIDE the root (`C:` out of `C:\a`), so
  // the root is the floor a parent can never go below.
  return parent.length < root.length ? root : parent;
};

/**
 * The breadcrumb trail of an absolute path, root first, each crumb carrying
 * the absolute path it stands for: `/mnt/data` → `/` · `mnt` · `data`, and
 * `C:\Users\founder` → `C:\` · `Users` · `founder`. The root crumb is the root itself
 * (the only honest label for it). A relative or empty path has no trail. Pure.
 * @param {string} p
 * @returns {Array<{label: string, path: string}>}
 */
export const pathCrumbs = (p) => {
  if (!isAbsolutePath(p)) return [];
  const root = rootOf(p);
  const windows = isWindowsShaped(p);
  const sep = windows ? '\\' : '/';
  const rest = p.slice(root.length).split(windows ? /[\\/]/ : '/').filter(Boolean);
  const trail = [{ label: root, path: root }];
  let acc = root;
  for (const seg of rest) {
    acc = /[\\/]$/.test(acc) ? acc + seg : acc + sep + seg;
    trail.push({ label: seg, path: acc });
  }
  return trail;
};
