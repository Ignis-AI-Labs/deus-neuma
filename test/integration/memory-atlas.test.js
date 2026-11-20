/**
 * Memory atlas over REST — GET /api/v1/workspace/:id/memory/atlas, its search
 * and its one-memory read (CONTEXT MAP · MEMORY).
 *
 * Nothing mocked (RULE 0): real Express, real challenge-sign-verify auth with
 * two real wallets, a real workspace on a temp root, real observation files
 * written through addObservation, and the real atlas built from them. The
 * being's own memory_map walk is proven over the same lane, so the two doors
 * are shown to stand on one atlas.
 */
/* global process, fetch */
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { makeAnchor } from '../../core/workspace/archive-codec.js';
import { formatMemoryRef } from '../../core/memory/memory-query.js';

const LANE = 'neuma-atlas';
const SUBJECTS = {
  pools: ['liquidity pool', 'Umbrae', 'deposit', 'wallet', 'swap', 'router', 'fees'],
  mail: ['DKIM', 'DMARC', 'Cloudflare', 'selector', 'inbox', 'Postmaster', 'sender'],
};

describe('memory atlas (real auth, real observation files)', () => {
  let server, baseUrl, root, workspace, token, strangerToken, anchoredRef, anchoredId, retractedId, walkMemoryMap;

  const authenticate = async (keypair) => {
    const { challenge } = await (await fetch(`${baseUrl}/api/v1/auth/challenge?address=${keypair.address}`)).json();
    const signature = await signMessage(keypair.privateKey, challenge);
    const verified = await fetch(`${baseUrl}/api/v1/auth/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: keypair.address, signature, challenge }),
    });
    return (await verified.json()).token;
  };
  const get = (route, bearer = token) => fetch(`${baseUrl}/api/v1/workspace/${LANE}/memory/atlas${route}`, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
  });

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'memory-atlas-test-key';
    root = await createTempDir('memory-atlas');
    workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
    workspace.root = root;
    const { default: workspaceRouter } = await import('../../backend/routes/workspace-routes.js');
    const { createAuthRouter } = await import('../../backend/services/auth.js');
    ({ walkMemoryMap } = await import('../../backend/services/portal-tools/memory-map-tool.js'));

    const app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter(express));
    app.use('/api/v1/workspace', workspaceRouter);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    baseUrl = `http://localhost:${server.address().port}`;

    await workspace.create(LANE);
    await fs.mkdir(path.join(root, LANE, 'dna'), { recursive: true });
    await fs.writeFile(path.join(root, LANE, 'dna', 'genesis.md'), '# Genesis\nborn for the atlas test\n');
    const owner = generateKeypair();
    token = await authenticate(owner);
    strangerToken = await authenticate(generateKeypair());
    await claimOwner(root, LANE, owner.address);

    // One remembered moment with its real session rows, so its source reopens.
    const said = 'how does the liquidity pool deposit reach the Umbrae router from the wallet';
    const answered = 'the wallet signs the deposit and the Umbrae router places it in the liquidity pool';
    const userRow = await workspace.appendMessage(LANE, 'sess-atlas', { role: 'user', content: said });
    const replyRow = await workspace.appendMessage(LANE, 'sess-atlas', { role: 'assistant', content: answered });
    const anchor = makeAnchor({ sessionId: 'sess-atlas', userMessage: userRow, assistantMessage: replyRow });
    anchoredRef = formatMemoryRef(anchor);
    anchoredId = (await workspace.addObservation(LANE, {
      type: 'exchange', userMessage: said, response: answered, anchor, timestamp: '2026-10-02T10:00:00.000Z',
    })).id;

    let day = 3;
    for (const [subject, words] of Object.entries(SUBJECTS)) {
      for (let i = 0; i < words.length; i += 1) {
        const a = words[i]; const b = words[(i + 1) % words.length]; const c = words[(i + 3) % words.length];
        day += 1;
        await workspace.addObservation(LANE, {
          type: 'exchange',
          userMessage: `tell me about the ${a} and the ${b}`,
          response: `the ${a} holds and the ${b} follows; the ${c} is next`,
          timestamp: new Date(Date.UTC(2026, subject === 'pools' ? 9 : 10, day)).toISOString(),
          ...(i === 0 ? { origin: 'link' } : {}),
        });
      }
    }
    await workspace.addObservation(LANE, {
      type: 'self-note', noteKind: 'fact', content: 'The DKIM selector is google2048 and the DMARC policy starts at none.',
      source: 'self-authored', memoryRef: 'mem_note_0123456789abcdef', timestamp: '2026-11-19T09:00:00.000Z',
    });
    retractedId = (await workspace.addObservation(LANE, {
      type: 'self-note', noteKind: 'note', content: 'The Umbrae router charges no fees on a deposit.',
      source: 'self-authored', timestamp: '2026-10-20T09:00:00.000Z',
    })).id;
    await workspace.invalidateObservation(LANE, retractedId, { lifecycle: 'retracted', reason: 'wrong' });
  }, 60000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  test('the atlas names the topics and counts every memory, set-aside ones included', async () => {
    const res = await get('');
    expect(res.status).toBe(200);
    const atlas = await res.json();
    expect(atlas.totals).toMatchObject({ memories: 17, active: 16, setAside: 1, topics: 2 });
    expect(atlas.topics.map((t) => t.size).reduce((a, b) => a + b, 0) + atlas.totals.ungrouped).toBe(16);
    const names = atlas.topics.map((t) => t.name.toLowerCase()).join(' | ');
    expect(names).toMatch(/pool|umbrae|deposit|wallet|swap|router|fees/);
    expect(names).toMatch(/dkim|dmarc|cloudflare|selector|inbox|postmaster|sender/);
    expect(atlas.kinds.map((k) => k.kind).sort()).toEqual(['conversation', 'fact', 'housemate', 'note']);
    expect(atlas.periods.map((p) => p.key)).toEqual(['2026-11', '2026-10']);
    expect(atlas.memories.find((m) => m.id === retractedId)).toMatchObject({ state: 'retracted', topic: -1 });
    expect(atlas.memories.find((m) => m.id === anchoredId)).toMatchObject({ ref: anchoredRef, kind: 'conversation' });
    // The page carries bounded lines and counts — never a memory's whole text, never the neighbour lists.
    expect(atlas.links).toBeUndefined();
    expect(JSON.stringify(atlas)).not.toContain('places it in the liquidity pool');
  });

  test('another wallet is refused, and so is no wallet', async () => {
    expect((await get('', strangerToken)).status).toBe(403);
    expect((await get('', null)).status).toBe(401);
    expect((await get(`/memory/${anchoredId}`, strangerToken)).status).toBe(403);
    expect((await get('/search?q=dkim', strangerToken)).status).toBe(403);
  });

  test('search finds every memory that holds all the words, set-aside ones too', async () => {
    const found = await (await get('/search?q=umbrae%20router')).json();
    expect(found.words).toEqual(['umbrae', 'router']);
    expect(found.ids).toContain(anchoredId);
    expect(found.ids).toContain(retractedId);
    expect((await (await get('/search?q=google2048')).json()).ids).toHaveLength(1);
    expect((await (await get('/search?q=zeppelin')).json()).ids).toEqual([]);
    expect((await get('/search?q=')).status).toBe(400);
  });

  test('one memory opens with its source, where it came from, and its nearest memories', async () => {
    const res = await get(`/memory/${anchoredId}`);
    expect(res.status).toBe(200);
    const opened = await res.json();
    expect(opened.memory).toMatchObject({ id: anchoredId, ref: anchoredRef });
    expect(opened.topic.name.length).toBeGreaterThan(0);
    expect(opened.lifecycle.state).toBe('active');
    expect(opened.source).toMatchObject({ kind: 'exchange', via: 'live' });
    expect(opened.source.content).toContain('places it in the liquidity pool');
    expect(opened.near.length).toBeGreaterThan(0);
    expect(opened.near[0]).toMatchObject({ line: expect.any(String), w: expect.any(Number) });

    const withdrawn = await (await get(`/memory/${retractedId}`)).json();
    expect(withdrawn.lifecycle).toMatchObject({ state: 'retracted' });
    expect(withdrawn.source.content).toContain('charges no fees');
    expect(withdrawn.near).toEqual([]);

    expect((await get('/memory/not-an-id')).status).toBe(400);
    expect((await get('/memory/0000000000000000')).status).toBe(404);
  });

  test('the being walks the very same atlas with memory_map', async () => {
    const atlas = await (await get('')).json();
    const overview = await walkMemoryMap(LANE, {});
    expect(overview.ok).toBe(true);
    expect(overview.content).toContain('YOUR MEMORY — 17 memories (1 set aside)');
    atlas.topics.forEach((t) => expect(overview.content).toContain(`${t.id + 1}. ${t.name} — ${t.size} memories`));

    const topic = atlas.memories.find((m) => m.id === anchoredId).topic;
    const page = await walkMemoryMap(LANE, { topic: topic + 1, limit: 40 });
    expect(page.content).toContain(anchoredRef);
    const one = await walkMemoryMap(LANE, { memory: anchoredRef });
    expect(one.content).toContain('Nearest memories');
    const aside = await walkMemoryMap(LANE, { state: 'set-aside' });
    expect(aside.content).toContain(`id:${retractedId}`);
    expect(aside.content).toContain('retracted');
    expect(await walkMemoryMap(LANE, { sort: 'sideways' })).toMatchObject({ ok: false });
  });

  test('a new memory redraws the atlas', async () => {
    await workspace.addObservation(LANE, { type: 'self-note', noteKind: 'note', content: 'Postmaster shows the sender reputation for the inbox.', source: 'self-authored' });
    expect((await (await get('')).json()).totals.memories).toBe(18);
  });
});
