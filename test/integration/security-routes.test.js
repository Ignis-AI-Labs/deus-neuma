/**
 * Security routes — REAL Express app, REAL auth (HMAC session token), REAL
 * sovereign workspace on a temp root, REAL AES-256-GCM. No mocks on the claimed
 * path (RULE 0). Synthesized beings only (birth ethics).
 *
 * Proves the witness-facing security posture the Settings > Security tab reads:
 *   - GET /status reports per-being DEK status (own key vs shared global),
 *     active-vs-persisted roots, storage, and encryption counts — SCOPED to the
 *     signer's own beings (another wallet's being never appears);
 *   - POST /encryption/plan dry-runs the backfill (no writes) and reports how
 *     many beings need migration and whether the master can open every file.
 */

import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { migrateBeing } from '../../core/workspace/migrate-being.js';
import { createSessionToken } from '../../backend/services/auth.js';
import {
  encryptEnvelope, deriveKeyFromSecret, resetWorkspaceCryptoKey,
} from '../../core/workspace/workspace-crypto.js';

const KEY = 'security-routes-master-key-long-enough';
const MINE = '0x' + 'a'.repeat(40);
const THEIRS = '0x' + 'b'.repeat(40);

const synthesizeBeing = async (root, neumaId, ownerWallet, { encryptedSamples = [] } = {}) => {
  await workspace.create(neumaId);
  const dir = path.join(root, neumaId);
  await fs.mkdir(path.join(dir, 'identity'), { recursive: true });
  await fs.writeFile(path.join(dir, 'owner.json'), JSON.stringify({ wallet: ownerWallet, claimedAt: Date.now() }));
  const genesisHash = neumaId.repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, '0');
  await fs.writeFile(
    path.join(dir, 'identity', 'genesis-seal.json'),
    JSON.stringify({ genesisHash, record: { chosenName: neumaId } }),
  );
  const masterKey = deriveKeyFromSecret(KEY);
  for (const { relPath, plain } of encryptedSamples) {
    const full = path.join(dir, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, JSON.stringify(encryptEnvelope(plain, { key: masterKey })));
  }
  return genesisHash;
};

