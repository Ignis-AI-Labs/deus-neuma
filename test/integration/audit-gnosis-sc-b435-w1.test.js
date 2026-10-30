/**
 * Gnosis validation for sc-audit run neuma-security-audit-b435 — wave 1
 * (ownership + workspace boundary findings).
 *
 * RULE 0: no mocks on the security boundary under claim.
 * Real auth (challenge → sign → session), real disk, real MCP where claimed.
 *
 * Run:
 *   npx vitest run .waves/runs/neuma-security-audit-b435/validation/gnosis-validation.test.js
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import { rmSync } from 'fs';
import path from 'path';
import os from 'os';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { mcpService } from '../../backend/services/mcp.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

// ---------------------------------------------------------------------------
// W1-001 — unauth preflight workspace mutation
// ---------------------------------------------------------------------------
describe('AUDIT-W1-001 unauth preflight POST /workspace', () => {
  let app, house, settingsPath, origRoot;

  beforeEach(async () => {
    house = await fs.mkdtemp(path.join(os.tmpdir(), 'gnosis-preflight-'));
    settingsPath = path.join(house, 'settings.json');
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = settingsPath;
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    // Real router — no auth mock. Preflight module has no requireAuth.
    const { default: router } = await import('../../backend/routes/preflight-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/preflight', router);
  });

  afterEach(() => {
    setWorkspacesRoot(origRoot);
    delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
    rmSync(house, { recursive: true, force: true });
  });

  test('POST without Authorization is 401 (SEC-AUDIT-002 fixed)', async () => {
    const newRoot = path.join(house, 'new-home');
    await fs.mkdir(newRoot, { recursive: true });
    const res = await request(app)
      .post('/api/v1/preflight/workspace')
      .send({ root: newRoot, allocationGB: 2 });
    expect(res.status).toBe(401);
  });

  test('POST with auth mutates root (real disk)', async () => {
    const newRoot = path.join(house, 'new-home');
    await fs.mkdir(newRoot, { recursive: true });
    const auth = await fullAuth();
    // The first local wallet no longer owns a fresh install on its word (owner-claim.js): seated here.
    await makeInstallOwner(auth.address);
    const res = await request(app)
      .post('/api/v1/preflight/workspace')
      .set('Authorization', `Bearer ${auth.token}`)
      .send({ root: newRoot, allocationGB: 2 });
    expect(res.status).not.toBe(401);
    expect([200, 422]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.root).toBe(path.resolve(newRoot));
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      expect(settings.root).toBe(path.resolve(newRoot));
      expect(getWorkspacesRoot()).toBe(path.resolve(newRoot));
    }
  });
});

// ---------------------------------------------------------------------------
// W1-002 — import steals ownership
// ---------------------------------------------------------------------------
describe('AUDIT-W1-002 workspace import ownership steal', () => {
  let app, house, origRoot, walletA, walletB;

  beforeEach(async () => {
    house = await fs.mkdtemp(path.join(os.tmpdir(), 'gnosis-import-'));
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    walletA = await fullAuth();
    walletB = await fullAuth();

    // Real lane owned by A with distinctive DNA marker
    await workspace.create('victim-neuma');
    await writeOwner(house, 'victim-neuma', walletA.address);
    await fs.writeFile(
      path.join(house, 'victim-neuma', 'dna', 'active.json'),
      JSON.stringify({ marker: 'A-ORIGINAL' }),
    );

    // REAL auth + REAL workspace router (no mock)
    const { default: router } = await import('../../backend/routes/workspace-routes.js');
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/v1/workspace', router);
  });

  afterEach(() => {
    setWorkspacesRoot(origRoot);
    rmSync(house, { recursive: true, force: true });
  });

  test('wallet B import is denied — owner.json stays A (SEC-AUDIT-003 fixed)', async () => {
    const bundle = {
      exportedAt: new Date().toISOString(),
      dna: { marker: 'B-STOLEN' },
      soul: null,
      memory: null,
    };
    const res = await request(app)
      .post('/api/v1/workspace/import')
      .set('Authorization', `Bearer ${walletB.token}`)
      .send({ neumaId: 'victim-neuma', bundle });

    expect(res.status).toBe(403);

    const owner = JSON.parse(
      await fs.readFile(path.join(house, 'victim-neuma', 'owner.json'), 'utf8'),
    );
    expect(owner.wallet.toLowerCase()).toBe(walletA.address);
  });

  test('wallet A still owns until B imports — control (own export works)', async () => {
    const res = await request(app)
      .get('/api/v1/workspace/victim-neuma/export')
      .set('Authorization', `Bearer ${walletA.token}`);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// W1-003 — companion/dna without ownership
// ---------------------------------------------------------------------------
describe('AUDIT-W1-003 companion/dna BOLA (real MCP when available)', () => {
  let app, house, walletA, walletB, mcpName;

  beforeAll(async () => {
    house = await fs.mkdtemp(path.join(os.tmpdir(), 'gnosis-dna-'));
    const dnaDir = path.join(house, 'data', 'dna', 'shared-companion');
    await fs.mkdir(dnaDir, { recursive: true });
    await fs.writeFile(
      path.join(dnaDir, 'dna.json'),
      JSON.stringify({ secret: 'A-ONLY', v: 1 }),
    );
    mcpName = 'filesystem';
    // Connect real FS MCP rooted at house (may already exist on process — disconnect first)
    try { await mcpService.disconnect(mcpName); } catch { /* */ }
    await mcpService.connectToServer(
      mcpName,
      'npx',
      ['-y', '@modelcontextprotocol/server-filesystem', house],
      {},
    );
  }, 90000);

  afterAll(async () => {
    try { await mcpService.disconnect(mcpName); } catch { /* */ }
    rmSync(house, { recursive: true, force: true });
  });

  beforeEach(async () => {
    walletA = await fullAuth();
    walletB = await fullAuth();
    // Point config MCP FS dir — memory-routes uses config or env
    process.env.NEUMA_MCP_FS_DIR = house;
    const { default: router } = await import('../../backend/routes/memory-routes.js');
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/v1', router);
  });

  test('legacy companion/dna is decommissioned 410 (W1-003 fixed)', async () => {
    const body = { companionId: 'shared-companion', action: 'read' };
    const resA = await request(app)
      .post('/api/v1/companion/dna')
      .set('Authorization', `Bearer ${walletA.token}`)
      .send(body);
    const resB = await request(app)
      .post('/api/v1/companion/dna')
      .set('Authorization', `Bearer ${walletB.token}`)
      .send(body);
    expect(resA.status).toBe(410);
    expect(resB.status).toBe(410);
  });
});

