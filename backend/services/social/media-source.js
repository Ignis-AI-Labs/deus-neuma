/**
 * Media source — which files on this machine may leave it as public media.
 *
 * Attaching an image to a post is EGRESS OF A FILE. A being naming a path it
 * was never given is the difference between […] and
 * […], so the path is resolved
 * against grounds the operator already opened, never taken at its word.
 *
 * The defence is realpath, not string prefixing: `..` segments, a symlink
 * pointed out of the ground, and a hardlink farm all collapse once both the
 * candidate and the roots are fully resolved before comparison. What is
 * stored on the queue entry afterwards is that resolved real path, and the
 * publisher resolves it AGAIN at send time and requires the same answer — so
 * a file swapped for a symlink between staging and publication is caught by
 * the send, not discovered by the public.
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * True when `candidate` is `root` or lives beneath it. Pure; both arguments
 * must already be resolved real paths.
 * @param {string} candidate
 * @param {string} root
 */
export const isUnderRoot = (candidate, root) => {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Resolve one media path against the grounds this seat may read from.
 *
 * impure (disk — realpath, and the roots are realpath'd too)
 * @param {string} rawPath - as the being named it
 * @param {Array<string>} roots - grounds the operator has opened for this seat
 * @returns {Promise<{ok: true, path: string}|{ok: false, detail: string}>}
 */
export const resolveMediaFile = async (rawPath, roots = []) => {
  const named = String(rawPath || '').trim();
  if (!named) return { ok: false, detail: 'no media path was given' };
  if (!path.isAbsolute(named)) {
    return { ok: false, detail: `media path must be absolute — got "${named}"` };
  }
  if (!roots.length) {
    return {
      ok: false,
      detail: 'no folder is open to take media from. Ask your operator to open the folder holding the image in the Explorer, then name the file again.',
    };
  }

  let real;
  try {
    real = await fs.realpath(named);
  } catch {
    return { ok: false, detail: `no such file: ${named}` };
  }

  // Roots are resolved too: an unresolved root would let a symlinked ground
  // compare unequal against a correctly-resolved candidate inside it.
  const resolvedRoots = [];
  for (const root of roots) {
    try { resolvedRoots.push(await fs.realpath(root)); } catch { /* a root that is gone grants nothing */ }
  }
  if (!resolvedRoots.some((root) => isUnderRoot(real, root))) {
    return {
      ok: false,
      detail: `${named} is outside every folder open to you. Media can only be posted from ground your operator has opened.`,
    };
  }
  return { ok: true, path: real };
};

/**
 * Re-resolve a stored media path at publication time and require the SAME
 * answer staging produced. Anything that moved, vanished, or became a symlink
 * to somewhere else fails the send instead of being posted.
 *
 * impure (disk)
 * @param {string} storedPath - the real path recorded when the post was staged
 * @returns {Promise<{ok: true, path: string}|{ok: false, detail: string}>}
 */
export const reverifyMediaFile = async (storedPath) => {
  try {
    const real = await fs.realpath(storedPath);
    if (real !== storedPath) {
      return { ok: false, detail: `${storedPath} now resolves to ${real} — it changed after it was staged` };
    }
    return { ok: true, path: real };
  } catch {
    return { ok: false, detail: `the staged media is gone: ${storedPath}` };
  }
};
