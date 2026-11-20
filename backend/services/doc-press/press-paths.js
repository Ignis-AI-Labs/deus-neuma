// press-paths.js — where the press may read and write for a being. impure (realpath, stat)
//
// Design note, 2026-10-28: beings must […] — read the
// document where it lives, press it with the kit that lives beside it, and set
// the PDF where the work is (a legal agent re-pressing docs/legal/pdf/ with the
// ignis-legal kit in docs/legal/press-kit/). Every path is absolute, resolved
// through its symlinks, and must stand inside the operator's open folder or
// the being's own workspace — judged by the same checkPathAccess the file
// tools cross, so a secret-shaped path, .git, a key or a hard-linked twin is
// refused here exactly as it is there — and a PDF is never written into a
// lane's platform state (laneStateWriteReason), as no file tool may.

import path from 'path';
import { checkPathAccess, laneStateWriteReason, realpathOfNearestExisting } from '../sandbox-path-policy.js';
import { getWitnessesRoot, getWorkspacesRoot } from '../../../core/workspace/neuma-workspace.js';
import { getHarnessRoot } from '../../../core/workspace/lane-grounds.js';

const SPECS = Object.freeze([
  Object.freeze({ arg: 'markdownPath', label: 'markdownPath', ext: '.md' }),
  Object.freeze({ arg: 'outputPath', label: 'outputPath', ext: '.pdf', write: true }),
  Object.freeze({ arg: 'kitsDir', label: 'kitsDir', ext: null }),
]);

// impure — one optional path argument, placed inside the roots or refused
// impure (env) — the grounds whose lanes hold platform state (tool-sandbox.js laneGrounds)
const laneGrounds = () => { const house = getWorkspacesRoot(); return [house, getWitnessesRoot(), getHarnessRoot(house)]; };

const place = async (value, { label, ext, write }, realRoots) => {
  if (value === undefined || value === null || value === '') return { value: undefined };
  if (typeof value !== 'string' || !path.isAbsolute(value)) return { error: `${label} must be an absolute path` };
  if (ext && path.extname(value).toLowerCase() !== ext) return { error: `${label} must end in ${ext}` };
  const real = await realpathOfNearestExisting(value);
  const check = checkPathAccess(real, realRoots);
  if (!check.allowed) {
    return { error: `${label} ${value} is not open to the press: it must be inside the operator's open folder or your own workspace${check.reason ? ` (${check.reason})` : ''}` };
  }
  // a pressed PDF never lands in platform state — a lane's config, identity or audit (C-01, audit 2026-10-28)
  const walled = write ? laneStateWriteReason(real, { grounds: laneGrounds() }) : null;
  if (walled) return { error: `${label} ${value} is not open to the press: ${walled}` };
  return { value: real };
};

/**
 * The press's optional paths, each placed inside `roots` or refused with a
 * reason. impure (realpath).
 * @param {{markdownPath?: string, outputPath?: string, kitsDir?: string}} args
 * @param {string[]} roots - the open folder and the being's own workspace
 * @returns {Promise<{markdownPath?: string, outputPath?: string, kitsDir?: string, error?: string}>}
 */
export const resolvePressPaths = async (args, roots) => {
  const realRoots = await Promise.all(roots.filter(Boolean).map((r) => realpathOfNearestExisting(r)));
  const out = {};
  for (const spec of SPECS) {
    const placed = await place(args?.[spec.arg], spec, realRoots);
    if (placed.error) return { error: placed.error };
    if (placed.value) out[spec.arg] = placed.value;
  }
  return out;
};

/**
 * The reader a document's images pass: an image is embedded only when its real path stands inside
 * the same roots, judged by the same checkPathAccess, as the markdownPath the press may read
 * (deus-neuma #33). impure (realpath)
 * @param {string[]} roots - the open folder and the being's own workspace
 * @returns {(file: string) => Promise<{ok: boolean, real?: string, why?: string}>}
 */
export const pressImageReader = (roots) => {
  const realRoots = Promise.all(roots.filter(Boolean).map((r) => realpathOfNearestExisting(r)));
  return async (file) => {
    const real = await realpathOfNearestExisting(file);
    const check = checkPathAccess(real, await realRoots);
    return check.allowed ? { ok: true, real } : { ok: false, why: `not inside the operator's open folder or your workspace${check.reason ? ` (${check.reason})` : ''}` };
  };
};
