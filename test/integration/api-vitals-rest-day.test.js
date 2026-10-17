// Rest days over the Vitals API — REAL router, REAL realm disk, REAL auth
// (the api-vessel-dailies.test.js harness, RULE 0: no mock anywhere). Proves
// the operator road end to end: a rest day claimed at his word lands in the
// append-only log, the summary says plainly the body is resting and the
// streak HOLDS across it — and the law refuses the rest of it in plain
// words: the fifth day of a month, a claim beside another rest day.

import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';

const dayKey = (iso) => Math.floor(Date.parse(iso) / 86400000);

describe('Vitals API — rest days, recovery the streak honors', () => {
  let app, witness;

  beforeEach(async () => {
    vi.resetModules();

    const realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(await createTempDir('rest-day-realm'));

    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();

    const { default: router } = await import('../../backend/routes/vital-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/vitals', router);
  });

  afterEach(() => vi.restoreAllMocks());

  it('claimed at his word: the log keeps it, the board says resting, the streak holds', async () => {
    const set = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'dailies-set', items: [{ title: 'Pre-desk 15 min' }] });
    expect(set.status).toBe(201);

    const rest = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'rest-day' });
    expect(rest.status).toBe(201);
    expect(rest.body.entry).toMatchObject({ kind: 'rest-day' });
    expect(rest.body.entry.occurredAt).toBeTruthy();

    const sum = await request(app).get('/api/v1/vitals/mine/summary').set(witness.header);
    expect(sum.body.summary.dailies).toMatchObject({ resting: true, restDaysLeft: 3 });
    // The streak counts the rested day — recovery is part of the practice.
    expect(sum.body.summary.streakDays).toBe(1);

    // A second stamp on the same day is refused by name.
    const again = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'rest-day' });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already claimed/);
  });

  it('the fifth rest day of a month refuses, naming the allowance', async () => {
    // Four rests inside the CURRENT calendar month, spaced three days apart —
    // month-day 1, 4, 7, 10 of this month by local wall clock.
    const now = new Date();
    const at = (dayOfMonth) => new Date(now.getFullYear(), now.getMonth(), dayOfMonth, 12, 0, 0).toISOString();
    for (const dom of [1, 4, 7, 10]) {
      const r = await request(app).post('/api/v1/vitals/mine').set(witness.header)
        .send({ kind: 'rest-day', occurredAt: at(dom) });
      expect(r.status).toBe(201);
    }
    const fifth = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'rest-day', occurredAt: at(13) });
    expect(fifth.status).toBe(400);
    expect(fifth.body.error).toMatch(/no rest days left this month/);
  });

  it('a claim beside a standing rest day refuses — the spacing law is symmetric', async () => {
    const now = new Date();
    const at = (offsetDays) => {
      const d = new Date(now);
      d.setDate(d.getDate() + offsetDays);
      d.setHours(12, 0, 0, 0);
      return d.toISOString();
    };
    const first = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'rest-day', occurredAt: at(0) });
    expect(first.status).toBe(201);

    const nextDay = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'rest-day', occurredAt: at(1) });
    expect(nextDay.status).toBe(400);
    expect(nextDay.body.error).toMatch(/too close to another rest day/);

    // Two full training days between: legal again.
    const legal = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'rest-day', occurredAt: at(3) });
    expect(legal.status).toBe(201);
  });
});
