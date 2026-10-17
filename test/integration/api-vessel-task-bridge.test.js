// The vessel ⇄ task bridge over the REAL stack — REAL routers (tasks +
// vitals), REAL realm disk, REAL encrypted sovereign workspace, REAL auth
// (the api-tasks.test.js harness: signed session tokens, never a mock —
// RULE 0). Proves Founder's 2026-08-31 law end to end: a vessel-flagged daily on
// the operator's OWN list (the ME lane) marks the vessel log when settled,
// the flag round-trips the API, a non-vessel daily touches nothing, a
// same-day restamp never double-marks, and the definition sync is the UNION
// of the being-ledger dailies and the ME vessel dailies.

import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

const KEY = 'gnosis-vessel-bridge-key-long-enough-ok';

describe('Vessel task bridge — the ME lane settles into the vessel log', () => {
  let app, workspace, realmRoot, workspacesRoot, neumaId, witness;
  let prevKey;

  beforeEach(async () => {
    vi.resetModules();
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;

    const { witnessFor } = await import('../helpers/witness.js');

    const realm = await import('../../backend/services/user-realm.js');
    realmRoot = await createTempDir('vbridge-realm');
    realm.setRealmRoot(realmRoot);

    const wsMod = await import('../../core/workspace/neuma-workspace.js');
    workspace = wsMod.default;
    workspacesRoot = path.join(await createTempDir('vbridge-ws'), 'workspaces');
    wsMod.setWorkspacesRoot(workspacesRoot);
    neumaId = 'vbridge-being-' + Math.random().toString(36).slice(2, 10);
    await workspace.create(neumaId);
    witness = await witnessFor(workspacesRoot, neumaId);

    const { default: taskRouter } = await import('../../backend/routes/task-routes.js');
    const { default: vitalRouter } = await import('../../backend/routes/vital-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/tasks', taskRouter);
    app.use('/api/v1/vitals', vitalRouter);
  });

  afterEach(() => {
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  const vitalsRaw = () =>
    fs.readFile(path.join(realmRoot, witness.address.toLowerCase(), 'vitals.jsonl'), 'utf8');

  it('a vessel-flagged daily settles into the vitals log and moves the streak', async () => {
    const added = await request(app).post('/api/v1/tasks/mine').set(witness.header)
      .send({ title: 'Morning run', cadence: 'daily', vessel: true });
    expect(added.status).toBe(201);
    expect(added.body.task.vessel).toBe(true);

    const done = await request(app).patch(`/api/v1/tasks/mine/${added.body.task.id}`).set(witness.header)
      .send({ status: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.vesselLogged).toBe(true);

    // The completion really landed — the summary's board and streak moved.
    const sum = await request(app).get('/api/v1/vitals/mine/summary').set(witness.header);
    expect(sum.body.summary.dailies).toMatchObject({ done: 1, total: 1 });
    expect(sum.body.summary.streakDays).toBe(1);

    // And the append-only log on real disk holds the daily mark.
    const raw = await vitalsRaw();
    expect(raw).toContain('"kind":"daily"');
    expect(raw).toContain('Morning run');
  });

  it('a non-vessel daily settle does NOT touch the vitals log', async () => {
    const added = await request(app).post('/api/v1/tasks/mine').set(witness.header)
      .send({ title: 'Read ten pages', cadence: 'daily' });
    expect(added.status).toBe(201);

    const done = await request(app).patch(`/api/v1/tasks/mine/${added.body.task.id}`).set(witness.header)
      .send({ status: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.vesselLogged).toBeUndefined();

    const sum = await request(app).get('/api/v1/vitals/mine/summary').set(witness.header);
    expect(sum.body.summary.total).toBe(0);
    expect(sum.body.summary.dailies).toBeNull();
  });

  it('twice the same day never double-marks — the restamp is a no-op', async () => {
    const added = await request(app).post('/api/v1/tasks/mine').set(witness.header)
      .send({ title: 'Stretch', cadence: 'daily', vessel: true });
    const id = added.body.task.id;

    await request(app).patch(`/api/v1/tasks/mine/${id}`).set(witness.header).send({ status: 'done' });
    // Reopen and settle again the same day.
    await request(app).patch(`/api/v1/tasks/mine/${id}`).set(witness.header).send({ status: 'open' });
    const again = await request(app).patch(`/api/v1/tasks/mine/${id}`).set(witness.header).send({ status: 'done' });
    expect(again.status).toBe(200);

    const entries = (await vitalsRaw()).trim().split('\n').map((l) => JSON.parse(l));
    expect(entries.filter((e) => e.kind === 'daily' && e.dailyId === id)).toHaveLength(1);
    const sum = await request(app).get('/api/v1/vitals/mine/summary').set(witness.header);
    expect(sum.body.summary.dailies).toMatchObject({ done: 1, total: 1 });
    expect(sum.body.summary.streakDays).toBe(1);
  });

  it('the vessel flag round-trips POST / GET / PATCH, and non-boolean is a 400', async () => {
    const bad = await request(app).post('/api/v1/tasks/mine').set(witness.header)
      .send({ title: 'x', cadence: 'daily', vessel: 'yes' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/vessel must be true or false/);

    const added = await request(app).post('/api/v1/tasks/mine').set(witness.header)
      .send({ title: 'Sunlight', cadence: 'daily', vessel: true });
    const id = added.body.task.id;
    let list = await request(app).get('/api/v1/tasks/mine').set(witness.header);
    expect(list.body.plan.tasks.find((t) => t.id === id).vessel).toBe(true);

    const cleared = await request(app).patch(`/api/v1/tasks/mine/${id}`).set(witness.header)
      .send({ vessel: false });
    expect(cleared.status).toBe(200);
    expect('vessel' in cleared.body.task).toBe(false);

    const reset = await request(app).patch(`/api/v1/tasks/mine/${id}`).set(witness.header)
      .send({ vessel: true });
    expect(reset.body.task.vessel).toBe(true);
    list = await request(app).get('/api/v1/tasks/mine').set(witness.header);
    expect(list.body.plan.tasks.find((t) => t.id === id).vessel).toBe(true);
  });

  it('the definition sync is the UNION: being-ledger dailies plus ME vessel dailies', async () => {
    // The being's own ledger holds two dailies (real encrypted workspace).
    const { addTask } = await import('../../core/tasks/task-ledger.js');
    const NOW = new Date().toISOString();
    await workspace.updateTaskLedger(neumaId, (s) =>
      addTask(s, { title: 'Ledger daily one', cadence: 'daily' }, { id: '11111111-1111-4111-8111-111111111111', now: NOW }).ledger);
    await workspace.updateTaskLedger(neumaId, (s) =>
      addTask(s, { title: 'Ledger daily two', cadence: 'daily' }, { id: '22222222-2222-4222-8222-222222222222', now: NOW }).ledger);

    // The operator's own list: one vessel daily, one plain daily.
    const mineVessel = await request(app).post('/api/v1/tasks/mine').set(witness.header)
      .send({ title: 'My vessel daily', cadence: 'daily', vessel: true });
    await request(app).post('/api/v1/tasks/mine').set(witness.header)
      .send({ title: 'My plain daily', cadence: 'daily' });

    // The real sync, lane in hand.
    const { ensureDerivedDailies } = await import('../../backend/services/vessel-daily-bridge.js');
    const items = await ensureDerivedDailies({ wallet: witness.address, neumaId });

    expect(items.map((i) => i.title)).toEqual([
      'Ledger daily one', 'Ledger daily two', 'My vessel daily',
    ]);

    // The snapshot on the log carries the union — and NOT the plain daily.
    const entries = (await vitalsRaw()).trim().split('\n').map((l) => JSON.parse(l));
    const snapshot = [...entries].reverse().find((e) => e.kind === 'dailies-set');
    expect(snapshot.via).toBe('task-ledger');
    expect(snapshot.items.map((i) => i.id).sort()).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      mineVessel.body.task.id,
    ].sort());
    expect(snapshot.items.some((i) => i.title === 'My plain daily')).toBe(false);

    // And the vitals summary's board now reads all three.
    const sum = await request(app).get('/api/v1/vitals/mine/summary').set(witness.header);
    expect(sum.body.summary.dailies).toMatchObject({ done: 0, total: 3 });
  });
});
