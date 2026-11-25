/**
 * GATHER FROM A PUBLIC LIST ON THE OPERATOR'S PRESS (backend/services/sales/list-gather.js, routes/lead-run-routes.js)
 * — Design note, 2026-11-21, after a run stopped on a pool of the wrong companies while the audience's best source held
 * hundreds it had never been asked for. One press takes every protocol on Base the house has not seen — not 25 a
 * gather — through the sales member's own act, as the seat; it stands in the ACTIVE list while it works, the operator
 * is told when it ends, and the audience's standing says the list is one press away. The list is served from this
 * machine in DefiLlama's shape; a real house on tmp disk, real routes behind real auth (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { fileSegment, setSegmentState, readCandidates, addProspects } from '../../backend/services/sales/sales-store.js';
import { makeSegment } from '../../backend/services/sales/segment-shape.js';
import { makeProspect } from '../../backend/services/sales/prospect-shape.js';
import { activeWork } from '../../backend/services/active-work.js';
import { PROTOCOLS_GATHER_MAX, TOKENS_GATHER_MAX, GATHER_MAX } from '../../backend/services/sales/lead-sources.js';

const KEYS = ['DNA_ENCRYPTION_KEY', 'NEUMA_LEAD_SOURCE_LLAMA', 'NEUMA_CONNECTIONS_PATH'];
const SAVED = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const PRIOR_ROOT = getWorkspacesRoot();
// Sixty protocols that live on Base, and two that do not count: one mostly elsewhere, one an exchange.
const PROTOCOLS = [
  ...Array.from({ length: 60 }, (_, i) => ({ name: `Proto ${i + 1}`, url: `https://proto${i + 1}.example`, symbol: `P${i + 1}`, description: `A lending market on Base, number ${i + 1}.`, chains: ['Base'], category: 'Lending', tvl: 1000 * (61 - i), chainTvls: { Base: 1000 * (61 - i) }, twitter: `proto${i + 1}` })),
  { name: 'Mostly Elsewhere', url: 'https://elsewhere.example', chains: ['Ethereum', 'Base'], category: 'Dexs', tvl: 1_000_000, chainTvls: { Base: 10, Ethereum: 999_990 } },
  { name: 'An Exchange', url: 'https://exchange.example', chains: ['Base'], category: 'CEX', tvl: 5_000_000, chainTvls: { Base: 5_000_000 } },
];

describe('one press gathers every new company a free public list gives', () => {
  let me, app, list, switches, segment, held = null;
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const standing = async () => (await request(app).get('/api/v1/revenue/lead-engine/run/standing').use(as)).body;
  const gather = (body) => request(app).post('/api/v1/revenue/lead-engine/gather-list').use(as).send(body);
  const settled = () => expect.poll(async () => (await standing()).gathers.some((g) => g.active), { timeout: 15000 }).toBe(false);

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'list-gather-test-key';
    useTempRealm();
    const tmp = await createTempDir('list-gather');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    await workspace.create('merc');
    await fs.writeFile(path.join(tmp, 'workspaces', 'merc', 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
    await fs.mkdir(path.join(tmp, 'workspaces', 'merc', 'identity'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'workspaces', 'merc', 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: `0x${'d'.repeat(40)}` }));
    const api = express();
    // The list answers when the test lets it, so the gather is seen working.
    api.get('/llama/protocols', (req, res) => { const send = () => res.json(PROTOCOLS); if (held) held.push(send); else send(); });
    list = await new Promise((resolve) => { const s = api.listen(0, '127.0.0.1', () => resolve(s)); });
    process.env.NEUMA_LEAD_SOURCE_LLAMA = `http://127.0.0.1:${list.address().port}/llama`;
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
    expect((await request(app).put('/api/v1/revenue/seat').use(as).send({ laneId: 'merc' })).status).toBe(200);
    const now = new Date().toISOString();
    segment = makeSegment({ name: 'Token projects on Base', offer: 'A pool for your token', company: 'umbrae', customerProblem: 'Thin liquidity', targetRole: 'Founder', targetGeography: 'Worldwide', countries: ['US'],
      positiveCriteria: ['Its token or protocol is live on Base'], why: 'They need depth', by: 'merc', now });
    await fileSegment(me.address, segment);
    await setSegmentState(me.address, segment.id, 'approved', 'operator');
  }, 60000);

  afterAll(async () => {
    switches?.restore();
    await new Promise((resolve) => list.close(resolve));
    setWorkspacesRoot(PRIOR_ROOT);
    for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('the lists a press gathers from, and what refuses one', async () => {
    expect([GATHER_MAX, PROTOCOLS_GATHER_MAX, TOKENS_GATHER_MAX]).toEqual([25, 500, 100]);
    expect((await request(app).post('/api/v1/revenue/lead-engine/gather-list').send({ segment: segment.id, source: 'base-protocols' })).status).toBe(401);
    // LEAD SOURCES is off until the operator turns it on: nothing is asked of any list.
    expect((await gather({ segment: segment.id, source: 'base-protocols' })).body.error).toMatch(/LEAD SOURCES connection is off/);
    switches = connectionsOn(['lead-sources']);
    expect((await standing()).lists).toEqual([{ source: 'base-protocols', name: 'Base protocols list', max: 500 }, { source: 'base-tokens', name: 'Base tokens list', max: 100 }]);
    expect((await gather({ segment: segment.id, source: 'apollo-discover' })).body.error).toBe('a press gathers from a public list: Base protocols list, Base tokens list. A search by words is your sales member\'s to ask');
    expect((await gather({ segment: 's-nope', source: 'base-protocols' })).body.error).toMatch(/not one of your audiences/);
  });

  test('one press takes all sixty new protocols, not twenty-five; it is seen working; a second press finds nothing new', async () => {
    held = [];
    const started = await gather({ segment: segment.id, source: 'base-protocols' });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.gather).toMatchObject({ segmentId: segment.id, segment: 'Token projects on Base', source: 'base-protocols', name: 'Base protocols list', active: true });
    await expect.poll(() => held.length, { timeout: 10000 }).toBe(1);
    expect(activeWork(me.address)).toEqual([expect.objectContaining({ kind: 'GATHER', title: 'Gathering from Base protocols list — Token projects on Base' })]);
    expect((await gather({ segment: segment.id, source: 'base-protocols' })).body.error).toBe('a gather from Base protocols list is already working for this audience');
    held.splice(0).forEach((send) => send());
    held = null;
    await settled();
    expect(activeWork(me.address)).toEqual([]);
    const got = await readCandidates(me.address);
    expect(got).toHaveLength(60);
    expect(got.every((c) => c.segmentId === segment.id && c.source === 'base-protocols' && c.state === 'waiting')).toBe(true);
    expect(got.map((c) => c.domain)).not.toContain('elsewhere.example');
    const after = await standing();
    expect(after.gathers[0]).toMatchObject({ active: false, ok: true, words: expect.stringMatching(/^60 new candidate\(s\) for "Token projects on Base" from base-protocols/) });
    expect(after.audiences.find((a) => a.id === segment.id)).toMatchObject({ waiting: 60, next: { kind: 'run' } });
    // Nothing is gathered twice.
    expect((await gather({ segment: segment.id, source: 'base-protocols' })).status).toBe(200);
    await settled();
    expect((await standing()).gathers[0]).toMatchObject({ ok: false, words: expect.stringMatching(/Nothing new was gathered from base-protocols/) });
    expect(await readCandidates(me.address)).toHaveLength(60);
  });

  test('once a list has given the audience fits, its standing says the list is one press away', async () => {
    const now = new Date().toISOString();
    await addProspects(me.address, [makeProspect({ segment, domain: 'proto1.example', name: 'Proto 1', country: 'US', source: 'https://proto1.example/', scores: [{ criterion: 'Its token or protocol is live on Base', score: 5, reasoning: 'its page says it is live on Base' }], by: 'merc', now })]);
    const a = (await standing()).audiences.find((x) => x.id === segment.id);
    expect(a.lists).toEqual([{ source: 'base-protocols', name: 'Base protocols list', fit: 1, scored: 1, waiting: 59 }]);
    expect(a.next.words).toMatch(/ FREE AND ONE PRESS AWAY: gather more from Base protocols list \(1 of 1 a fit, 59 waiting\) below\.$/);
  });
});
