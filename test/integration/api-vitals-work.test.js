// Vitals work API — structured sessions and planned entries over the REAL
// router, REAL realm disk, REAL auth (RULE 0, #390): the witness carries a
// real HMAC session token through the real requireAuth. Proves a session's
// sets fold onto the summary's PR board, a planned entry lands on the log,
// and malformed exercises/plans answer 400 with the correction named.

import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('Vitals work API — structured sessions and plans', () => {
  let app, realmRoot, witness;

  beforeEach(async () => {
    vi.resetModules();

    const realm = await import('../../backend/services/user-realm.js');
    realmRoot = await createTempDir('vitals-work-realm');
    realm.setRealmRoot(realmRoot);

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against.
    const { strangerWitness } = await import('../helpers/witness.js');
    witness = strangerWitness();

    const { default: router } = await import('../../backend/routes/vital-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/vitals', router);
  });

  afterEach(() => vi.restoreAllMocks());

  it('a session with exercises folds its weighted sets onto the PR board', async () => {
    const pr = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'pr', lift: 'bench press', weight: 80, reps: 8, unit: 'kg' });
    expect(pr.status).toBe(201);

    const session = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({
        kind: 'session', title: 'Push day', durationMin: 60,
        exercises: [
          { lift: 'Bench Press', sets: [{ reps: 5, weight: 90, unit: 'kg' }, { reps: 8, weight: 82.5, unit: 'kg' }] },
          { lift: 'Dip', sets: [{ reps: 12 }, { reps: 10 }] },
        ],
      });
    expect(session.status).toBe(201);
    expect(session.body.entry.exercises).toEqual([
      { lift: 'bench press', sets: [{ reps: 5, weight: 90, unit: 'kg' }, { reps: 8, weight: 82.5, unit: 'kg' }] },
      { lift: 'dip', sets: [{ reps: 12 }, { reps: 10 }] },
    ]);

    // The set that outlifts the declared PR is the record; the unweighted dip
    // never stands on the board.
    const sum = await request(app).get('/api/v1/vitals/mine/summary').set(witness.header);
    expect(sum.status).toBe(200);
    expect(sum.body.summary.prs).toEqual([
      expect.objectContaining({ lift: 'bench press', weight: 90, reps: 5, unit: 'kg' }),
    ]);

    // The stored line on real disk carries the normalized exercises.
    const raw = await fs.readFile(path.join(realmRoot, witness.address.toLowerCase(), 'vitals.jsonl'), 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(2);
    expect(raw).toContain('"lift":"bench press"');
  });

  it('a planned entry lands on the log with its real date', async () => {
    const planned = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({
        kind: 'planned', title: 'Heavy pull', scheduledFor: '2026-09-01',
        exercises: [{ lift: 'Deadlift', sets: [{ reps: 5, weight: 180, unit: 'kg' }] }],
        note: 'last heavy day before travel',
      });
    expect(planned.status).toBe(201);
    expect(planned.body.entry).toMatchObject({
      kind: 'planned', title: 'Heavy pull', scheduledFor: '2026-09-01',
    });
    expect('durationMin' in planned.body.entry).toBe(false);

    const list = await request(app).get('/api/v1/vitals/mine').set(witness.header);
    expect(list.status).toBe(200);
    expect(list.body.entries[0]).toMatchObject({ kind: 'planned', scheduledFor: '2026-09-01' });

    // A plan is not work done: it feeds neither the session count nor the PR
    // board until a session (optionally carrying its planId) says it happened.
    const sum = await request(app).get('/api/v1/vitals/mine/summary').set(witness.header);
    expect(sum.body.summary.sessions.total).toBe(0);
    expect(sum.body.summary.prs).toEqual([]);

    const done = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'session', title: 'Heavy pull', planId: planned.body.entry.id,
        exercises: [{ lift: 'deadlift', sets: [{ reps: 5, weight: 180, unit: 'kg' }] }] });
    expect(done.status).toBe(201);
    expect(done.body.entry.planId).toBe(planned.body.entry.id);
  });

  it('malformed exercises and plans answer 400 with the fix named', async () => {
    const post = (body) => request(app).post('/api/v1/vitals/mine').set(witness.header).send(body);

    const unitNoWeight = await post({ kind: 'session', title: 'x', exercises: [{ lift: 'squat', sets: [{ reps: 5, unit: 'kg' }] }] });
    expect(unitNoWeight.status).toBe(400);
    expect(unitNoWeight.body.error).toMatch(/unit needs the set's weight/);

    const weightNoUnit = await post({ kind: 'session', title: 'x', exercises: [{ lift: 'squat', sets: [{ reps: 5, weight: 100 }] }] });
    expect(weightNoUnit.status).toBe(400);
    expect(weightNoUnit.body.error).toMatch(/needs its unit/);

    const tooManySets = await post({ kind: 'session', title: 'x', exercises: [{ lift: 'squat', sets: Array(21).fill({ reps: 1 }) }] });
    expect(tooManySets.status).toBe(400);
    expect(tooManySets.body.error).toMatch(/20 sets or fewer/);

    const notArray = await post({ kind: 'session', title: 'x', exercises: 'lots' });
    expect(notArray.status).toBe(400);
    expect(notArray.body.error).toMatch(/exercises must be an array/);

    const badDate = await post({ kind: 'planned', title: 'x', scheduledFor: 'next tuesday' });
    expect(badDate.status).toBe(400);
    expect(badDate.body.error).toMatch(/YYYY-MM-DD/);

    const unrealDate = await post({ kind: 'planned', title: 'x', scheduledFor: '2026-02-30' });
    expect(unrealDate.status).toBe(400);
    expect(unrealDate.body.error).toMatch(/real calendar date/);

    // Refused writes leave no trace on disk.
    expect((await request(app).get('/api/v1/vitals/mine').set(witness.header)).body.entries).toEqual([]);
  });
});
