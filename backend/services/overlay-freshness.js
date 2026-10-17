// impure: conservative lower/upper conflict detection, never overlay cleanup.
import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'node:module';
import { writeJsonAtomic } from './user-realm.js';
import { isCredentialSource } from './secret-path-classifier.js';
import { createLogger } from './logger.js';

const log = createLogger('OverlayFreshness');

// Under the Electron binary (the desk spawns `electron backend/server.js`) the fs module
// is ASAR-PATCHED: an .asar archive stats as a directory with synthetic per-process inodes
// and no bigint timestamps, and readdir walks INTO it. A lower inventory taken through that
// patch records archive contents instead of the real file — and the next boot's different
// synthetic inodes read as drift: a permanent freshness conflict over node_modules
// (Tenekom's sovereign ground burned 19 recovery generations on it, CQ-907 / #527).
// `original-fs` is Electron's unpatched original; under plain node (house server, tests)
// it does not exist and the fallback is byte-identical to before.
const fsReal = (() => {
  try { return createRequire(import.meta.url)('original-fs').promises; }
  catch { return fs; }
})();

const LIMIT = 400_000;
const locks = new Set();
const manifestFor = (workspace) => path.join(path.dirname(workspace), 'lower-baseline.json');
export const overlayConflict = (detail) => Object.assign(new Error(`Overlay freshness conflict: ${detail}. Shell work is preserved. Use coding/sandbox_recover to request an approved fresh shell without deleting prior work.`), { code: 'OVERLAY_CONFLICT' });
const conflict = overlayConflict;

// Metadata only: inode/ctime catches same-sized atomic replacements and edits.
// No file content or dependency contents are hashed/read. Symlinks are not followed.
const signature = (stat) => [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');

// A signature containing the literal 'undefined' can never come from fsReal — it is the
// asar patch's fingerprint (CQ-907). Baselines carrying it never described reality.
const POISON = /(^|:)undefined(:|$)/;
const rootPoisoned = (rows) => Object.values(rows).some((sig) => sig !== null && POISON.test(sig));

// Re-inventory every baseline root the asar patch poisoned, in place in the manifest.
// The upper's preserved work is untouched — only the provably-unreal lower record is
// rebuilt, once, loudly. impure.
const repairPoisonedRoots = async (baseline, workspace) => {
  const poisoned = Object.keys(baseline.roots).filter((name) => rootPoisoned(baseline.roots[name]));
  if (!poisoned.length) return baseline;
  const roots = { ...baseline.roots };
  for (const name of poisoned) {
    roots[name] = await inventory(path.join(baseline.sourceRoot, name), baseline.excluded);
  }
  const repaired = { ...baseline, roots };
  await writeJsonAtomic(manifestFor(workspace), repaired);
  log.warn('repaired asar-poisoned lower baseline', { roots: poisoned });
  return repaired;
};

const inventory = async (root, excluded = []) => {
  const rows = Object.create(null);
  const queue = [''];
  let visited = 0;
  while (queue.length) {
    const relative = queue.pop();
    if (++visited > LIMIT) throw conflict('lower metadata exceeds the safety bound');
    const full = path.join(root, relative);
    if (excluded.some((entry) => full === entry || full.startsWith(entry + path.sep))) continue;
    const stat = await fsReal.lstat(full, { bigint: true }).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) { rows[relative] = null; continue; }
    rows[relative] = signature(stat);
    if (stat.isDirectory()) {
      const names = await fsReal.readdir(full);
      queue.push(...names.map((name) => path.join(relative, name)));
    }
  }
  return rows;
};

