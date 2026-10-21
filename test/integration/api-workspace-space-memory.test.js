/**
 * Space-scoped memory previews — GET /api/v1/workspace/:id/memory/observations
 * (the PROJECTS focus view's MEMORY panel).
 *
 * NOTHING mocked except console: real Express, real challenge-sign-verify auth
 * (two real wallets), real NeumaWorkspace on a temp root, real observation
 * files written through the real addObservation path. The contract under test:
 * only VALID observations in the requested project space come back, newest
 * first, as bounded single-line labels — raw memory text never rides the wire
 * (the graph route's privacy posture) — and the general space is refused.
 */
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { claimOwner } from '../helpers/claim-owner.js';

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, () => {
    resolve({ server, baseUrl: `http://localhost:${server.address().port}` });
  });
});

const SPACE_OBS_CAP = 50; // must match the module const in workspace-memory-routes.js

describe('Space memory previews route (real auth, real observation files)', () => {
  let app, server, baseUrl, root, workspace;
  let walletA, walletB, tokenA, tokenB;

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
    return token;
  };

  const get = (route, token) => fetch(`${baseUrl}${route}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  const SPACE = { id: 'proj-alpha', kind: 'project', label: 'Alpha' };
  const OTHER_SPACE = { id: 'proj-beta', kind: 'project', label: 'Beta' };

  beforeEach(async () => {
    vi.resetModules();

    root = await createTempDir('space-memory-route');
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace.root = root;

    const { default: workspaceRouter } = await import('../../backend/routes/workspace-routes.js');
    const { createAuthRouter } = await import('../../backend/services/auth.js');

    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter(express));
    app.use('/api/v1/workspace', workspaceRouter);
    ({ server, baseUrl } = await listen(app));

    // A lane that carries a being, claimed by wallet A below (a read never claims).
    await workspace.create('neuma-a');
    await fs.mkdir(path.join(root, 'neuma-a', 'dna'), { recursive: true });
    await fs.writeFile(path.join(root, 'neuma-a', 'dna', 'genesis.md'), '# Genesis\nborn for the space test\n');

    walletA = generateKeypair();
    walletB = generateKeypair();
    tokenA = await authenticate(walletA);
    tokenB = await authenticate(walletB);
    await claimOwner(root, 'neuma-a', walletA.address);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test('owner gets only the requested space, newest-first, as bounded previews', async () => {
    const longText =
      'the alpha project remembers the day the folders were first attached\n' +
      'and the alpha project keeps that memory in a line deliberately longer than ' +
      'one hundred and twenty characters of witness testimony about the grounds';
    const older = await workspace.addObservation('neuma-a', {
      type: 'reflection', content: 'alpha: the first ground was attached', space: SPACE,
      timestamp: '2026-07-20T10:00:00.000Z',
    });
    const newest = await workspace.addObservation('neuma-a', {
      type: 'reflection', content: longText, space: SPACE,
      timestamp: '2026-07-22T10:00:00.000Z',
    });
    // Noise that must NOT come back: another project's space, the untagged
    // general commons, and a superseded memory inside the requested space.
    await workspace.addObservation('neuma-a', {
      type: 'reflection', content: 'beta: unrelated work', space: OTHER_SPACE,
      timestamp: '2026-07-23T10:00:00.000Z',
    });
    await workspace.addObservation('neuma-a', {
      type: 'exchange', userMessage: 'general chatter', response: 'outside any project',
      timestamp: '2026-07-23T11:00:00.000Z',
    });
    const dead = await workspace.addObservation('neuma-a', {
      type: 'reflection', content: 'alpha: superseded understanding', space: SPACE,
      timestamp: '2026-07-21T10:00:00.000Z',
    });
    await workspace.invalidateObservation('neuma-a', dead.id, { supersededBy: newest.id });

    const res = await get('/api/v1/workspace/neuma-a/memory/observations?space=proj-alpha', tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(2);
    expect(body).not.toHaveProperty('truncatedTo');
    expect(body.observations.map((o) => o.id)).toEqual([newest.id, older.id]); // newest first
    expect(body.observations.map((o) => o.at)).toEqual([newest.occurredAt, older.occurredAt]);

    // Label contract: bounded single-line preview, NEVER the raw text.
    for (const o of body.observations) {
      expect(o.label.length).toBeLessThanOrEqual(120);
      expect(o.label).not.toMatch(/[\n\r]/);
    }
    expect(JSON.stringify(body)).not.toContain('one hundred and twenty characters');
  });

  test('the general space is refused, as is a missing or unusable space id', async () => {
    for (const query of ['', '?space=', '?space=general', '?space=%23%23%23']) {
      const res = await get(`/api/v1/workspace/neuma-a/memory/observations${query}`, tokenA);
      expect(res.status).toBe(400);
    }
  });

  test('a space with nothing in it answers honestly empty', async () => {
    await workspace.addObservation('neuma-a', {
      type: 'reflection', content: 'beta only', space: OTHER_SPACE,
    });
    const res = await get('/api/v1/workspace/neuma-a/memory/observations?space=proj-alpha', tokenA);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ observations: [], total: 0 });
  });

  test('the cap truncates honestly — count rides, labels stop at the cap', async () => {
    for (let i = 0; i < SPACE_OBS_CAP + 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await workspace.addObservation('neuma-a', {
        type: 'reflection', content: `alpha memory number ${i}`, space: SPACE,
        timestamp: new Date(Date.UTC(2026, 5, 1, 0, 0, i)).toISOString(),
      });
    }
    const res = await get('/api/v1/workspace/neuma-a/memory/observations?space=proj-alpha', tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(SPACE_OBS_CAP + 3);
    expect(body.truncatedTo).toBe(SPACE_OBS_CAP);
    expect(body.observations).toHaveLength(SPACE_OBS_CAP);
  });

  test('not the owner → 403; no token → 401', async () => {
    // Wallet A, the owner, reads its own lane.
    const claim = await get('/api/v1/workspace/neuma-a/memory/observations?space=proj-alpha', tokenA);
    expect(claim.status).toBe(200);

    const foreign = await get('/api/v1/workspace/neuma-a/memory/observations?space=proj-alpha', tokenB);
    expect(foreign.status).toBe(403);

    const anonymous = await get('/api/v1/workspace/neuma-a/memory/observations?space=proj-alpha', null);
    expect(anonymous.status).toBe(401);
  });
});