// ---------------------------------------------------------------------------
// W1-004 soft ownership + W1-005 wallet overview
// ---------------------------------------------------------------------------
describe('AUDIT-W1-004 / W1-005 ownership gaps', () => {
  let house, origRoot, walletA, walletB, appWallet, appRecovery;

  beforeEach(async () => {
    house = await fs.mkdtemp(path.join(os.tmpdir(), 'gnosis-own-'));
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    walletA = await fullAuth();
    walletB = await fullAuth();
    await workspace.create('lane-x');
    // No owner.json — soft helpers should allow B
    const { default: walletRouter } = await import('../../backend/routes/neuma-wallet-routes.js');
    const { default: recoveryRouter } = await import('../../backend/routes/recovery-routes.js');
    appWallet = express();
    appWallet.use(express.json());
    appWallet.use('/api/v1/neuma', walletRouter);
    appRecovery = express();
    appRecovery.use(express.json());
    appRecovery.use('/api/v1/neuma', recoveryRouter);
  });

  afterEach(() => {
    setWorkspacesRoot(origRoot);
    rmSync(house, { recursive: true, force: true });
  });

  test('W1-004: recovery status with no owner is fail-closed (404)', async () => {
    const res = await request(appRecovery)
      .get('/api/v1/neuma/lane-x/recovery/status')
      .set('Authorization', `Bearer ${walletB.token}`);
    expect(res.status).toBe(404);
  });

  test('W1-005: GET wallet overview requires ownership (404 unclaimed)', async () => {
    const res = await request(appWallet)
      .get('/api/v1/neuma/lane-x/wallet')
      .set('Authorization', `Bearer ${walletB.token}`);
    expect(res.status).toBe(404);
  });

  test('W1-004 corrupt owner: fail-closed 500 (not soft-open)', async () => {
    await fs.writeFile(path.join(house, 'lane-x', 'owner.json'), '{not-json');
    const res = await request(appRecovery)
      .get('/api/v1/neuma/lane-x/recovery/status')
      .set('Authorization', `Bearer ${walletB.token}`);
    expect(res.status).toBe(500);
  });
});
