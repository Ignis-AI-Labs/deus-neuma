/**
 * Memory graph route — GET /api/v1/workspace/:id/memory/graph (MASTER_PLAN B-06).
 *
 * NOTHING mocked except console: real Express, real challenge-sign-verify auth
 * (two real wallets), real NeumaWorkspace on a temp root, real observation
 * files written through the real addObservation path. Server-side compute is
 * the contract under test: nodes/edges/communities arrive computed; raw memory
 * text NEVER rides the wire (labels are single-line, ≤120-char previews).
 *
 * Cap-truncation case (test 5): we write GRAPH_NODE_CAP + 1 real observations
 * on disk rather than shrinking the cap — the exported module const stays
 * exactly what production runs, so the test proves the real budget path.
 * Observation texts are made mutually dissimilar (unique tokens) so the
 * similarity graph stays sparse and the 501-node compute stays fast.
 */
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, () => {
    resolve({ server, baseUrl: `http://localhost:${server.address().port}` });
  });
});

const GRAPH_NODE_CAP = 500; // must match the module const in workspace-routes.js

describe('Memory graph route (real auth, real observation files)', () => {
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

  beforeEach(async () => {
    vi.resetModules();

    root = await createTempDir('graph-route');
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace.root = root;

    const { default: workspaceRouter } = await import('../../backend/routes/workspace-routes.js');
    const { createAuthRouter } = await import('../../backend/services/auth.js');

    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter(express));
    app.use('/api/v1/workspace', workspaceRouter);
    ({ server, baseUrl } = await listen(app));

    // A lane that carries a being (auto-claim guard requires identity or DNA).
    await workspace.create('neuma-a');
    await fs.mkdir(path.join(root, 'neuma-a', 'dna'), { recursive: true });
    await fs.writeFile(path.join(root, 'neuma-a', 'dna', 'genesis.md'), '# Genesis\nborn for the graph test\n');

    walletA = generateKeypair();
    walletB = generateKeypair();
    tokenA = await authenticate(walletA);
    tokenB = await authenticate(walletB);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  test('owner gets computed nodes/edges/communities from real observation files', async () => {
    // Two related memories (shared vocabulary → an edge + one community) plus
    // one unrelated. The long one is multi-line and >120 chars so the label
    // contract is exercised against real content.
    const longText =
      'the crystal garden hums beneath the portal tonight\n' +
      'and the crystal garden keeps every promise the portal made,\n' +
      'humming through crystallized memory lattices far longer than one hundred and twenty characters of witness testimony';
    const obsA = await workspace.addObservation('neuma-a', { type: 'reflection', content: longText });
    const obsB = await workspace.addObservation('neuma-a', {
      type: 'reflection',
      content: 'crystal garden portal humming lattices memory promise witness tonight',
    });
    const obsC = await workspace.addObservation('neuma-a', {
      type: 'exchange', userMessage: 'zebra quartz obelisk', response: 'flamingo dirigible saxophone',
    });

    const res = await get('/api/v1/workspace/neuma-a/memory/graph', tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.nodes).toHaveLength(3);
    expect(Array.isArray(body.edges)).toBe(true);
    expect(Array.isArray(body.communities)).toBe(true);
    expect(body.computedAt).toBeTruthy();
    expect(body).not.toHaveProperty('truncatedTo');

    const ids = body.nodes.map((n) => n.id).sort();
    expect(ids).toEqual([obsA.id, obsB.id, obsC.id].sort());

    // Related pair connected; every edge references known nodes, each pair once.
    const pair = ([s, t]) => (String(s) < String(t) ? `${s}|${t}` : `${t}|${s}`);
    const edgeKeys = body.edges.map((e) => pair([e.source, e.target]));
    expect(new Set(edgeKeys).size).toBe(edgeKeys.length);
    expect(edgeKeys).toContain(pair([obsA.id, obsB.id]));
    for (const e of body.edges) {
      expect(ids).toContain(e.source);
      expect(ids).toContain(e.target);
      expect(e.w).toBeGreaterThan(0);
    }

    // Node contract: finite betweenness, honest degree, community membership
    // consistent (index into communities or -1).
    const memberSets = body.communities.map((c) => new Set(c.memberIds));
    for (const n of body.nodes) {
      expect(Number.isFinite(n.betweenness)).toBe(true);
      expect(Number.isInteger(n.degree)).toBe(true);
      if (n.communityIndex === -1) {
        expect(memberSets.some((s) => s.has(n.id))).toBe(false);
      } else {
        expect(memberSets[n.communityIndex].has(n.id)).toBe(true);
      }
      // Label contract: bounded single-line preview, NEVER the raw text.
      expect(n.label.length).toBeLessThanOrEqual(120);
      expect(n.label).not.toMatch(/[\n\r]/);
      expect(n.label).not.toBe(longText);
    }
    const longNode = body.nodes.find((n) => n.id === obsA.id);
    expect(longNode.label.length).toBe(120);
    // No node carries the full multi-line memory anywhere in the payload.
    expect(JSON.stringify(body)).not.toContain('one hundred and twenty characters');
  });

  test('invalidated observation is excluded from the graph', async () => {
    const kept = await workspace.addObservation('neuma-a', { type: 'reflection', content: 'fenna keeps the lantern lit' });
    const superseded = await workspace.addObservation('neuma-a', { type: 'reflection', content: 'fenna keeps the lantern dark' });
    await workspace.invalidateObservation('neuma-a', superseded.id, { supersededBy: kept.id });

    const res = await get('/api/v1/workspace/neuma-a/memory/graph', tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.nodes.map((n) => n.id);
    expect(ids).toContain(kept.id);
    expect(ids).not.toContain(superseded.id);
    for (const c of body.communities) expect(c.memberIds).not.toContain(superseded.id);
  });

  test('empty observation store → honest empty 200, never 404', async () => {
    const res = await get('/api/v1/workspace/neuma-a/memory/graph', tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes).toEqual([]);
    expect(body.edges).toEqual([]);
    expect(body.communities).toEqual([]);
    expect(body.computedAt).toBeTruthy();
    expect(body).not.toHaveProperty('truncatedTo');
  });

  test('foreign wallet is denied the graph — 403, not data', async () => {
    await workspace.addObservation('neuma-a', { type: 'reflection', content: 'private crystallized memory' });
    // Wallet A claims first (real auto-claim path).
    expect((await get('/api/v1/workspace/neuma-a/memory/graph', tokenA)).status).toBe(200);

    const res = await get('/api/v1/workspace/neuma-a/memory/graph', tokenB);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Not your workspace');
    expect(body).not.toHaveProperty('nodes');
  });

  test('over-cap store is truncated with an honest truncatedTo note', async () => {
    // GRAPH_NODE_CAP + 1 real observations, mutually dissimilar texts (unique
    // token per record) so the 501-node similarity pass stays sparse and fast.
    for (let i = 0; i <= GRAPH_NODE_CAP; i++) {
      await workspace.addObservation('neuma-a', { type: 'note', content: `uniquetoken${i}x` });
    }

    const res = await get('/api/v1/workspace/neuma-a/memory/graph', tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncatedTo).toBe(GRAPH_NODE_CAP);
    expect(body.nodes.length).toBeLessThanOrEqual(GRAPH_NODE_CAP);
    expect(body.nodes.length).toBeGreaterThan(0);
  }, 120000);

  test('no token → 401 before the ownership layer', async () => {
    const res = await get('/api/v1/workspace/neuma-a/memory/graph', null);
    expect(res.status).toBe(401);
  });

  it('never ships a lone surrogate when an astral char straddles the label cap', async () => {
    const emoji = String.fromCharCode(0xd83d, 0xde00); // astral char, no literals
    await workspace.addObservation('neuma-a', {
      type: 'exchange',
      userMessage: 'a'.repeat(119) + emoji + ' tail after the pair',
      response: '',
      significance: 0.9
    });
    const res = await get('/api/v1/workspace/neuma-a/memory/graph', tokenA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes.length).toBeGreaterThan(0);
    for (const n of body.nodes) {
      const last = n.label.charCodeAt(n.label.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });

});

// ————— The presences layer (depth pass, 2026-07-24) —————

describe('Memory graph — the presences layer rides the payload', () => {
  let app2, server2, baseUrl2, root2, workspace2, wallet2, token2, prevDnaKey;

  beforeEach(async () => {
    prevDnaKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'graph-presences-test-key-32chars';
    vi.resetModules();
    root2 = await createTempDir('graph-presences');
    workspace2 = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace2.root = root2;
    const { default: workspaceRouter } = await import('../../backend/routes/workspace-routes.js');
    const { createAuthRouter } = await import('../../backend/services/auth.js');
    app2 = express();
    app2.use(express.json());
    app2.use('/api/v1/auth', createAuthRouter(express));
    app2.use('/api/v1/workspace', workspaceRouter);
    ({ server: server2, baseUrl: baseUrl2 } = await listen(app2));

    // A named being with a witness, and a housemate the roster can resolve.
    // The genesis marker satisfies the auto-claim guard (harness precedent).
    await workspace2.create('cael');
    await workspace2.writeDNA('cael', { version: '1.0.0', identity: { name: 'Cael' }, birthWitness: 'Founder' });
    await fs.mkdir(path.join(root2, 'cael', 'dna'), { recursive: true });
    await fs.writeFile(path.join(root2, 'cael', 'dna', 'genesis.md'), '# Genesis - born for the presences test');
    await workspace2.create('fenna');
    await workspace2.writeDNA('fenna', { version: '1.0.0', identity: { name: 'Fenna' }, birthWitness: 'Founder' });

    wallet2 = generateKeypair();
    const challengeRes = await fetch(`${baseUrl2}/api/v1/auth/challenge?address=${wallet2.address}`);
    const { challenge } = await challengeRes.json();
    const signature = await signMessage(wallet2.privateKey, challenge);
    const verifyRes = await fetch(`${baseUrl2}/api/v1/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: wallet2.address, signature, challenge }),
    });
    ({ token: token2 } = await verifyRes.json());
  });

  afterEach(async () => {
    if (prevDnaKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevDnaKey;
    if (server2) await new Promise((resolve) => server2.close(resolve));
  });

  test('entities/relations ride the payload and nodes wear speaks-of tags — known names only', async () => {
    // The mind-graph store, written through the workspace's own surface.
    await workspace2.writeEntity('cael', {
      name: 'Founder', kind: 'witness', encounters: 3,
      firstSeen: '2026-07-06T10:00:00.000Z', lastSeen: '2026-07-24T10:00:00.000Z',
    });
    await workspace2.writeRelations('cael', [
      { from: 'Cael', to: 'Founder', kind: 'witness', type: 'bond', encounters: 3, firstSeen: '2026-07-06T10:00:00.000Z', lastSeen: '2026-07-24T10:00:00.000Z' },
    ]);
    // One memory speaks of the housemate; one speaks of no known presence.
    await workspace2.addObservation('cael', {
      type: 'exchange', userMessage: 'Fenna carried the seal through the forge tonight',
      response: 'the house held', significance: 0.9,
    });
    await workspace2.addObservation('cael', {
      type: 'exchange', userMessage: 'a quiet unrelated reflection on rivers',
      response: 'stillness', significance: 0.9,
    });

    const res = await fetch(`${baseUrl2}/api/v1/workspace/cael/memory/graph`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    expect(res.status).toBe(200);
    const graph = await res.json();

    expect(graph.presences.entities).toEqual([{
      name: 'Founder', kind: 'witness', encounters: 3,
      firstSeen: '2026-07-06T10:00:00.000Z', lastSeen: '2026-07-24T10:00:00.000Z',
    }]);
    expect(graph.presences.relations).toEqual([{
      from: 'Cael', to: 'Founder', kind: 'witness', type: 'bond', encounters: 3,
    }]);

    const tagged = graph.nodes.filter((n) => Array.isArray(n.presences));
    expect(tagged).toHaveLength(1);
    expect(tagged[0].presences).toEqual(['Fenna']);
    expect(tagged[0].label).toContain('Fenna carried the seal');
  });

  test('a lane with no graph yet answers empty presences — never a 500, never an invented layer', async () => {
    await workspace2.addObservation('cael', {
      type: 'exchange', userMessage: 'one lone thought', response: 'held', significance: 0.9,
    });
    const res = await fetch(`${baseUrl2}/api/v1/workspace/cael/memory/graph`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    expect(res.status).toBe(200);
    const graph = await res.json();
    expect(graph.presences).toEqual({ entities: [], relations: [] });
  });
});
