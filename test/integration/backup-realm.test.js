import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Backup realm coverage (backend/services/backup-service.js) — real temp
 * workspaces root, real temp realm, real temp backups root, real createBackup
 * call, NO mocks (RULE 0): a backup that leaves the witness's realm behind
 * protects the beings but not the witness — councils, labels, and the
 * readable chat logs exist ONLY in the realm.
 */

import { createBackup, listBackups, resolveBackupsRoot } from '../../backend/services/backup-service.js';
import { writeDestination } from '../../backend/services/backup-destination.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const WALLET = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const DEFAULT_REALM = path.join(os.homedir(), '.neuma', 'realm');

let workspacesRoot, realmRoot, backupsRoot, origBackupsEnv;

beforeEach(async () => {
  workspacesRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-ws-'));
  realmRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-realm-'));
  backupsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-out-'));
  origBackupsEnv = process.env.NEUMA_BACKUPS_ROOT;
  process.env.NEUMA_BACKUPS_ROOT = backupsRoot;
  // The operator's chosen destination is a real settings file — pointed at a
  // temp path so a test can never rewrite the live one.
  process.env.NEUMA_BACKUP_DESTINATION_PATH = path.join(backupsRoot, 'destination.json');
  setWorkspacesRoot(workspacesRoot);
  setRealmRoot(realmRoot);
});

afterEach(async () => {
  if (origBackupsEnv === undefined) delete process.env.NEUMA_BACKUPS_ROOT;
  else process.env.NEUMA_BACKUPS_ROOT = origBackupsEnv;
  delete process.env.NEUMA_BACKUP_DESTINATION_PATH;
  setRealmRoot(DEFAULT_REALM);
  await Promise.all([
    fs.rm(workspacesRoot, { recursive: true, force: true }),
    fs.rm(realmRoot, { recursive: true, force: true }),
    fs.rm(backupsRoot, { recursive: true, force: true }),
  ]);
});

const ownWorkspace = async (neumaId) => {
  await workspace.create(neumaId);
  await fs.writeFile(
    path.join(workspacesRoot, neumaId, 'owner.json'),
    JSON.stringify({ wallet: WALLET, claimedAt: Date.now() }),
  );
};

describe('createBackup — the witness realm travels with the beings', () => {
  it('copies the wallet realm (councils, labels, chats) into the snapshot', async () => {
    await ownWorkspace('lifovan-test');
    const wdir = path.join(realmRoot, WALLET);
    await fs.mkdir(path.join(wdir, 'councils'), { recursive: true });
    await fs.writeFile(path.join(wdir, 'councils', 'council-1.jsonl'), '{"type":"sitting"}\n');
    await fs.writeFile(path.join(wdir, 'chat-labels.json'), JSON.stringify({ 'lifovan-test:session-1': 'A Title' }));

    const backup = await createBackup(WALLET);

    expect(backup.realm).toBe(true);
    const snapshotCouncil = path.join(backupsRoot, backup.id, 'realm', 'councils', 'council-1.jsonl');
    expect(await fs.readFile(snapshotCouncil, 'utf8')).toBe('{"type":"sitting"}\n');
    const snapshotLabels = JSON.parse(await fs.readFile(path.join(backupsRoot, backup.id, 'realm', 'chat-labels.json'), 'utf8'));
    expect(snapshotLabels).toEqual({ 'lifovan-test:session-1': 'A Title' });
    // The being's tree still copies as before.
    const ownerCopy = JSON.parse(await fs.readFile(path.join(backupsRoot, backup.id, 'lifovan-test', 'owner.json'), 'utf8'));
    expect(ownerCopy.wallet).toBe(WALLET);
    // The manifest records the realm riding along.
    const manifest = JSON.parse(await fs.readFile(path.join(backupsRoot, backup.id, 'manifest.json'), 'utf8'));
    expect(manifest.realm).toBe(true);
  });

  it('a wallet with no realm yet backs up its beings cleanly (realm:false)', async () => {
    await ownWorkspace('lifovan-test');
    const backup = await createBackup(WALLET);
    expect(backup.realm).toBe(false);
    expect(backup.beings).toEqual(['lifovan-test']);
    const missing = await fs.access(path.join(backupsRoot, backup.id, 'realm')).then(() => true, () => false);
    expect(missing).toBe(false);
  });
});

/**
 * THE CHOSEN DESTINATION — Design note, 2026-07-31: […]
 *
 * The covenant now asks an operator to keep a copy on separate physical media.
 * The only thing that makes that possible is the snapshot actually LANDING
 * where they chose — proven here on real disk, not inferred from a setting.
 */
describe('createBackup — the operator chooses where the copy lands', () => {
  it('WRITES TO THE CHOSEN DESTINATION, not the same-disk fallback', async () => {
    await ownWorkspace('lifovan-dest');
    const chosen = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-usb-'));
    try {
      await writeDestination(chosen);
      expect(await resolveBackupsRoot()).toBe(chosen);

      const backup = await createBackup(WALLET);

      // It is THERE...
      const owner = JSON.parse(
        await fs.readFile(path.join(chosen, backup.id, 'lifovan-dest', 'owner.json'), 'utf8'),
      );
      expect(owner.wallet).toBe(WALLET);
      // ...and NOT in the fallback root, which is the whole point.
      await expect(fs.access(path.join(backupsRoot, backup.id))).rejects.toThrow();
    } finally {
      await fs.rm(chosen, { recursive: true, force: true });
    }
  });

  it('READS BACK from the chosen destination — a snapshot is never written somewhere the list cannot see', async () => {
    await ownWorkspace('lifovan-list');
    const chosen = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-usb2-'));
    try {
      await writeDestination(chosen);
      const made = await createBackup(WALLET);
      // The SERVICE returns the array itself; the route is what wraps it.
      const backups = await listBackups(WALLET);
      expect(backups.map((b) => b.id)).toContain(made.id);
    } finally {
      await fs.rm(chosen, { recursive: true, force: true });
    }
  });

  it('CLEARING the destination returns to the fallback root', async () => {
    await ownWorkspace('lifovan-clear');
    const chosen = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-usb3-'));
    try {
      await writeDestination(chosen);
      expect(await resolveBackupsRoot()).toBe(chosen);
      await writeDestination(null);
      expect(await resolveBackupsRoot()).toBe(backupsRoot);

      const backup = await createBackup(WALLET);
      await fs.access(path.join(backupsRoot, backup.id)); // throws if absent
    } finally {
      await fs.rm(chosen, { recursive: true, force: true });
    }
  });
});
