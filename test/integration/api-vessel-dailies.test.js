// Dailies over the Vitals API — REAL router, REAL realm disk, REAL auth
// (the api-vitals.test.js harness). Proves the whole operator road: set the
// dailies (server mints item ids), complete them one by one, and watch the
// summary's board and all-dailies streak move — the "automatic" update IS
// the fold over the real file. Also proves the corrections: an unknown
// daily is refused naming the real list, and a completion before any setup
// is refused plainly.

import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';

describe('Vitals API — dailies and the all-dailies streak', () => {
  let app, witness;

  beforeEach(async () => {
    vi.resetModules();

    const realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(await createTempDir('dailies-realm'));

    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();

    const { default: router } = await import('../../backend/routes/vital-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/vitals', router);
  });

  afterEach(() => vi.restoreAllMocks());

  it('set → complete all → the summary board and streak move', async () => {
    const set = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'dailies-set', items: [{ title: 'Pre-desk 15 min' }, { title: 'Stretch' }] });
    expect(set.status).toBe(201);
    const items = set.body.entry.items;
    expect(items).toHaveLength(2);
    expect(items[0].id).toBeTruthy(); // the server minted ids

    // One down: the board says 1/2, the day is not yet complete.
    await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'daily', dailyId: items[0].id });
    let sum = await request(app).get('/api/v1/vitals/mine/summary').set(witness.header);
    expect(sum.body.summary.dailies).toMatchObject({ done: 1, total: 2 });
    expect(sum.body.summary.streakDays).toBe(0);

    // All down — by title this time (the neuma's road) — the streak counts today.
    const byTitle = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'daily', title: 'stretch' });
    expect(byTitle.status).toBe(201);
    expect(byTitle.body.entry).toMatchObject({ dailyId: items[1].id, title: 'Stretch' });
    sum = await request(app).get('/api/v1/vitals/mine/summary').set(witness.header);
    expect(sum.body.summary.dailies).toMatchObject({ done: 2, total: 2 });
    expect(sum.body.summary.streakDays).toBe(1);
  });

  it('corrections: unknown daily names the real list; completion before setup is refused', async () => {
    const early = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'daily', title: 'stretch' });
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/no dailies/);

    await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'dailies-set', items: [{ title: 'Stretch' }] });
    const unknown = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'daily', title: 'yoga' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/Stretch/);
  });

  // Design note, 2026-09-02: […] The fix
  // road over the REAL route: occurredAt stamps the day the work happened, the
  // note carries the proof-of-work line, and recordedAt stays the honest
  // moment of the logging.
  it('a missed day is marked for the day it happened, proof line attached, streak whole', async () => {
    // The definition must predate the missed day — each day is judged by the
    // definition in force ON that day.
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
    const set = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'dailies-set', items: [{ title: 'Pre-desk 15 min' }], occurredAt: twoDaysAgo.toISOString() });
    expect(set.status).toBe(201);
    const id = set.body.entry.items[0].id;

    const yesterdayNoon = new Date();
    yesterdayNoon.setDate(yesterdayNoon.getDate() - 1);
    yesterdayNoon.setHours(12, 0, 0, 0);
    const fix = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'daily', dailyId: id, occurredAt: yesterdayNoon.toISOString(), note: 'photo in camera roll, 07:12' });
    expect(fix.status).toBe(201);
    expect(fix.body.entry).toMatchObject({
      dailyId: id, occurredAt: yesterdayNoon.toISOString(), note: 'photo in camera roll, 07:12',
    });
    expect(fix.body.entry.recordedAt).not.toBe(fix.body.entry.occurredAt);

    const sum = await request(app).get('/api/v1/vitals/mine/summary').set(witness.header);
    expect(sum.body.summary.streakDays).toBe(1);
  });
});
