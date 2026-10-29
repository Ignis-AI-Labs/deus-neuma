/**
 * /api/v1/marketing/board — over the REAL access guard: two operators who
 * each sign a real wallet challenge (audit-auth.js fullAuth), their houses on
 * a tmp realm with real brand kits (companies) and a real campaign bench. No
 * double (RULE 0).
 *
 * Proven: unsigned is 401; a level with nothing saved reads null (the default
 * board) with the vocabulary; PUT records the operator's board whole, stamped
 * as theirs, and a refused board writes nothing and names every reason; a
 * campaign removed later is dropped from the read and named; DELETE returns
 * the level to its default; and the stranger house can neither read nor
 * write the first house's board — its own board is its own.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { standTwoHouses } from '../helpers/house-office-kit.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { writeReadyBrandKit } from '../helpers/ready-brand-kit.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { setCompanyBlock } from '../../backend/services/marketing/companies.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { campaignContextFor } from '../../backend/services/marketing/campaign-context.js';
import { BOARD_FILE } from '../../backend/services/marketing/board-store.js';
import router from '../../backend/routes/marketing-board-routes.js';

const p = (id, kind, companyId, extra = {}) => ({ id, kind, span: 6, scope: { companyId }, ...extra });

describe('marketing board routes (/api/v1/marketing/board)', () => {
  let houses, app, a, b, campaign, gone;
  const as = (who) => ({ Authorization: `Bearer ${who.token}` });
  const boardFile = (who) => houses.houseFile(who.address, 'offices', 'marketing', BOARD_FILE);

  beforeAll(async () => {
    houses = await standTwoHouses({ label: 'marketing-board-routes' });
    [a, b] = [await fullAuth(), await fullAuth()];
    for (const [who, kits] of [[a, ['northwind', 'northwind-labs']], [b, ['brookmere']]]) {
      const ground = path.join(houses.tmp, `ground-${who.address.slice(2, 8)}`);
      await fs.mkdir(ground, { recursive: true });
      await setHouseWorkspace(who.address, ground);
      for (const kit of kits) await writeReadyBrandKit(ground, kit);
    }
    expect((await setCompanyBlock(a.address, 'northwind-labs', { parentId: 'northwind' })).ok).toBe(true);
    const bench = await campaignStoreFor(a.address);
    const ctx = await campaignContextFor(a.address);
    campaign = await bench.add({ name: 'Launch Week', companyId: 'northwind-labs' }, ctx, a.address);
    gone = await bench.add({ name: 'Old Push', companyId: 'northwind' }, ctx, a.address);
    app = express();
    app.use(express.json());
    app.use('/api/v1/marketing/board', router);
  });
  afterAll(() => houses.restore());

  test('unsigned is refused; a level with nothing saved reads null with the vocabulary', async () => {
    expect((await request(app).get('/api/v1/marketing/board?level=house')).status).toBe(401);
    expect((await request(app).put('/api/v1/marketing/board?level=house').send({ panels: [] })).status).toBe(401);
    expect((await request(app).delete('/api/v1/marketing/board?level=house')).status).toBe(401);
    const res = await request(app).get('/api/v1/marketing/board?level=house').set(as(a));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ level: 'house', board: null, dropped: [], spans: [3, 4, 6, 8, 12] });
    expect(Object.keys(res.body.kinds)).toEqual(['tiles', 'campaign', 'accounts', 'angles', 'posts', 'links', 'platform', 'top-posts', 'funnel', 'next-7-days', 'company-watch', 'cmo-log']);
    expect((await request(app).get('/api/v1/marketing/board').set(as(a))).status).toBe(400);
    expect((await request(app).get('/api/v1/marketing/board?level=../x').set(as(a))).status).toBe(400);
  });

  test('PUT records the board whole, stamped as the operator\'s; a refused board writes nothing and names every reason', async () => {
    const board = [p('tiles', 'tiles', 'northwind', { span: 12 }), p(`campaign:${campaign.id}`, 'campaign', 'northwind', { scope: { companyId: 'northwind', campaignId: campaign.id }, pinned: true }),
      p(`campaign:${gone.id}`, 'campaign', 'northwind', { scope: { companyId: 'northwind', campaignId: gone.id } }), p('posts', 'posts', 'northwind', { span: 12, setBy: 'cmo' })];
    const put = await request(app).put('/api/v1/marketing/board?level=northwind').set(as(a)).send({ panels: board });
    expect(put.status).toBe(200);
    expect(put.body.board.map((x) => [x.id, x.setBy, x.pinned])).toEqual([['tiles', 'operator', false], [`campaign:${campaign.id}`, 'operator', true],
      [`campaign:${gone.id}`, 'operator', false], ['posts', 'operator', false]]);
    const bytes = await fs.readFile(boardFile(a), 'utf8');

    const refused = await request(app).put('/api/v1/marketing/board?level=northwind').set(as(a))
      .send({ panels: [p('links', 'links', 'northwind'), p('c', 'campaign', 'northwind', { scope: { companyId: 'northwind', campaignId: 'nope' } })] });
    expect(refused.status).toBe(400);
    expect(refused.body.reasons).toEqual(['panel 1 (links): a links panel stands on the house\'s board only', 'panel 2 (campaign): there is no campaign "nope" in this house']);
    expect(refused.body.error).toBe(refused.body.reasons.join('; '));
    expect((await request(app).put('/api/v1/marketing/board?level=northwind').set(as(a)).send({})).body.reasons).toEqual(['a board is a list of panels']);
    expect(await fs.readFile(boardFile(a), 'utf8')).toBe(bytes);

    // A campaign removed later drops from the read, and the read names it.
    await (await campaignStoreFor(a.address)).remove(gone.id);
    const read = await request(app).get('/api/v1/marketing/board?level=northwind').set(as(a));
    expect(read.body.board.map((x) => x.id)).toEqual(['tiles', `campaign:${campaign.id}`, 'posts']);
    expect(read.body.dropped).toEqual([{ id: `campaign:${gone.id}`, kind: 'campaign', why: `there is no campaign "${gone.id}" in this house` }]);
  });

  test('the stranger house can neither read nor write this house\'s board; its own is its own', async () => {
    const bytes = await fs.readFile(boardFile(a), 'utf8');
    expect((await request(app).get('/api/v1/marketing/board?level=northwind').set(as(b))).status).toBe(404);
    const put = await request(app).put('/api/v1/marketing/board?level=northwind').set(as(b)).send({ panels: [p('posts', 'posts', 'northwind')] });
    expect(put.status).toBe(404);
    expect(put.body.error).toBe('there is no "northwind" company in this house');
    expect((await request(app).delete('/api/v1/marketing/board?level=northwind').set(as(b))).status).toBe(404);
    // B's house board is B's file; A's never moves.
    expect((await request(app).get('/api/v1/marketing/board?level=house').set(as(b))).body.board).toBeNull();
    expect((await request(app).put('/api/v1/marketing/board?level=house').set(as(b)).send({ panels: [p('links', 'links', null)] })).status).toBe(200);
    expect((await request(app).delete('/api/v1/marketing/board?level=house').set(as(b))).status).toBe(200);
    expect(await fs.readFile(boardFile(a), 'utf8')).toBe(bytes);
    expect((await request(app).get('/api/v1/marketing/board?level=northwind').set(as(a))).body.board).toHaveLength(3);
  });

  test('DELETE returns a level to its default', async () => {
    const res = await request(app).delete('/api/v1/marketing/board?level=northwind').set(as(a));
    expect(res.status).toBe(200);
    expect(res.body.board).toBeNull();
    expect((await request(app).get('/api/v1/marketing/board?level=northwind').set(as(a))).body.board).toBeNull();
    expect((await houses.readJson(boardFile(a))).boards).toEqual({});
  });
});
