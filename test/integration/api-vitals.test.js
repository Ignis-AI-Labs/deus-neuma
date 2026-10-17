// Vitals API — the human vessel record. REAL router, REAL realm disk, REAL
// auth (RULE 0, #390 tranche 4). Nothing is stubbed: the witness carries a
// real HMAC session token through the real requireAuth, and the realm lane
// it lands in is keyed by that token's own address.
// Proves: append/list/summary on a real file, corrections as 400s, and the
// log reading back newest-first with the aggregates folded from it.

import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('Vitals API — the human vessel record', () => {
  let app, realmRoot, witness;

  beforeEach(async () => {
    vi.resetModules();

    const realm = await import('../../backend/services/user-realm.js');
    realmRoot = await createTempDir('vitals-realm');
    realm.setRealmRoot(realmRoot);

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against — the token secret is
    // memoized per module instance, so a stale import would 401 honestly.
    const { strangerWitness } = await import('../helpers/witness.js');
    // No neuma lane on this router; the realm is the witness's own ground,
    // so a real session that claims no workspace is exactly the right shape.
    witness = strangerWitness();

    const { default: router } = await import('../../backend/routes/vital-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/vitals', router);
  });

  afterEach(() => vi.restoreAllMocks());

  it('log → list → summary, persisted on real realm disk', async () => {
    const pr = await request(app).post('/api/v1/vitals/mine').set(witness.header)
      .send({ kind: 'pr', lift: 'Bench Press', weight: 80, reps: 8, unit: 'kg' });
    expect(pr.status).toBe(201);
    expect(pr.body.entry).toMatchObject({ kind: 'pr', lift: 'bench press', weight: 80, reps: 8, unit: 'kg' });
    expect(pr.body.entry.id).toBeTruthy();
    expect(pr.body.entry.recordedAt).toBeTruthy();

    await request(app).post('/api/v1/vitals/mine').set(witness.header).send({ kind: 'session', title: 'Push day', durationMin: 60 });
    await request(app).post('/api/v1/vitals/mine').set(witness.header).send({ kind: 'bodyweight', weight: 82.5, unit: 'kg' });
    await request(app).post('/api/v1/vitals/mine').set(witness.header).send({ kind: 'life', marker: 'sunlight' });

    // The log is a real plaintext file the witness can read.
    const raw = await fs.readFile(path.join(realmRoot, witness.address.toLowerCase(), 'vitals.jsonl'), 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(4);
    expect(raw).toContain('bench press');

    // Newest first on the wire.
    const list = await request(app).get('/api/v1/vitals/mine').set(witness.header);
    expect(list.status).toBe(200);
    expect(list.body.entries).toHaveLength(4);
    expect(list.body.entries[0].kind).toBe('life');
    expect(list.body.entries[3].kind).toBe('pr');

    // The summary folds the real log.
    const sum = await request(app).get('/api/v1/vitals/mine/summary').set(witness.header);
    expect(sum.status).toBe(200);
    expect(sum.body.summary.total).toBe(4);
    expect(sum.body.summary.prs[0]).toMatchObject({ lift: 'bench press', weight: 80, reps: 8 });
    expect(sum.body.summary.sessions).toMatchObject({ total: 1, lastTitle: 'Push day', perWeek: 1 });
    expect(sum.body.summary.bodyweight.latest.weight).toBe(82.5);
    expect(sum.body.summary.markersToday).toEqual(['sunlight']);
  });

  it('corrections arrive as 400s with the fix named', async () => {
    const badKind = await request(app).post('/api/v1/vitals/mine').set(witness.header).send({ kind: 'vibe' });
    expect(badKind.status).toBe(400);
    expect(badKind.body.error).toMatch(/kind must be one of/);

    const noLift = await request(app).post('/api/v1/vitals/mine').set(witness.header).send({ kind: 'pr', weight: 80, unit: 'kg' });
    expect(noLift.status).toBe(400);
    expect(noLift.body.error).toMatch(/lift name/);

    const badUnit = await request(app).post('/api/v1/vitals/mine').set(witness.header).send({ kind: 'pr', lift: 'squat', weight: 100, unit: 'stone' });
    expect(badUnit.status).toBe(400);

    // A refused write leaves no trace on disk.
    expect((await request(app).get('/api/v1/vitals/mine').set(witness.header)).body.entries).toEqual([]);
  });
});
