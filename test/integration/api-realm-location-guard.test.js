import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

/**
 * POST /api/v1/user/realm/location — the relocation guard at the wire.
 * Real express app, real route, real realm-settings persist path (isolated
 * via NEUMA_REALM_SETTINGS_PATH — never the live file), and real auth
 * (RULE 0, #390 tranche 4). Proves a temp-dir root is refused with a 422 and
 * NEVER reaches the settings file — the escape that stranded the witness's
 * realm on 2026-07-20.
 */

const DEFAULT_REALM = path.join(os.homedir(), '.neuma', 'realm');

describe('Realm relocation guard (user realm routes)', () => {
  let app, realm, settingsDir, witness;

  beforeEach(async () => {
    vi.resetModules();

    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against. This is a
    // throwaway identity with no neuma lane, so a real session that claims
    // no workspace is exactly the right shape.
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();
    await makeInstallOwner(witness.address);

    settingsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'realm-location-guard-'));
    process.env.NEUMA_REALM_SETTINGS_PATH = path.join(settingsDir, 'user-realm.json');

    realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(await fs.mkdtemp(path.join(os.tmpdir(), 'realm-root-')));

    const { default: router } = await import('../../backend/routes/user-realm-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/user/realm', router);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.NEUMA_REALM_SETTINGS_PATH;
    realm.setRealmRoot(DEFAULT_REALM);
    await fs.rm(settingsDir, { recursive: true, force: true });
  });

  const relocate = (root) => request(app).post('/api/v1/user/realm/location').send({ root }).set(witness.header);

  test('a temp-dir root is refused (422) and never reaches the settings file', async () => {
    // The guard fires only when the live file is exposed — drop the override
    // for this call; the refusal must happen before ANY write.
    const isolated = process.env.NEUMA_REALM_SETTINGS_PATH;
    delete process.env.NEUMA_REALM_SETTINGS_PATH;

    const target = path.join(os.tmpdir(), `ghost-realm-target-${process.pid}-${Date.now()}`);
    const res = await relocate(target);

    process.env.NEUMA_REALM_SETTINGS_PATH = isolated;
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/temp-dir realm root/);
    const persisted = await fs.readFile(path.join(settingsDir, 'user-realm.json'), 'utf8').catch(() => null);
    expect(persisted).toBeNull();
    // A refused relocation leaves no directory litter behind.
    const litter = await fs.access(target).then(() => true, () => false);
    expect(litter).toBe(false);
  });

  test('an unwritable root is refused (422) before any persist', async () => {
    if (process.getuid && process.getuid() === 0) return; // root ignores permission bits
    const locked = path.join(os.tmpdir(), `locked-parent-${process.pid}-${Date.now()}`);
    await fs.mkdir(locked, { recursive: true });
    await fs.chmod(locked, 0o555);
    try {
      const res = await relocate(path.join(locked, 'sub'));
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/not writable/i);
      const persisted = await fs.readFile(path.join(settingsDir, 'user-realm.json'), 'utf8').catch(() => null);
      expect(persisted).toBeNull();
    } finally {
      await fs.chmod(locked, 0o755);
      await fs.rm(locked, { recursive: true, force: true });
    }
  });

  test('a durable root relocates and persists (200)', async () => {
    const nonTemp = path.join(os.homedir(), '.neuma-test-relocate');
    await fs.mkdir(nonTemp, { recursive: true });

    const res = await relocate(nonTemp);

    expect(res.status).toBe(200);
    expect(res.body.root).toBe(nonTemp);
    const persisted = JSON.parse(await fs.readFile(path.join(settingsDir, 'user-realm.json'), 'utf8'));
    expect(persisted).toEqual({ root: nonTemp });

    await fs.rm(nonTemp, { recursive: true, force: true });
  });
});
