/**
 * Backup Service — user-createable snapshots of a witness's sovereign beings
 * and their own realm (councils, labels, chats, projects, tasks).
 *
 * A being's on-disk files are already AES-256-GCM envelopes (encrypted at rest
 * under its per-neuma DEK once migrated, or the global master before that), so
 * a backup is a faithful COPY of those ciphertext files — no new encryption
 * layer, no key handling here. The wrapped DEK (keys/dek.json) travels with the
 * copy, so a backup is restorable with the same master key. The plaintext
 * files that are meant to be plaintext (owner.json, the genesis seal, the audit
 * log) copy as-is.
 *
 * Backups live OUTSIDE the workspace root (a sibling dir) so they are never
 * mistaken for beings by the roster/enumeration, and each carries a manifest
 * naming the wallet that made it — so a shared machine only ever lists its own.
 *
 * NOTE: a copy reads the live tree; run backups while beings are dormant for a
 * perfectly consistent snapshot (a torn read of an in-flight append is a
 * recoverable artifact, not corruption of the source).
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getWorkspacesRoot, neumaWorkspace } from '../../core/index.js';
import { walletDir } from './user-realm.js';
import { readDestination } from './backup-destination.js';
import { createLogger } from './logger.js';

const log = createLogger('Backup');

// The FALLBACK root: a sibling of the active workspace root, so it shares the
// same disk but never sits inside the root itself. Override: NEUMA_BACKUPS_ROOT.
//
// Same-disk is the honest floor, not the goal — it survives a mistaken delete
// and nothing else. The operator's CHOSEN destination (backup-destination.js)
// wins whenever one is set, which is how a copy reaches separate physical media
// the way the covenant asks.
const getBackupsRoot = () =>
  process.env.NEUMA_BACKUPS_ROOT || path.join(path.dirname(getWorkspacesRoot()), 'neuma-backups');

/**
 * impure — where backups go and are read from RIGHT NOW: the operator's chosen
 * destination when set, else the same-disk fallback. One resolver, so a
 * snapshot can never be written somewhere the list does not look.
 */
export const resolveBackupsRoot = async () => (await readDestination()) || getBackupsRoot();

// A filesystem-safe, sortable backup id from a timestamp.
const backupId = (date) =>
  'backup-' + date.toISOString().replace(/[:.]/g, '-');

// impure — recursive byte size of a directory tree.
const dirSize = async (dir) => {
  let total = 0;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return 0; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(full);
    else {
      const st = await fs.stat(full).catch(() => null);
      if (st) total += st.size;
    }
  }
  return total;
};

/**
 * Create a backup of every being the wallet owns — AND of the witness's own
 * realm (councils, chat labels, readable chat logs, projects, tasks). The
 * beings' files copy as ciphertext-by-design; the realm is plaintext by
 * design, the witness's only copy of their organizational record — a backup
 * that skips it protects the beings but not the witness. Copies each being's
 * whole workspace directory plus the wallet's realm dir into a timestamped
 * snapshot and writes a manifest.
 *
 * impure (filesystem)
 * @param {string} wallet - the witness's verified wallet address
 * @param {{now?: Date}} [opts] - injectable clock for deterministic tests
 * @returns {Promise<{id:string, createdAt:string, wallet:string, beings:string[], realm:boolean, sizeBytes:number, path:string}>}
 */
