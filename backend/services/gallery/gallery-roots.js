/**
 * THE GALLERY's ROOTS — the allowlist that is the whole of its reach.
 *
 * Design note, 2026-08-01: […]
 *
 * ADDING A FOLDER IS THE GRANT. The gallery can list and serve bytes from a
 * root on this list and from nowhere else — there is no path parameter that
 * reaches outside it, and every served path is realpath-resolved and re-checked
 * against its root, so a symlink planted inside an allowed folder cannot walk
 * out of it. This is the operator's surface only; no being tool reads it.
 *
 * One root is BUILT-IN: ComfyUI's own output directory, so every render — the
 * beings' and the operator's own workbench sessions alike — is in the gallery
 * the moment it lands, with nothing to configure. It cannot be removed, only
 * hidden, because removing it would be removing the gallery's whole reason to
 * exist on a fresh install.
 */
import { getDataRoot } from '../data-root.js';
import crypto from 'crypto';
import path from 'path';
import { promises as fs, existsSync } from 'fs';
import { createLogger } from '../logger.js';
import { writeJsonAtomic } from '../user-realm.js';

const log = createLogger('Gallery.Roots');

/** Where the operator's added roots persist. */
const rootsPath = (env = process.env) =>
  env.NEUMA_GALLERY_ROOTS_PATH || path.join(getDataRoot(), 'settings', 'gallery-roots.json');

/** The built-in root's stable id. */
export const COMFY_ROOT_ID = 'comfy-output';

/**
 * The roots that exist without the operator adding anything. Pure given a
 * resolved comfy config.
 * @param {{outputDir: string}} comfyCfg
 * @returns {Array<{id, label, dir, builtIn: true}>}
 */
export const builtInRoots = (comfyCfg) => {
  if (!comfyCfg?.outputDir) return [];
  return [Object.freeze({
    id: COMFY_ROOT_ID,
    label: 'COMFY RENDERS',
    dir: comfyCfg.outputDir,
    builtIn: true,
  })];
};

/**
 * A folder's root id: the full folder path, hashed (sha256, 16 bytes shown).
 * The old id was the path's first 22 base64url characters — every folder
 * sharing a 16-byte prefix shared an id. Stored rows keep the id they were
 * written with, so an old id still resolves. Pure.
 * @param {string} resolvedDir
 * @returns {string}
 */
export const rootIdOf = (resolvedDir) =>
  `root-${crypto.createHash('sha256').update(resolvedDir).digest('hex').slice(0, 32)}`;

/**
 * Fold an add/remove onto the stored root list. PURE — so the dedupe and
 * built-in-protection rules are testable without a disk.
 *
 * Dedupe is by resolved dir: adding the same folder twice is a no-op rather
 * than a second row that scans the same files again.
 *
 * @param {Array<object>} roots current stored (operator-added) roots
 * @param {{op: 'add'|'remove', id?: string, dir?: string, label?: string}} change
 * @returns {{ok: boolean, roots: Array<object>, error?: string}}
 */
export const applyRootChange = (roots, change) => {
  const list = Array.isArray(roots) ? roots : [];
  if (change?.op === 'add') {
    const dir = String(change.dir || '');
    if (!dir || !path.isAbsolute(dir)) return { ok: false, roots: list, error: 'a root must be an absolute path' };
    const resolved = path.resolve(dir);
    if (list.some((r) => path.resolve(r.dir) === resolved)) return { ok: true, roots: list };
    return {
      ok: true,
      roots: [...list, {
        id: rootIdOf(resolved),
        label: String(change.label || path.basename(resolved) || resolved).slice(0, 60),
        dir: resolved,
      }],
    };
  }
  if (change?.op === 'remove') {
    if (change.id === COMFY_ROOT_ID) {
      return { ok: false, roots: list, error: 'the ComfyUI output root is built in and cannot be removed' };
    }
    return { ok: true, roots: list.filter((r) => r.id !== change.id) };
  }
  return { ok: false, roots: list, error: 'unknown root operation' };
};

// impure — read the operator's stored roots. A missing or unreadable file means
// "none added yet", never an error: the built-in root still gives a working
// gallery, and refusing to open the gallery over a bad settings file would be
// worse than showing the renders.
export const readStoredRoots = async (env = process.env) => {
  try {
    const raw = await fs.readFile(rootsPath(env), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.roots) ? parsed.roots : [];
  } catch (err) {
    if (err.code !== 'ENOENT') log.warn('gallery roots unreadable — treating as empty', { err: err.message });
    return [];
  }
};

