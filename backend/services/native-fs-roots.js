/**
 * THE ALLOWED-ROOTS WALL — which ground the filesystem organ may stand on.
 *
 * Extracted from native-filesystem.js under the size law. The organ is the
 * handlers; this is the question asked BEFORE any of them run: is this
 * directory one the platform can actually work in? It has one job, one write
 * path into lib.js's validation state, and one predicate that every caller
 * consults — so a folder can never be accepted by the grant path and refused
 * by the wall.
 *
 * impure — real stat/access/realpath. Owns the roots; the package takes them
 * as an argument now (2.x), so there is no module state to mirror into.
 */

import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import os from 'os';
import path from 'path';
import { expandHome, normalizePath } from '@modelcontextprotocol/server-filesystem/dist/path-utils.js';
import { createLogger } from './logger.js';

const log = createLogger('NativeFS');

/**
 * Named in refusals. A permission wall is only actionable once the operator
 * knows WHICH user hit it — "permission denied" on its own reads as a platform
 * bug rather than a filesystem fact. Pure enough (reads process identity).
 */
export const runningAs = () => {
  try {
    return `the platform (running as ${os.userInfo().username})`;
  } catch {
    return 'the platform';
  }
};

// Mirrors the package's own startup normalization: expand ~, resolve, and keep
// BOTH the stated and symlink-resolved forms when they differ, so a root named
// through a symlink admits paths spelled either way. impure (realpath).
const normalizeRoot = async (dir) => {
  const absolute = path.resolve(expandHome(dir));
  const stated = normalizePath(absolute);
  try {
    const resolved = normalizePath(await fs.realpath(absolute));
    return stated === resolved ? [resolved] : [stated, resolved];
  } catch {
    return [stated];
  }
};

/**
 * Why this process cannot use `dir` as a root, or null when it can.
 * impure (stat, access).
 *
 * WHY NOT `stat` ALONE (ruling, 2026-08-30). This check used to be
 * `stat(dir).isDirectory()`, which answers […] — and
 * that SUCCEEDS on a directory this process cannot open, because stat needs
 * permission on the PARENT, not on the directory itself.
 *
 * `/root` is `dr-xr-x---` owned by root; the platform runs as the operator's
 * own user. So `/root` passed, entered the allowlist, and was advertised to a
 * being as ALWAYS ALLOWED. Every read of it then died with a bare EACCES. The
 * being did the reasonable thing — re-listed its roots, saw `/root` still
 * there confirming the grant was good, and tried again. That loop had no exit,
 * because nothing in the refusal distinguished […]
 * (ask the operator) from […] (asking cannot
 * help).
 *
 * `access` puts the question to the kernel as the caller: may THIS uid read
 * (R_OK) and traverse (X_OK) it? That honours ACLs and mount options, which
 * reading the mode bits ourselves would not.
 */
const rootRefusal = async (dir) => {
  let stat;
  try {
    stat = await fs.stat(dir);
  } catch (err) {
    return err.code === 'ENOENT' ? 'it does not exist' : `it cannot be reached (${err.code})`;
  }
  if (!stat.isDirectory()) return 'it is a file, not a directory';
  try {
    await fs.access(dir, fsConstants.R_OK | fsConstants.X_OK);
  } catch {
    return `${runningAs()} cannot read it — a grant cannot override the filesystem's own permissions`;
  }
  return null;
};

/**
 * THE ROOTS NOW IN FORCE — the organ's own copy, in normalized form.
 *
 * This module is the owner. lib.js used to be the owner and this module its
 * only writer; the 2.x migration moves that duty here, because 2.x takes the
 * roots as an argument instead of holding them in module state. Reading them
 * from here is what lets every validatePath call state its own wall.
 */
let currentRoots = Object.freeze([]);

/**
 * The roots the filesystem organ may stand on, as last set. Empty until the
 * first setNativeFilesystemRoots call, which refuses every path — fail closed.
 * @returns {string[]} normalized roots (stated + symlink-resolved forms)
 */
export const getNativeFilesystemRoots = () => currentRoots;

/**
 * Replace the organ's allowed-roots wall. The single write path — every
 * reconnect-shaped caller (startup, pre-flight repoint, focus ground, witness
 * grants) lands here. A root this process cannot actually read is skipped
 * loudly, WITH the reason: "skipped" alone is what made the `/root` grant
 * undiagnosable.
 * impure — real stat/access/realpath; replaces module state.
 * @param {string[]} dirs - absolute directories to allow
 * @returns {Promise<string[]>} the roots now in force (stated + resolved forms)
 */
export const setNativeFilesystemRoots = async (dirs) => {
  const candidates = (await Promise.all(dirs.map(normalizeRoot))).flat();
  const roots = [];
  for (const dir of candidates) {
    if (roots.includes(dir)) continue;
    const refusal = await rootRefusal(dir);
    if (refusal === null) roots.push(dir);
    else log.warn('Allowed root skipped — the organ cannot stand on it', { dir, because: refusal });
  }
  currentRoots = Object.freeze(roots);
  return roots;
};

/**
 * Can this process use `dir` as a root, and if not, why? The one predicate the
 * grant path and the wall both consult, so a folder can never be accepted by
 * one and refused by the other. impure.
 * @param {string} dir
 * @returns {Promise<{ok: boolean, reason: string|null}>}
 */
export const checkRootUsable = async (dir) => {
  const reason = await rootRefusal(path.resolve(expandHome(String(dir || ''))));
  return { ok: reason === null, reason };
};
