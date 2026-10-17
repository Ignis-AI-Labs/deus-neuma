/**
 * ROOT LOCK — the backend refuses to boot into an empty house.
 *
 * ── THE INCIDENT THIS EXISTS FOR (2026-07-31) ───────────────────────────────
 *
 * Two uncommitted lines repointed the dev desk's data root at `~/.neuma`. The
 * files holding the operator's POINTERS live under that root:
 *
 *   settings/workspace.json   → the real workspace + witness roots
 *   settings/user-realm.json  → where the chat logs live
 *   settings/look.json        → the desk's look
 *
 * All three resolved to a directory that did not exist. The workspace pointer
 * was lost, the root fell back to a default holding one being, every other lane
 * went out of reach — including a witness lane with 6MB of conversation — and
 * the desk came up wearing default colours with no history. NOTHING WAS
 * DELETED. Everything was UNREACHABLE, and from a desk those are identical.
 *
 * ── WHY NOTHING CAUGHT IT ───────────────────────────────────────────────────
 *
 * Every test passed, and always would have. The settings layer's specs each
 * point at their own temp path so they never touch real data — which means a
 * change to WHERE REAL DATA LIVES is invisible to the suite by construction.
 * The refactor was mechanically perfect across 31 files. No assertion anywhere
 * said […], because no test
 * is allowed to know where they are.
 *
 * So the check cannot live in a test. It has to live in the boot.
 *
 * ── WHAT IT GUARDS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────
 *
 * INFRASTRUCTURE roots only: the settings directory and the DNA vault. Those
 * are decided by the build, never by the operator at boot, so any change to
 * them is a code change and worth stopping for.
 *
 * The WORKSPACE root is NOT guarded here, on purpose: the operator repoints it
 * themselves in preflight, and the new one is legitimately empty when they do.
 * Refusing there would break a real flow to prevent an imaginary one — and
 * workspace-settings already reports its own conflicts loudly.
 *
 * ── WHEN IT REFUSES ─────────────────────────────────────────────────────────
 *
 * Only when a move LOSES something: the old root held files and the new one
 * holds none. A first run, an unchanged root, a completed migration, and a move
 * away from an already-empty root all pass in silence. That narrowness is the
 * point — a guard that cries wolf gets disabled, and then guards nothing.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Where the lock is remembered.
 *
 * Anchored at the OS home and NOT at the data root — a lock stored under the
 * thing it is watching would move with it and silently forget, which is the
 * exact failure it exists to catch.
 *
 * The env override is for TESTS. This guard is here to catch an ACCIDENT, not
 * to be tamper-proof against someone deliberately switching it off; a lock that
 * cannot be pointed at a temp dir cannot be proven to work at all.
 */
export const lockPath = () => process.env.NEUMA_ROOT_LOCK_PATH
  || path.join(os.homedir(), '.neuma', 'root-lock.json');

/** The roots this guard watches. Infrastructure only — see the header. */
export const WATCHED = Object.freeze(['settings', 'vault']);

/**
 * Pure — what does this root's move mean?
 *
 * @param {?string} was - the root recorded last boot, or null on a first run
 * @param {string} now - the root resolved this boot
 * @param {{was: number, now: number}} files - how many files each holds
 * @returns {{verdict: string, refuse: boolean}}
 */
export const assessRoot = (was, now, files = { was: 0, now: 0 }) => {
  if (!was || typeof was !== 'string') return Object.freeze({ verdict: 'first-run', refuse: false });
  if (was === now) return Object.freeze({ verdict: 'unchanged', refuse: false });
  // The new home already holds data — a real migration happened, or the
  // operator moved deliberately. Nothing is out of reach.
  if (files.now > 0) return Object.freeze({ verdict: 'migrated', refuse: false });
  // The old home holds nothing either — a move that loses nothing.
  if (files.was <= 0) return Object.freeze({ verdict: 'empty-move', refuse: false });
  // Old root full, new root empty. This is the one.
  return Object.freeze({ verdict: 'lost', refuse: true });
};