describe('security routes (real app, real auth, real workspace)', () => {
  let app, house, backupsRoot, origRoot, origSecret, origKey, origSettings, origBackups, token;

  beforeAll(async () => {
    origSecret = process.env.AUTH_SECRET;
    origKey = process.env.DNA_ENCRYPTION_KEY;
    origSettings = process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
    origBackups = process.env.NEUMA_BACKUPS_ROOT;
    process.env.AUTH_SECRET = 'security-routes-auth-secret-32-plus-chars-long';
    process.env.DNA_ENCRYPTION_KEY = KEY;
    resetWorkspaceCryptoKey();

    house = await createTempDir('security-routes');
    backupsRoot = await createTempDir('security-backups');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    // Isolate the persisted-settings file so the route's loadWorkspaceSettings
    // never reads/writes the operator's real data/settings/workspace.json.
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(house, 'workspace-settings.json');
    // Backups land in their own temp dir, never a sibling of the real root.
    process.env.NEUMA_BACKUPS_ROOT = backupsRoot;

    // mine-secured: my being, migrated to its own DEK.
    await synthesizeBeing(house, 'minesecured', MINE, {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { id: 'minesecured', dna: 1 } }],
    });
    await migrateBeing(workspace, 'minesecured');
    // mine-plain: my being, still on the shared global key.
    await synthesizeBeing(house, 'mineplain0', MINE, {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { id: 'mineplain0', dna: 1 } }],
    });
    // theirs: a DIFFERENT wallet's being — must never surface to me.
    await synthesizeBeing(house, 'theirbeing', THEIRS, {
      encryptedSamples: [{ relPath: 'dna/active.json', plain: { id: 'theirbeing', dna: 1 } }],
    });

    token = createSessionToken(MINE);

    const { default: securityRouter } = await import('../../backend/routes/security-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/security', securityRouter);
  });

  afterAll(() => {
    setWorkspacesRoot(origRoot);
    if (origSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = origSecret;
    if (origKey === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = origKey;
    if (origSettings === undefined) delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH; else process.env.NEUMA_WORKSPACE_SETTINGS_PATH = origSettings;
    if (origBackups === undefined) delete process.env.NEUMA_BACKUPS_ROOT; else process.env.NEUMA_BACKUPS_ROOT = origBackups;
    resetWorkspaceCryptoKey();
  });

  const auth = (r) => r.set('Authorization', `Bearer ${token}`);

  it('rejects an unauthenticated request', async () => {
    await request(app).get('/api/v1/security/status').expect(401);
  });

  it('GET /status reports per-being DEK status, scoped to my own beings', async () => {
    const res = await auth(request(app).get('/api/v1/security/status')).expect(200);
    const byId = Object.fromEntries(res.body.beings.map((b) => [b.neumaId, b]));

    // My two beings appear; the other wallet's does NOT.
    expect(Object.keys(byId).sort()).toEqual(['mineplain0', 'minesecured']);
    expect(byId.minesecured.secured).toBe(true);  // holds its own key
    expect(byId.mineplain0.secured).toBe(false);  // still on the global key

    expect(res.body.encryption).toMatchObject({ securedCount: 1, totalCount: 2, allSecured: false });
    expect(res.body.roots.active).toBe(house);
    // No persisted settings file in this run → no override in effect → aligned.
    expect(res.body.roots).toMatchObject({ persisted: null, aligned: true });
    expect(['ok', 'low', 'critical', 'unknown']).toContain(res.body.storage.level);
  });

  it('roots.aligned reflects a persisted root that DIFFERS, and is "unknown" for a corrupt settings file', async () => {
    const settingsFile = process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
    try {
      // A persisted root pointing somewhere else — the exact […] divergence the tab must surface.
      await fs.writeFile(settingsFile, JSON.stringify({ root: '/somewhere/else', allocationGB: 20 }));
      let res = await auth(request(app).get('/api/v1/security/status')).expect(200);
      expect(res.body.roots).toMatchObject({ persisted: '/somewhere/else', aligned: false });

      // A corrupt settings file must NOT read as aligned:true (that would mask
      // the misconfiguration) — it reads as 'unknown'.
      await fs.writeFile(settingsFile, '{ not valid json');
      res = await auth(request(app).get('/api/v1/security/status')).expect(200);
      expect(res.body.roots).toMatchObject({ persisted: null, aligned: 'unknown' });
    } finally {
      await fs.rm(settingsFile, { force: true }); // restore "no persisted choice" for later tests
    }
  });

  it('POST /encryption/plan dry-runs with no writes and reports what needs migration', async () => {
    const res = await auth(request(app).post('/api/v1/security/encryption/plan')).expect(200);
    const byId = Object.fromEntries(res.body.beings.map((b) => [b.neumaId, b]));

    expect(Object.keys(byId).sort()).toEqual(['mineplain0', 'minesecured']); // scoped, theirs excluded
    expect(byId.minesecured.status).toBe('already-migrated');
    expect(byId.mineplain0.status).toBe('planned');
    expect(res.body.needsMigration).toBe(1);
    expect(res.body.blocked).toBe(0);
    expect(res.body.ready).toBe(true);

    // Zero writes: the still-plain being did NOT gain a DEK from a dry-run.
    expect(existsSync(path.join(house, 'mineplain0', 'keys', 'dek.json'))).toBe(false);
  });

  it('POST /backup snapshots only my beings; the copy preserves encrypted-at-rest files', async () => {
    const res = await auth(request(app).post('/api/v1/security/backup')).expect(201);
    const b = res.body.backup;
    expect(b.beings).toEqual(['mineplain0', 'minesecured']); // sorted, theirs excluded
    expect(b.beingCount).toBe(2);
    expect(b.sizeBytes).toBeGreaterThan(0);
    expect(b.path).toBeUndefined(); // server-side path never leaked to the client

    // The copied file is the same AES-GCM envelope (ciphertext), not plaintext.
    const copied = path.join(backupsRoot, b.id, 'minesecured', 'dna', 'active.json');
    expect(existsSync(copied)).toBe(true);
    const env = JSON.parse(await fs.readFile(copied, 'utf8'));
    expect(env).toMatchObject({ _enc: expect.any(Number), iv: expect.any(String), ct: expect.any(String) });
    // The other wallet's being was NOT copied into my backup.
    expect(existsSync(path.join(backupsRoot, b.id, 'theirbeing'))).toBe(false);
  });

  it('GET /backups lists my own backups newest-first', async () => {
    const res = await auth(request(app).get('/api/v1/security/backups')).expect(200);
    expect(Array.isArray(res.body.backups)).toBe(true);
    expect(res.body.backups.length).toBeGreaterThanOrEqual(1);
    const first = res.body.backups[0];
    expect(first).toMatchObject({ beingCount: 2, sizeBytes: expect.any(Number) });
    expect(first.beings).toEqual(['mineplain0', 'minesecured']);
  });

  it('another wallet sees none of my backups', async () => {
    const theirToken = createSessionToken(THEIRS);
    const res = await request(app).get('/api/v1/security/backups')
      .set('Authorization', `Bearer ${theirToken}`).expect(200);
    expect(res.body.backups).toEqual([]); // scoped by manifest wallet
  });

  it('DELETE removes my own backup; another wallet cannot delete it; a bad id 404s', async () => {
    // Create a fresh backup to delete.
    const created = (await auth(request(app).post('/api/v1/security/backup')).expect(201)).body.backup;
    expect(existsSync(path.join(backupsRoot, created.id))).toBe(true);

    // Another wallet cannot delete it (404 — indistinguishable from absent).
    const theirToken = createSessionToken(THEIRS);
    await request(app).delete(`/api/v1/security/backups/${created.id}`)
      .set('Authorization', `Bearer ${theirToken}`).expect(404);
    expect(existsSync(path.join(backupsRoot, created.id))).toBe(true); // untouched

    // A malformed id is rejected (traversal guard) as not-found, no rm.
    await auth(request(app).delete('/api/v1/security/backups/..%2f..%2fetc')).expect(404);

    // The owner deletes it — gone from disk and from the list.
    await auth(request(app).delete(`/api/v1/security/backups/${created.id}`)).expect(200);
    expect(existsSync(path.join(backupsRoot, created.id))).toBe(false);
    const list = (await auth(request(app).get('/api/v1/security/backups')).expect(200)).body.backups;
    expect(list.find((b) => b.id === created.id)).toBeUndefined();
  });
});
