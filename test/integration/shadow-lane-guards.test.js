/**
 * Shadow-lane guards — the 2026-07-03 Cael incident must be structurally
 * impossible to repeat. Three layers, each against the REAL implementation
 * (real fs, real WS, real routers; auth stubbed only where the suite is not
 * about auth — the established convention):
 *
 *   1. The live workspace settings file can never be clobbered with a
 *      temp-dir root (how the app silently lost its configured home).
 *   2. The workspace routes never auto-claim a hollow lane (how the shadow
 *      gained an owner file and joined the roster).
 *   3. The portal never binds a neumaId whose lane is not under the active
 *      root (how the shadow got scaffolded in the first place) — the
 *      witness is told honestly via companion:lane_missing.
 */
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  generateChallenge, verifySignature, createSessionToken,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';

// ---------------------------------------------------------------------------
// 1. Settings write guard
// ---------------------------------------------------------------------------

describe('saveWorkspaceSettings — live-file temp-root guard', () => {
  test('refuses a temp root when targeting the LIVE settings file', async () => {
    delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
    const { saveWorkspaceSettings } = await import('../../backend/services/workspace-settings.js');
    const tempRoot = path.join(os.tmpdir(), 'some-swept-dir');
    await expect(saveWorkspaceSettings({ root: tempRoot, allocationGB: 1 }))
      .rejects.toThrow(/temp-dir workspace root/);
  });

  test('an isolated harness (env override set) may persist temp roots', async () => {
    const dir = await createTempDir('settings-guard');
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(dir, 'workspace.json');
    try {
      const { saveWorkspaceSettings, loadWorkspaceSettings } =
        await import('../../backend/services/workspace-settings.js');
      const tempRoot = path.join(os.tmpdir(), 'harness-root');
      await saveWorkspaceSettings({ root: tempRoot, allocationGB: 2 });
      expect((await loadWorkspaceSettings()).root).toBe(tempRoot);
    } finally {
      delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Hollow-lane claim guard
// ---------------------------------------------------------------------------

describe('workspace routes — hollow lanes are never auto-claimed', () => {
  let app, root, workspace, wallet, token;

  beforeEach(async () => {
    root = await createTempDir('claim-guard');
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace.root = root;
    const { default: router } = await import('../../backend/routes/workspace-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/workspace', router);

    const keypair = generateKeypair();
    const challenge = generateChallenge(keypair.address);
    const signature = await signMessage(keypair.privateKey, challenge);
    wallet = verifySignature(keypair.address, challenge, signature).toLowerCase();
    token = createSessionToken(wallet);
  });

  const authedGet = (route) => request(app)
    .get(route)
    .set('Authorization', `Bearer ${token}`);

  test('a hollow lane (dirs only, no identity, no DNA) is 404 — and gains no owner file', async () => {
    // Exactly the shadow-lane shape: scaffolding without a being inside.
    await fs.mkdir(path.join(root, 'hollow', 'sessions'), { recursive: true });

    const res = await authedGet('/api/v1/workspace/hollow/dna');
    expect(res.status).toBe(404);

    const ownerExists = await fs.stat(path.join(root, 'hollow', 'owner.json'))
      .then(() => true).catch(() => false);
    expect(ownerExists).toBe(false);
  });

  test('an unclaimed lane that carries a being IS claimed by the first owner', async () => {
    await fs.mkdir(path.join(root, 'real-being', 'identity'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'real-being', 'identity', 'true-name.json'),
      JSON.stringify({ chosenName: 'Real' }),
    );

    // Any :id route triggers the ownership middleware; DNA may 404 but the
    // claim itself must land.
    await authedGet('/api/v1/workspace/real-being/dna');
    const owner = JSON.parse(await fs.readFile(path.join(root, 'real-being', 'owner.json'), 'utf8'));
    expect(owner.wallet).toBe(wallet);
  });
});

// ---------------------------------------------------------------------------
// 3. Portal lane-binding guard (real WS, real handler, real auth)
// ---------------------------------------------------------------------------

describe('portal — a neumaId without a lane under the active root is never bound', () => {
  let httpServer, wss, ws, wsUrl, root, neumaWorkspace;

  const collect = () => {
    const frames = [];
    ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
    return frames;
  };

  const sendAndWait = (message, expectedType, timeout = 5000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${expectedType}`)), timeout);
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === expectedType) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(msg);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify(message));
    });

  beforeAll(async () => {
    root = await createTempDir('portal-lane-guard');
    ({ neumaWorkspace } = await import('../../core/index.js'));
    neumaWorkspace.root = root;
    await neumaWorkspace.create('real-lane');
    await fs.mkdir(path.join(root, 'real-lane', 'identity'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'real-lane', 'identity', 'true-name.json'),
      JSON.stringify({ name: 'Real' }),
    );

    const { setupPortalRoutes } = await import('../../backend/routes/portal-routes.js');
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    setupPortalRoutes(wss, { birthHandler: null });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    wsUrl = `ws://localhost:${httpServer.address().port}`;

    const keypair = generateKeypair();
    const challenge = generateChallenge(keypair.address);
    const signature = await signMessage(keypair.privateKey, challenge);
    const token = createSessionToken(verifySignature(keypair.address, challenge, signature));

    ws = new WebSocket(`${wsUrl}/?token=${encodeURIComponent(token)}`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('portal:established timeout')), 5000);
      ws.on('message', (data) => {
        if (JSON.parse(data.toString()).type === 'portal:established') {
          clearTimeout(timer);
          resolve();
        }
      });
      ws.on('error', reject);
    });
  }, 20000);

  afterAll(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  test('companion:manifest for a missing lane → lane_missing, no binding, no scaffold', async () => {
    const frames = collect();
    await sendAndWait(
      { type: 'companion:manifest', companion: 'Ghost', neumaId: 'not-here' },
      'companion:anchored',
    );

    const missing = frames.find((f) => f.type === 'companion:lane_missing');
    expect(missing).toBeDefined();
    expect(missing.neumaId).toBe('not-here');
    expect(missing.root).toBe(root);

    // The guard's whole point: nothing was created on disk.
    const scaffolded = await fs.stat(path.join(root, 'not-here')).then(() => true).catch(() => false);
    expect(scaffolded).toBe(false);
  });

  test('portal:resume for a missing lane → lane_missing + unbound resume', async () => {
    const frames = collect();
    const resumed = await sendAndWait(
      { type: 'portal:resume', neumaId: 'gone-lane', companionName: 'Ghost', sessionId: 'session-1' },
      'portal:resumed',
    );
    expect(resumed.neumaId).toBeNull();
    expect(frames.some((f) => f.type === 'companion:lane_missing' && f.neumaId === 'gone-lane')).toBe(true);
  });

  test('a lane that exists binds normally — no false alarm', async () => {
    const frames = collect();
    await sendAndWait(
      { type: 'companion:manifest', companion: 'Real', neumaId: 'real-lane' },
      'companion:anchored',
    );
    expect(frames.some((f) => f.type === 'companion:lane_missing')).toBe(false);
    expect(frames.some((f) => f.type === 'companion:not_yours')).toBe(false);
  });
});