const readBaseline = async (workspace) => {
  try { return JSON.parse(await fs.readFile(manifestFor(workspace), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw conflict(`baseline unreadable (${error.message})`);
  }
};

/** Establish provenance ONLY for an empty upper; legacy work is never adopted. impure. */
export const prepareOverlayFreshness = async ({ workspace, sourceRoot, masks }) => {
  let baseline = await readBaseline(workspace);
  const excluded = [...(masks?.dirs || []), ...(masks?.files || [])].sort();
  if (baseline) {
    if (baseline.version !== 1 || baseline.sourceRoot !== sourceRoot || !baseline.roots) {
      throw conflict('unknown baseline format or different lower ground');
    }
    baseline = await repairPoisonedRoots(baseline, workspace);
    if (JSON.stringify(baseline.excluded || []) === JSON.stringify(excluded)) return;
    const removed = (baseline.excluded || []).filter((entry) => !excluded.includes(entry));
    const added = excluded.filter((entry) => !(baseline.excluded || []).includes(entry));
    // Upgrade the old credential-module mask without discarding unrelated dist
    // output. Only unshadowed source roots can acquire a new lower baseline.
    if (!added.length && removed.length && removed.every(isCredentialSource)) {
      const affected = [...new Set(removed.map((entry) => path.relative(sourceRoot, entry).split(path.sep)[0]))];
      const upper = await fs.readdir(workspace);
      if (affected.every((name) => name && name !== '..' && !upper.includes(name))) {
        const roots = { ...baseline.roots };
        for (const name of affected) roots[name] = await inventory(path.join(sourceRoot, name), excluded);
        await writeJsonAtomic(manifestFor(workspace), { ...baseline, roots, excluded });
        return;
      }
    }
    if ((await fs.readdir(workspace)).length) throw conflict('mask reach changed over preserved upper work');
  }
  if ((await fs.readdir(workspace)).length) throw conflict('nonempty legacy upper has no known lower baseline');
  const roots = Object.create(null);
  for (const name of await fs.readdir(sourceRoot)) roots[name] = await inventory(path.join(sourceRoot, name), excluded);
  // A competing process or interrupted migration may not silently adopt work.
  if ((await fs.readdir(workspace)).length) throw conflict('upper changed while establishing provenance');
  await writeJsonAtomic(manifestFor(workspace), { version: 1, sourceRoot, roots, excluded });
};

/** Check only lower subtrees shadowed by top-level upper entries (incl. whiteouts).
 * Directory shadows conservatively cover their subtree, including opaque dirs.
 * This stats dependencies only when an upper dependency tree actually exists.
 * It never refreshes the baseline over unharvested work. impure. */
export const assertOverlayFresh = async ({ workspace, sourceRoot }) => {
  let baseline = await readBaseline(workspace);
  if (baseline?.version !== 1 || baseline.sourceRoot !== sourceRoot || !baseline.roots) {
    throw conflict('missing or invalid lower baseline');
  }
  baseline = await repairPoisonedRoots(baseline, workspace);
  for (const name of await fs.readdir(workspace)) {
    const current = await inventory(path.join(sourceRoot, name), baseline.excluded);
    const prior = Object.hasOwn(baseline.roots, name) ? baseline.roots[name] : { '': null };
    const names = new Set([...Object.keys(current), ...Object.keys(prior)]);
    if ([...names].some((key) => current[key] !== prior[key])) {
      throw conflict(`live lower changed beneath upper shadow ${JSON.stringify(name)}`);
    }
  }
};

/** Exclusive process lifetime for a persistent upper; stale locks fail closed.
 * No stale-lock removal: an operator must confirm no surviving mount owns it.
 * impure. */
export const lockOverlay = async (workspace, { directory } = {}) => {
  const key = path.resolve(directory || path.dirname(workspace));
  if (locks.has(key)) throw conflict('another command owns this upper');
  locks.add(key);
  const lockPath = path.join(key, 'command.lock');
  let handle;
  try { handle = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) {
    locks.delete(key);
    if (error.code === 'EEXIST') throw conflict('command lock exists; a running or interrupted process needs operator inspection');
    throw error;
  }
  return async () => {
    try {
      const owned = await handle.stat();
      const current = await fs.lstat(lockPath);
      if (!current.isFile() || current.dev !== owned.dev || current.ino !== owned.ino) throw conflict('shell lock was replaced');
      await fs.unlink(lockPath);
    } finally { try { await handle.close(); } finally { locks.delete(key); } }
  };
};