/**
 * impure — how many files live under a directory. Bounded in both depth and
 * count: this runs on every boot and must never become a disk walk.
 */
export const countFiles = (dir, { maxDepth = 3, cap = 500 } = {}) => {
  let seen = 0;
  const walk = (at, depth) => {
    if (seen >= cap || depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(at, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen >= cap) return;
      if (e.isFile()) seen += 1;
      else if (e.isDirectory()) walk(path.join(at, e.name), depth + 1);
    }
  };
  walk(dir, 0);
  return seen;
};

/** impure — the roots recorded at the last successful boot, or {} when none. */
export const readLock = () => {
  try {
    const raw = fs.readFileSync(lockPath(), 'utf8');
    const { roots } = JSON.parse(raw) ?? {};
    // A plain OBJECT or nothing. `roots` being merely truthy is not enough —
    // a string passes that check and then answers every lookup with undefined,
    // which reads as "first run" for every root at once: the guard would go
    // quiet exactly when its own record was damaged.
    const usable = roots && typeof roots === 'object' && !Array.isArray(roots);
    return usable ? roots : {};
  } catch {
    return {}; // absent or corrupt — treated as a first run, never as a refusal
  }
};

/** impure — remember these roots. A lock we cannot write must never fail the
 *  boot: the cost is one missed comparison, not a desk that will not start. */
export const writeLock = (roots) => {
  try {
    fs.mkdirSync(path.dirname(lockPath()), { recursive: true });
    fs.writeFileSync(lockPath(), JSON.stringify({ roots, at: new Date().toISOString() }, null, 2));
    return true;
  } catch {
    return false;
  }
};

/**
 * Pure — the words an operator reads when a root moved out from under them.
 * Names both paths and what is at each, because "refusing to boot" without the
 * two numbers is just another mystery.
 */
export const refusalText = (key, was, now, files) => (
  `The ${key.toUpperCase()} root moved, and the new one is empty.\n`
  + `    was:  ${was}   (${files.was} file${files.was === 1 ? '' : 's'})\n`
  + `    now:  ${now}   (${files.now} files)\n`
  + '  Nothing has been deleted — it is UNREACHABLE, which from a desk looks the same.\n'
  + `  Either point it back (the root is resolved in services/data-root.js), or move\n`
  + `  the ${files.was} file${files.was === 1 ? '' : 's'} to the new root first. `
  + 'REFUSING TO BOOT rather than come up with an empty house.'
);

/**
 * impure — check every watched root and report what must stop the boot.
 *
 * @param {Record<string, string>} roots - {settings, vault} resolved this boot
 * @returns {{refusals: Array<{key,was,now,files,text}>, roots: object}}
 */
export const checkRoots = (roots) => {
  const was = readLock();
  const refusals = [];
  for (const key of WATCHED) {
    const now = roots[key];
    if (typeof now !== 'string' || !now) continue;
    const files = { was: countFiles(was[key] ?? ''), now: countFiles(now) };
    const { refuse } = assessRoot(was[key] ?? null, now, files);
    if (refuse) refusals.push({ key, was: was[key], now, files, text: refusalText(key, was[key], now, files) });
  }
  return { refusals, roots };
};

/**
 * impure — the boot gate. Refuses loudly, or records the roots and returns.
 *
 * @param {Record<string,string>} roots
 * @param {{log: object, exit?: Function}} io
 * @returns {boolean} true when the boot may continue
 */
export const enforceRootLock = (roots, { log, exit = (c) => process.exit(c) }) => {
  const { refusals } = checkRoots(roots);
  if (refusals.length) {
    for (const r of refusals) log.error(`ROOT LOCK — ${r.text}`, { root: r.key, was: r.was, now: r.now, files: r.files });
    exit(1);
    return false;
  }
  // Only a boot that got this far is worth remembering.
  writeLock(roots);
  return true;
};
