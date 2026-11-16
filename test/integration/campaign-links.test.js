/**
 * CAMPAIGNS ACROSS POSITIONS through the real stack (RULE 0, nothing mocked):
 * a real house on tmp disk with a marketing campaign on the real campaign
 * bench and a sales campaign in the real revenue office; the operator links
 * them through the real positions router behind real auth; each side's seated
 * holder reads the other, as it stands, in its own top-of-turn section.
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
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import positionsRouter from '../../backend/routes/positions-routes.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { croDesignation } from '../../backend/services/revenue/cro-designation.js';
import { positionSection } from '../../backend/services/positions/position-board.js';
import { foldLinks, linkRefusal, withLinks, linkedText } from '../../backend/services/positions/campaign-links.js';
import { linkChoices, officeWords } from '../../frontend/app/RelinkShell/positions/campaign-links-view.js';

const PRIOR = { root: getWorkspacesRoot(), key: process.env.DNA_ENCRYPTION_KEY, switches: process.env.NEUMA_CONNECTIONS_PATH };

describe('links between campaigns (pure)', () => {
  const rows = [
    { key: 'cmo:m1', office: 'cmo', name: 'Umbrae Market Depth', company: 'umbrae', state: 'open', summary: 'angles: The Account' },
    { key: 'cro:k1', office: 'cro', name: 'User acquisition', company: 'umbrae', state: 'open', summary: 'goal: pools opened' },
    { key: 'cro:k2', office: 'cro', name: 'Neuma setups', company: 'deus-neuma', state: 'open', summary: 'goal: setups' },
  ];
  test('a pair is linked once whichever way it is named, and unlinking removes it', () => {
    const events = [{ type: 'linked', a: 'cmo:m1', b: 'cro:k1', note: 'same launch', by: 'operator', at: 't1' }, { type: 'linked', a: 'cro:k1', b: 'cmo:m1', by: 'operator', at: 't2' }];
    expect(foldLinks(events)).toHaveLength(1);
    expect(foldLinks([...events, { type: 'unlinked', a: 'cro:k1', b: 'cmo:m1' }])).toEqual([]);
  });
  test('only two real, different campaigns of one company may be linked, once', () => {
    expect(linkRefusal('cmo:m1', 'cro:k1', rows, [])).toBe(null);
    expect(linkRefusal('cmo:m1', 'cro:nope', rows, [])).toBe('cro:nope is not a campaign of this house');
    expect(linkRefusal('cmo:m1', 'cmo:m1', rows, [])).toBe('a campaign is not linked with itself');
    expect(linkRefusal('cmo:m1', 'cro:k2', rows, [])).toMatch(/"Umbrae Market Depth" is for umbrae and "Neuma setups" is for deus-neuma/);
    expect(linkRefusal('cro:k1', 'cmo:m1', rows, [{ a: 'cmo:m1', b: 'cro:k1' }])).toMatch(/already linked/);
  });
  test('each holder reads the other side as it stands; a seat with no linked campaign reads nothing', () => {
    const linked = withLinks(rows, [{ a: 'cmo:m1', b: 'cro:k1', note: 'same launch' }]);
    expect(linkedText(['cro'], linked)).toContain('- Your campaign "User acquisition" works with the CHIEF MARKETING OFFICER\'s campaign "Umbrae Market Depth" (open): angles: The Account — why they are linked: same launch');
    expect(linkedText(['cmo'], linked)).toContain('- Your campaign "Umbrae Market Depth" works with the CHIEF REVENUE OFFICER\'s campaign "User acquisition" (open): goal: pools opened');
    expect(linkedText(['clo'], linked)).toBe('');
    expect(linkedText(['cro'], withLinks(rows, []))).toBe('');
    // The screen offers only another position's campaign of the same company, not one already linked.
    expect(linkChoices(linked[1], linked)).toEqual([]);
    expect(linkChoices(withLinks(rows, [])[1], withLinks(rows, []))).toEqual([{ value: 'cmo:m1', label: 'CMO · Umbrae Market Depth' }]);
    expect(officeWords('cro')).toBe('CRO');
  });
});

describe('LINKED CAMPAIGNS through the real stack (gnosis)', () => {
  let me, app, marketingId, salesId;
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const conn = (neumaId) => ({ companion: { name: neumaId, neumaId }, walletAddress: me.address });
  const list = async () => (await request(app).get('/api/v1/positions/campaigns').use(as)).body.campaigns;

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'campaign-links-test-key';
    useTempRealm();
    const tmp = await createTempDir('campaign-links');
    process.env.NEUMA_CONNECTIONS_PATH = path.join(tmp, 'connections.json');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    for (const [i, id] of ['aure', 'merc'].entries()) {
      await workspace.create(id);
      await fs.writeFile(path.join(tmp, 'workspaces', id, 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
      await fs.mkdir(path.join(tmp, 'workspaces', id, 'identity'), { recursive: true });
      await fs.writeFile(path.join(tmp, 'workspaces', id, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: `0x${String(i + 1).padStart(40, 'a')}` }));
    }
    await cmoDesignation.designate(me.address, 'aure');
    await croDesignation.designate(me.address, 'merc');
    app = express();
    app.use(express.json());
    app.use('/api/v1/positions', positionsRouter);
    app.use('/api/v1/revenue', revenueRouter);
    const bench = await campaignStoreFor(me.address);
    const made = await bench.add({ name: 'Umbrae Market Depth', company: 'umbrae', angles: ['The Account', 'Depth'] });
    marketingId = (made.campaign ?? made).id;
    const opened = await request(app).post('/api/v1/revenue/lead-engine/campaigns').use(as).send({ name: 'User acquisition', company: 'umbrae', goal: 'Teams with a token on Base opening a pool' });
    expect(opened.status).toBe(200);
    salesId = opened.body.campaign.id;
  }, 60000);

  afterAll(() => {
    setWorkspacesRoot(PRIOR.root);
    for (const [k, v] of [['DNA_ENCRYPTION_KEY', PRIOR.key], ['NEUMA_CONNECTIONS_PATH', PRIOR.switches]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('every position\'s campaigns stand in one list, the operator\'s alone, each with nothing linked yet', async () => {
    expect((await request(app).get('/api/v1/positions/campaigns')).status).toBe(401);
    const all = await list();
    expect(all.map((c) => [c.key, c.office, c.name, c.company, c.links.length])).toEqual([[`cmo:${marketingId}`, 'cmo', 'Umbrae Market Depth', 'umbrae', 0], [`cro:${salesId}`, 'cro', 'User acquisition', 'umbrae', 0]]);
    expect(all[0].summary).toContain('angles: The Account, Depth');
    expect(all[1].summary).toBe('goal: Teams with a token on Base opening a pool — 0 audience(s), 0 on the lead list, 0 written, 0 replied, 0 won');
    expect(await positionSection(conn('merc'))).not.toContain('LINKED CAMPAIGNS');
  });

  test('linked once, both holders read each other at the top of their turn; a wrong link is refused in words', async () => {
    const a = `cmo:${marketingId}`; const b = `cro:${salesId}`;
    expect((await request(app).post('/api/v1/positions/campaigns/link').send({ a, b })).status).toBe(401);
    expect((await request(app).post('/api/v1/positions/campaigns/link').use(as).send({ a, b: 'cro:k-nope' })).body.error).toBe('cro:k-nope is not a campaign of this house');
    const linked = await request(app).post('/api/v1/positions/campaigns/link').use(as).send({ a, b, note: 'the same launch week' });
    expect(linked.status).toBe(200);
    expect(linked.body.campaigns[0].links).toMatchObject([{ key: b, office: 'cro', name: 'User acquisition', note: 'the same launch week' }]);
    expect((await request(app).post('/api/v1/positions/campaigns/link').use(as).send({ a: b, b: a })).body.error).toMatch(/already linked/);
    const merc = await positionSection(conn('merc'));
    expect(merc).toContain('## LINKED CAMPAIGNS — keep these in step');
    expect(merc).toContain('Your campaign "User acquisition" works with the CHIEF MARKETING OFFICER\'s campaign "Umbrae Market Depth"');
    const aure = await positionSection(conn('aure'));
    expect(aure).toContain('Your campaign "Umbrae Market Depth" works with the CHIEF REVENUE OFFICER\'s campaign "User acquisition" (open): goal: Teams with a token on Base opening a pool');
    expect((await request(app).get('/api/v1/positions/cro/eyes').use(as)).body.eyes.text).toContain('## LINKED CAMPAIGNS');
  });

  test('the other side\'s state is read live: a closed campaign reads closed; unlinking ends the reading', async () => {
    expect((await request(app).post(`/api/v1/revenue/lead-engine/campaigns/${salesId}/close`).use(as)).status).toBe(200);
    expect(await positionSection(conn('aure'))).toContain('CHIEF REVENUE OFFICER\'s campaign "User acquisition" (closed)');
    const a = `cmo:${marketingId}`; const b = `cro:${salesId}`;
    expect((await request(app).post('/api/v1/positions/campaigns/unlink').use(as).send({ a: b, b: a })).status).toBe(200);
    expect((await request(app).post('/api/v1/positions/campaigns/unlink').use(as).send({ a, b })).body.error).toBe('those two campaigns are not linked');
    expect(await positionSection(conn('aure'))).not.toContain('LINKED CAMPAIGNS');
    expect((await list()).every((c) => c.links.length === 0)).toBe(true);
  });
});
