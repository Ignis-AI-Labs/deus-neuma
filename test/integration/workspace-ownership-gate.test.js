/**
 * Workspace ownership gate — IDOR verification (MASTER_PLAN B-05).
 *
 * Proves that /api/v1/workspace/:id routes bind the :id object reference to
 * the authenticated wallet, not merely to authentication. NOTHING mocked
 * except console: real Express, real challenge-sign-verify auth (two real
 * wallets), real NeumaWorkspace on a temp root, real owner.json on disk.
 *
 * The enforcement under test lives in backend/routes/workspace-routes.js:
 *   - router.use(requireAuth)            (line ~23) — authentication
 *   - requireOwnership via router.param('id', ...) (lines ~27-89) — ownership
 *
 * Denial contract (asserted below):
 *   - workspace claimed by another wallet → 403 { error: 'Not your workspace' }
 *   - workspace that does not exist (or is a hollow lane) → 404
 *   - a lane no wallet has claimed → 404, and the read claims nothing; the
 *     wallet its genesis seal names claims it deliberately (ruling, 2026-10-19)
 */
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, () => {
    resolve({ server, baseUrl: `http://localhost:${server.address().port}` });
  });
});

describe('Workspace ownership gate (real auth, real disk)', () => {
  let app, server, baseUrl, root, workspace;
  let walletA, walletB, tokenA, tokenB;

  // Real challenge → sign → verify flow over HTTP, exactly as a client does it.
  const authenticate = async (keypair) => {
    const challengeRes = await fetch(`${baseUrl}/api/v1/auth/challenge?address=${keypair.address}`);
    expect(challengeRes.status).toBe(200);
    const { challenge } = await challengeRes.json();

    const signature = await signMessage(keypair.privateKey, challenge);

    const verifyRes = await fetch(`${baseUrl}/api/v1/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: keypair.address, signature, challenge }),
    });
    expect(verifyRes.status).toBe(200);
    const { token } = await verifyRes.json();
    expect(token).toBeTruthy();
    return token;
  };

  const get = (route, token) => fetch(`${baseUrl}${route}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  beforeEach(async () => {
    root = await createTempDir('ownership-gate');
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace.root = root;

    const { default: workspaceRouter } = await import('../../backend/routes/workspace-routes.js');
    const { default: laneClaimRouter } = await import('../../backend/routes/lane-claim-routes.js');
    const { createAuthRouter } = await import('../../backend/services/auth.js');

    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter(express));
    app.use('/api/v1/workspace', workspaceRouter);
    app.use('/api/v1/lanes', laneClaimRouter);
    ({ server, baseUrl } = await listen(app));

    // A real lane that carries a being (the auto-claim guard requires
    // identity or DNA on disk — hollow lanes are 404'd, never claimed).
    await workspace.create('neuma-a');
    await fs.mkdir(path.join(root, 'neuma-a', 'dna'), { recursive: true });
    await fs.writeFile(path.join(root, 'neuma-a', 'dna', 'genesis.md'), '# Genesis\nborn for the gate test\n');

    walletA = generateKeypair();
    walletB = generateKeypair();
    tokenA = await authenticate(walletA);
    tokenB = await authenticate(walletB);
    // neuma-a's genesis seal names wallet A as its operator.
    await fs.mkdir(path.join(root, 'neuma-a', 'identity'), { recursive: true });
    await fs.writeFile(path.join(root, 'neuma-a', 'identity', 'genesis-seal.json'), JSON.stringify({
      record: { witnessWallet: walletA.address, birthMoment: { epochMs: Date.now() } },
    }));
  });

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const claimA = () => fetch(`${baseUrl}/api/v1/lanes/neuma-a/claim`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokenA}` },
  });

  test('a first read claims nothing; wallet A claims its sealed workspace deliberately (real owner.json lands on disk)', async () => {
    const unread = await get('/api/v1/workspace/neuma-a/memory', tokenA);
    expect(unread.status).toBe(404);
    expect((await unread.json()).code).toBe('LANE_UNCLAIMED');
    await expect(fs.stat(path.join(root, 'neuma-a', 'owner.json'))).rejects.toMatchObject({ code: 'ENOENT' });

    expect((await claimA()).status).toBe(200);
    const res = await get('/api/v1/workspace/neuma-a/memory', tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('entities');
    expect(body).toHaveProperty('relations');
    expect(body).toHaveProperty('observations');

    const owner = JSON.parse(await fs.readFile(path.join(root, 'neuma-a', 'owner.json'), 'utf8'));
    expect(owner.wallet).toBe(walletA.address.toLowerCase());
    expect(owner.claimedAt).toBeTypeOf('number');
  });

  test('authenticated wallet B is DENIED wallet A\'s memory routes — 403, not data', async () => {
    // Wallet A claims first (the real deliberate claim).
    expect((await claimA()).status).toBe(200);

    // Wallet B holds a fully valid session token — authentication alone
    // must NOT reach neuma-A's data. Denial contract: 403 'Not your workspace'.
    const memRes = await get('/api/v1/workspace/neuma-a/memory', tokenB);
    expect(memRes.status).toBe(403);
    expect((await memRes.json()).error).toBe('Not your workspace');
  });

  test('ownership gate covers the sibling per-neuma data routes, not just memory', async () => {
    expect((await claimA()).status).toBe(200);
    expect((await get('/api/v1/workspace/neuma-a/dna', tokenA)).status).not.toBe(403);

    for (const route of ['dna', 'soul', 'journal', 'sessions', 'skills', 'export', 'stats']) {
      const res = await get(`/api/v1/workspace/neuma-a/${route}`, tokenB);
      expect(res.status, `GET /${route} must be ownership-gated`).toBe(403);
      expect((await res.json()).error).toBe('Not your workspace');
    }
  });

  test('wallet B cannot write into wallet A\'s workspace either', async () => {
    expect((await claimA()).status).toBe(200);

    const res = await fetch(`${baseUrl}/api/v1/workspace/neuma-a/memory/observation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ observation: { content: 'intrusion attempt' } }),
    });
    expect(res.status).toBe(403);
  });

  test('wallet A keeps full access to its own workspace after the claim', async () => {
    expect((await claimA()).status).toBe(200);
    expect((await get('/api/v1/workspace/neuma-a/memory', tokenA)).status).toBe(200);
    // Second access — owner.json now exists, direct-compare path.
    const res = await get('/api/v1/workspace/neuma-a/memory', tokenA);
    expect(res.status).toBe(200);
  });

  test('unauthenticated request never reaches the ownership layer — 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/workspace/neuma-a/memory`);
    expect(res.status).toBe(401);
  });

  test('nonexistent workspace is denied with 404 for any authenticated wallet', async () => {
    const res = await get('/api/v1/workspace/no-such-neuma/memory', tokenB);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Workspace not found');
  });

  test('an unreadable ownership path fails as a verification error, never as not-found', async () => {
    await workspace.create('broken-owner');
    await fs.mkdir(path.join(root, 'broken-owner', 'owner.json'));

    const res = await get('/api/v1/workspace/broken-owner/memory', tokenA);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Ownership verification failed');
  });

  test('a real marker stat failure is a verification error and never claims the lane', async () => {
    await workspace.create('broken-marker');
    const marker = path.join(root, 'broken-marker', 'identity', 'true-name.json');
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.symlink('true-name.json', marker);

    const res = await get('/api/v1/workspace/broken-marker/memory', tokenA);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Ownership verification failed');
    await expect(fs.stat(path.join(root, 'broken-marker', 'owner.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