// impure — persist through the SHARED atomic writer. gallery-roots.json lives in
// data/settings/ beside user-realm.json, so it is in the realm layer, whose law
// is that every whole-file JSON document goes through `writeJsonAtomic` — a
// plain writeFile on a whole-file store is a data-loss door. Reimplementing
// tmp+rename here was crash-safe but skipped the shared helper's temp-file
// cleanup on a failed write (echo r1, GLM).
export const writeStoredRoots = async (roots, env = process.env) =>
  writeJsonAtomic(rootsPath(env), { roots });

/**
 * Every root the gallery may reach right now: built-in first, then the
 * operator's. impure (reads the store).
 * @returns {Promise<Array<{id, label, dir, builtIn?: boolean}>>}
 */
export const allRoots = async (comfyCfg, wallet = null, env = process.env) =>
  [...builtInRoots(comfyCfg), ...(await beingArtRoots(wallet)), ...(await readStoredRoots(env))];

/**
 * One root per being that has made art — discovered, never configured.
 *
 * Design note, 2026-08-02: […] Because each being writes into its own
 * `art/` folder, the gallery's folder rail becomes the roster of who made what
 * without any bookkeeping: filtering to a being IS filtering to its folder.
 *
 * Discovered, so a newly born being needs no setup and a deleted one leaves no
 * dangling row. These roots are not stored and cannot be removed — they are a
 * view of the workspaces, not an operator grant. impure (reads the roster).
 * @returns {Promise<Array<{id, label, dir, being: true}>>}
 */
export const beingArtRoots = async (wallet) => {
  if (!wallet) return [];
  try {
    const { neumaWorkspace } = await import('../../../core/index.js');
    // Neuma are OWNERSHIP-SCOPED: the gallery shows the caller's own house,
    // never another wallet's beings. Witness lanes ride the same engine and
    // make art under the same doctrine ([…]), so they get rows too.
    const owned = await neumaWorkspace.listNeumaByOwner(wallet).catch(() => []);
    // Witness lanes must be owner-filtered TOO. `listWitnessLanes()` is a bare
    // readdir of the witnesses' ground with no wallet argument, so using it
    // unfiltered would have shown every witness on the machine to any
    // authenticated caller — contradicting the scoping this function claims
    // three lines up (echo r1, GLM + Grok). A witness lane carries its own
    // owner.json (first manifesting wallet claims), so it is filterable.
    const witnessLanes = await neumaWorkspace.listWitnessLanes().catch(() => []);
    const witnessOwned = [];
    for (const w of witnessLanes) {
      const id = typeof w === 'string' ? w : (w?.laneId || w?.neumaId);
      if (!id) continue;
      const owner = await neumaWorkspace.readOwner(id).catch(() => null);
      if (owner?.wallet && String(owner.wallet).toLowerCase() === String(wallet).toLowerCase()) {
        witnessOwned.push(id);
      }
    }
    const ids = [...owned.map((o) => o.neumaId), ...witnessOwned].filter(Boolean);

    const out = [];
    for (const id of [...new Set(ids)]) {
      // The whole `art/` tree, not just `art/images` — otherwise a being's
      // VIDEO would be invisible in the gallery even though the scanner
      // classifies video, which is precisely what the folder rail is for
      // (echo r1, raised by both lenses). One row per being; the KIND filter
      // separates images from video within it.
      let dir;
      try { dir = neumaWorkspace.artDir(id, null); } catch { continue; }
      // No art yet ⇒ no row. The rail is a record of who HAS made something,
      // not a list of empty folders.
      if (!existsSync(dir)) continue;
      const name = await neumaWorkspace.readTrueName(id).catch(() => null);
      out.push({
        id: `being-${id}`,
        label: (typeof name === 'string' ? name : name?.chosenName || name?.name) || id,
        dir,
        being: true,
      });
    }
    return out;
  } catch (err) {
    // A gallery that cannot enumerate beings still shows the comfy root and the
    // operator's own folders. Never fail the whole surface over this.
    log.warn('could not enumerate being art folders', { err: err.message });
    return [];
  }
};

/**
 * Resolve a root by id. Pure. Returns null for an unknown id — the callers
 * treat that as "no reach", which is what makes the allowlist load-bearing.
 */
export const rootById = (roots, id) => roots.find((r) => r.id === id) || null;
