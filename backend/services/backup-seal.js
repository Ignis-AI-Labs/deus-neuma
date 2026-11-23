/**
 * BACKUP SEAL — the house's office records (the CRM: leads and what they wrote, the outbox, research, deals,
 * invoices) travel in a backup SEALED, one AES-256-GCM envelope a file under the install's master key, the key the
 * beings' own files already travel under (docs/work/crm-match-blob.md, 2026-11-23: a backup goes to whatever drive
 * the operator chose, and these records are other people's data). The rest of the realm copies as it always has.
 *
 * Each sealed file is `<its path>.sealed`, an envelope of {path, data} bound (AAD) to the backup that sealed it, so a
 * sealed file moved into another backup, or renamed, does not open. `neuma backup open` opens a backup's seal into a
 * folder, on any computer holding the same master key (backup-open in cli/commands/backup.js).
 * impure (fs, crypto).
 */
import { promises as fs } from 'fs';
import path from 'path';
import { encryptEnvelope, decryptEnvelope } from '../../core/workspace/workspace-crypto.js';

export const SEALED_DIR = 'realm-offices.sealed';
const SUFFIX = '.sealed';

// The envelope's bound context (workspace-envelope-aad.js): what it is, the house and backup it belongs to, its path.
const aadOf = ({ wallet, id }, rel) => ({ purpose: 'house-offices-backup', laneId: `${String(wallet).toLowerCase()}/${id}`, file: rel.split(path.sep).join('/'), seq: 0 });

// impure — every file under a folder, as paths relative to it (folders walked, links never followed).
const filesUnder = async (root, rel = '') => {
  const out = [];
  for (const e of await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])) {
    const child = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...await filesUnder(root, child));
    else if (e.isFile()) out.push(child);
  }
  return out;
};

/**
 * Seal every file under `src` into `dest` (0700 folders, 0600 files). impure.
 * @param {string} src @param {string} dest
 * @param {{wallet: string, id: string}} backup - the backup the seal is bound to
 * @returns {Promise<number>} how many files were sealed
 */
export const sealTree = async (src, dest, backup) => {
  const files = await filesUnder(src);
  for (const rel of files) {
    const data = await fs.readFile(path.join(src, rel));
    const envelope = encryptEnvelope({ path: rel, data: data.toString('base64') }, { compress: true, aad: aadOf(backup, rel) });
    const target = path.join(dest, `${rel}${SUFFIX}`);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, JSON.stringify(envelope), { mode: 0o600 });
  }
  return files.length;
};

/**
 * Open a backup's sealed office records into `out` — on any computer holding the master key that sealed them. A file
 * that does not open (another key, a file moved from another backup) is named, never skipped silently. impure.
 * @param {string} backupDir - the backup's folder (it holds manifest.json)
 * @param {string} out - a folder to write the opened records into (made 0700)
 * @returns {Promise<{opened: number, failed: string[]}>}
 */
export const openSealedTree = async (backupDir, out) => {
  const manifest = JSON.parse(await fs.readFile(path.join(backupDir, 'manifest.json'), 'utf8'));
  const root = path.join(backupDir, SEALED_DIR);
  let opened = 0;
  const failed = [];
  for (const sealed of (await filesUnder(root)).filter((f) => f.endsWith(SUFFIX))) {
    const rel = sealed.slice(0, -SUFFIX.length);
    try {
      const { path: inside, data } = decryptEnvelope(JSON.parse(await fs.readFile(path.join(root, sealed), 'utf8')), { aad: aadOf(manifest, rel) });
      if (inside !== rel) throw new Error('the sealed file names another path');
      const target = path.resolve(out, rel);
      if (!target.startsWith(path.resolve(out) + path.sep)) throw new Error('a path outside the folder');
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, Buffer.from(data, 'base64'), { mode: 0o600 });
      opened += 1;
    } catch (err) {
      failed.push(`${rel}: ${err.message}`);
    }
  }
  return { opened, failed };
};