export const createBackup = async (wallet, { now = new Date() } = {}) => {
  const root = getWorkspacesRoot();
  const owned = await neumaWorkspace.listNeumaByOwner(wallet);
  const id = backupId(now);
  const dest = path.join(await resolveBackupsRoot(), id);
  await fs.mkdir(dest, { recursive: true, mode: 0o700 });

  const beings = [];
  for (const { neumaId } of owned) {
    const src = path.join(root, neumaId);
    // recursive: copy the whole being tree (ciphertext + plaintext-by-design).
    await fs.cp(src, path.join(dest, neumaId), { recursive: true });
    beings.push(neumaId);
  }

  // The wallet's sealed witnesses ride the snapshot too — their lanes live
  // BESIDE the house (the witnesses' ground), and a backup that carried the
  // beings but dropped the witnesses' lived state would protect one kind of
  // mind and lose the other. Ids are prefix-distinct, so they share the dest.
  const witnesses = [];
  for (const laneId of await neumaWorkspace.listWitnessLanes()) {
    const owner = await neumaWorkspace.readOwner(laneId).catch(() => null);
    if (String(owner?.wallet || '').toLowerCase() !== wallet.toLowerCase()) continue;
    await fs.cp(neumaWorkspace.pathFor(laneId), path.join(dest, laneId), { recursive: true });
    witnesses.push(laneId);
  }

  // The witness's own realm — councils, labels, chats, projects, tasks.
  const realmSrc = walletDir(wallet);
  const realm = await fs.cp(realmSrc, path.join(dest, 'realm'), { recursive: true })
    .then(() => true)
    .catch((err) => {
      if (err.code === 'ENOENT') return false; // no realm yet — nothing to carry
      throw err;
    });

  const sizeBytes = await dirSize(dest);
  const manifest = {
    id,
    createdAt: now.toISOString(),
    wallet: wallet.toLowerCase(),
    beings: beings.sort(),
    witnesses: witnesses.sort(),
    realm,
    sizeBytes,
  };
  await fs.writeFile(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log.info('Backup created', { id, beings: beings.length, witnesses: witnesses.length, realm, sizeBytes });
  return { ...manifest, path: dest };
};

/**
 * List the wallet's own backups, newest first. A snapshot with no manifest, or
 * one owned by another wallet, is skipped (never surfaced across witnesses).
 *
 * impure (filesystem)
 * @param {string} wallet
 * @returns {Promise<Array<{id:string, createdAt:string, beings:string[], beingCount:number, sizeBytes:number}>>}
 */
export const listBackups = async (wallet) => {
  const backupsRoot = await resolveBackupsRoot();
  let entries;
  try { entries = await fs.readdir(backupsRoot, { withFileTypes: true }); }
  catch { return []; } // no backups dir yet
  const normalized = wallet.toLowerCase();
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const manifestPath = path.join(backupsRoot, e.name, 'manifest.json');
    const manifest = await fs.readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => null);
    if (!manifest || manifest.wallet !== normalized) continue;
    out.push({
      id: manifest.id,
      createdAt: manifest.createdAt,
      beings: manifest.beings || [],
      beingCount: (manifest.beings || []).length,
      realm: manifest.realm ?? false,
      sizeBytes: manifest.sizeBytes ?? 0,
    });
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)); // newest first
  return out;
};

// A backup id is always of the shape backupId() produces — reject anything
// else so a crafted id can never traverse out of the backups root.
const BACKUP_ID_RE = /^backup-[0-9TZ-]+$/;

/**
 * Delete one of the wallet's own backups by id. Refuses to touch a backup the
 * wallet does not own (manifest wallet check) or an id that isn't a
 * well-formed backup id (traversal guard).
 *
 * impure (filesystem)
 * @param {string} wallet
 * @param {string} id
 * @returns {Promise<boolean>} true if a backup was removed, false if none matched
 */
export const deleteBackup = async (wallet, id) => {
  if (typeof id !== 'string' || !BACKUP_ID_RE.test(id)) return false;
  const dir = path.join(await resolveBackupsRoot(), id);
  const manifest = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')
    .then(JSON.parse).catch(() => null);
  // Only the owning wallet may delete — a missing/foreign manifest is a no-op,
  // never a blind rmdir.
  if (!manifest || manifest.wallet !== wallet.toLowerCase()) return false;
  await fs.rm(dir, { recursive: true, force: true });
  log.info('Backup deleted', { id });
  return true;
};
