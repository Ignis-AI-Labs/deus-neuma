/**
 * THE HOUSE'S OFFICE RECORDS TRAVEL SEALED (backend/services/backup-seal.js, backup-service.js; docs/work/
 * crm-match-blob.md, 2026-11-23). A backup goes to whatever drive the operator chose; the offices hold other people's
 * data (leads and their words, deals, invoices), so they travel as AES-256-GCM envelopes under the master key. The
 * rest of the realm copies as before. `neuma backup open` opens them, byte for byte; a sealed file moved into
 * another backup, or opened under another key, does not open. Real temp roots, the real createBackup (RULE 0).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import process from 'node:process';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { createBackup } from '../../backend/services/backup-service.js';
import { openSealedTree, SEALED_DIR } from '../../backend/services/backup-seal.js';
import { setRealmRoot, getRealmRoot } from '../../backend/services/user-realm.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { openedWords } from '../../cli/commands/backup.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';

const WALLET = '0xcccccccccccccccccccccccccccccccccccccccc';
const LEADS = JSON.stringify([{ id: 'l1', name: 'Ana Ruiz', contact: 'ana@studio.example', touches: [{ text: 'Yes, send the deck' }] }]);
let root; let priorRealm; let priorWs; let priorKey;

beforeEach(async () => {
  root = await createTempDir('backup-seal');
  priorRealm = getRealmRoot(); priorWs = getWorkspacesRoot(); priorKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = 'backup-seal-test-master-key-32-chars!';
  resetWorkspaceCryptoKey();
  process.env.NEUMA_BACKUPS_ROOT = path.join(root, 'backups');
  process.env.NEUMA_BACKUP_DESTINATION_PATH = path.join(root, 'destination.json');
  setWorkspacesRoot(path.join(root, 'ws'));
  setRealmRoot(path.join(root, 'realm'));
  const house = path.join(root, 'realm', WALLET);
  await fs.mkdir(path.join(house, 'offices', 'marketing'), { recursive: true });
  await fs.mkdir(path.join(house, 'offices', 'revenue'), { recursive: true });
  await fs.mkdir(path.join(house, 'councils'), { recursive: true });
  await fs.writeFile(path.join(house, 'offices', 'marketing', 'lead-ledger.json'), LEADS);
  await fs.writeFile(path.join(house, 'offices', 'revenue', 'deals.jsonl'), '{"type":"opened","deal":{"buyer":"Ana Ruiz"}}\n');
  await fs.writeFile(path.join(house, 'councils', 'c1.json'), '{"name":"my council"}');
});
afterEach(async () => {
  setRealmRoot(priorRealm); setWorkspacesRoot(priorWs);
  if (priorKey === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = priorKey;
  resetWorkspaceCryptoKey();
  delete process.env.NEUMA_BACKUPS_ROOT; delete process.env.NEUMA_BACKUP_DESTINATION_PATH;
  await fs.rm(root, { recursive: true, force: true });
});

// every file under a folder, its text
const texts = async (dir) => {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) out.push(await fs.readFile(path.join(e.parentPath ?? e.path, e.name), 'utf8'));
  return out.join('\n');
};

describe('a backup seals the house\'s office records', () => {
  it('the offices travel sealed, the rest of the realm as before; nothing of a lead reads in the backup', async () => {
    const backup = await createBackup(WALLET, { now: new Date('2026-11-23T05:00:00Z') });
    expect(backup).toMatchObject({ realm: true, officesSealed: 2 });
    await expect(fs.access(path.join(backup.path, 'realm', 'offices'))).rejects.toThrow();
    expect(await fs.readFile(path.join(backup.path, 'realm', 'councils', 'c1.json'), 'utf8')).toBe('{"name":"my council"}');
    const all = await texts(backup.path);
    expect(all).not.toMatch(/Ana Ruiz|ana@studio|send the deck/);
    const sealed = path.join(backup.path, SEALED_DIR, 'marketing', 'lead-ledger.json.sealed');
    expect((await fs.stat(sealed)).mode & 0o777).toBe(0o600);
    // Opened, byte for byte.
    const out = path.join(root, 'opened');
    const opened = await openSealedTree(backup.path, out);
    expect(opened).toEqual({ opened: 2, failed: [] });
    expect(await fs.readFile(path.join(out, 'marketing', 'lead-ledger.json'), 'utf8')).toBe(LEADS);
    expect(openedWords(opened, out)).toBe(`2 office records opened into ${out}`);
  });

  it('a sealed file moved into another backup does not open, nor one opened under another key', async () => {
    const first = await createBackup(WALLET, { now: new Date('2026-11-23T05:00:00Z') });
    const second = await createBackup(WALLET, { now: new Date('2026-11-23T06:00:00Z') });
    // first's lead list, put where second's was
    await fs.copyFile(path.join(first.path, SEALED_DIR, 'marketing', 'lead-ledger.json.sealed'), path.join(second.path, SEALED_DIR, 'marketing', 'lead-ledger.json.sealed'));
    const moved = await openSealedTree(second.path, path.join(root, 'moved'));
    expect(moved.opened).toBe(1);
    expect(moved.failed).toEqual([expect.stringMatching(/^marketing\/lead-ledger\.json: /)]);
    process.env.DNA_ENCRYPTION_KEY = 'another-master-key-entirely-32-chars!';
    resetWorkspaceCryptoKey();
    const wrong = await openSealedTree(first.path, path.join(root, 'wrong'));
    expect(wrong).toMatchObject({ opened: 0 });
    expect(wrong.failed).toHaveLength(2);
    expect(openedWords(wrong, 'x')).toMatch(/^0 office records opened into x\n2 did not open/);
  });
});
