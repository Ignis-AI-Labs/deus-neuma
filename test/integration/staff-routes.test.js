/**
 * Staff routes (/api/v1/staff) — the operator's window onto the Optio office,
 * end to end against the REAL designation store, the REAL scaffold, and REAL
 * auth (RULE 0, #390): a real wallet with a real HMAC token proves every
 * request, and a genuine 401 comes from sending none.
 */
import express from 'express';
import request from 'supertest';
import path from 'path';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';

describe('Staff routes (/api/v1/staff)', () => {
  let app, house, witness;
  const saved = {};
  const ENV = ['NEUMA_STAFF_COS_PATH', 'NEUMA_TEAM_RUN_PATH', 'WORKSPACES_ROOT', 'NEUMA_REALM_ROOT'];

  const buildApp = async () => {
    const { default: router } = await import('../../backend/routes/staff-routes.js');
    const a = express();
    a.use(express.json());
    a.use('/api/v1/staff', router);
    return a;
  };

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) { saved[k] = process.env[k]; }

    house = await createTempDir('staff-routes');
    process.env.NEUMA_STAFF_COS_PATH = path.join(house, 'staff-cos.json');
    process.env.NEUMA_TEAM_RUN_PATH = path.join(house, 'team-runs');
    process.env.WORKSPACES_ROOT = path.join(house, 'workspaces');
    // Each house's seat lives in its operator's realm — the realm door is
    // pinned BEFORE the re-import so the live realm is never consulted.
    process.env.NEUMA_REALM_ROOT = path.join(house, 'realm');

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against. THE CALLER MUST OWN
    // THE LANE IT SEATS — against the real gate, a stranger is a 404.
    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(process.env.WORKSPACES_ROOT, 'optiolane');
    app = await buildApp();
  });

  test('GET /activity — who is working, empty when the office is unseated', async () => {
    const res = await request(app)
      .get('/api/v1/staff/activity')
      .set('Authorization', `Bearer ${witness.token}`);
    expect(res.status).toBe(200);
    expect(res.body.working).toEqual([]);
  });

  test('GET /activity — a filed charge names its seat, task, and status', async () => {
    const { fileDispatch } = await import('../../backend/services/staff/dispatch-store.js');
    const { cosDesignation } = await import('../../backend/services/staff/cos-designation.js');
    await cosDesignation.designate(witness.address, 'optiolane');
    await fileDispatch('optiolane', {
      v: 1,
      id: '2026-09-15T04-00-00-000Z',
      from: 'optiolane',
      to: 'crewlane',
      title: 'Draft the ledger report',
      body: 'Done looks like: the report filed.',
      filedAt: '2026-09-15T04:00:00.000Z',
      dueAt: null,
      by: witness.address,
      postId: null,
      boardId: null,
      status: 'working',
      ackAt: '2026-09-15T05:00:00.000Z',
      ackBy: 'crewlane',
      doneAt: null,
      note: '',
      lastCheckedAt: null,
    });
    const res = await request(app)
      .get('/api/v1/staff/activity')
      .set('Authorization', `Bearer ${witness.token}`);
    expect(res.status).toBe(200);
    expect(res.body.working.length).toBe(1);
    const row = res.body.working[0];
    expect(row.neumaId).toBe('crewlane');
    expect(row.status).toBe('working');
    expect(row.task).toBe('Draft the ledger report');
  });

  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  test('the seat: null → seated (office scaffolded on real disk) → cleared', async () => {
    expect((await request(app).get('/api/v1/staff/seat').set(witness.header)).body.cos).toBeNull();
    expect((await request(app).put('/api/v1/staff/seat').set(witness.header).send({})).status).toBe(400);

    const seated = await request(app).put('/api/v1/staff/seat').set(witness.header).send({ laneId: 'optiolane' });
    expect(seated.status).toBe(200);
    expect(seated.body.cos.laneId).toBe('optiolane');
    // The office on disk rides the seat — playbook + the dispatches drawer.
    const dir = path.join(process.env.WORKSPACES_ROOT, 'optiolane', 'staff');
    expect(await fs.readFile(path.join(dir, 'playbook.md'), 'utf8')).toContain('Optio');
    expect((await fs.stat(path.join(dir, 'dispatches'))).isDirectory()).toBe(true);

    expect((await request(app).get('/api/v1/staff/seat').set(witness.header)).body.cos.laneId).toBe('optiolane');
    expect((await request(app).delete('/api/v1/staff/seat').set(witness.header)).body.cos).toBeNull();
    expect((await request(app).get('/api/v1/staff/seat').set(witness.header)).body.cos).toBeNull();
  }, 30000);

  test('the board: unseated reads nulls; seated reads the office snapshot from the real stores', async () => {
    const empty = (await request(app).get('/api/v1/staff/board').set(witness.header)).body;
    expect(empty).toMatchObject({ cos: null, roster: null, posts: null, plan: null, runs: [] });

    await request(app).put('/api/v1/staff/seat').set(witness.header).send({ laneId: 'optiolane' });
    const board = (await request(app).get('/api/v1/staff/board').set(witness.header)).body;
    expect(board.cos.laneId).toBe('optiolane');
    expect(board.posts).toMatchObject({ count: 0, torn: 0, recent: [] });
    expect(board.plan).toBeNull();
    expect(board.runs).toEqual([]);
    // No house ground is set in this stack — the roster reads as no seat.
    expect(board.roster).toBeNull();
  }, 30000);

  test('two operators, two houses: each route reads and moves ONLY its own house\'s Optio', async () => {
    const { witnessFor } = await import('../helpers/witness.js');
    const other = await witnessFor(process.env.WORKSPACES_ROOT, 'wrenlane');
    const mine = await request(app).put('/api/v1/staff/seat').set(witness.header)
      .send({ laneId: 'optiolane', consent: { note: 'Optio said yes in chat.' } });
    expect(mine.body.cos.consent).toEqual({ at: mine.body.cos.designatedAt, note: 'Optio said yes in chat.' });
    // The other house has no Optio of its own — it never sees this one.
    expect((await request(app).get('/api/v1/staff/seat').set(other.header)).body.cos).toBeNull();
    expect((await request(app).get('/api/v1/staff/board').set(other.header)).body.cos).toBeNull();
    // Nor may it seat this house's lane into its own house.
    expect((await request(app).put('/api/v1/staff/seat').set(other.header).send({ laneId: 'optiolane' })).status).toBe(403);

    await request(app).put('/api/v1/staff/seat').set(other.header).send({ laneId: 'wrenlane' });
    expect((await request(app).get('/api/v1/staff/seat').set(other.header)).body.cos.laneId).toBe('wrenlane');
    expect((await request(app).get('/api/v1/staff/seat').set(witness.header)).body.cos.laneId).toBe('optiolane');

    // Clearing one house leaves the other seated.
    await request(app).delete('/api/v1/staff/seat').set(other.header);
    expect((await request(app).get('/api/v1/staff/seat').set(other.header)).body.cos).toBeNull();
    expect((await request(app).get('/api/v1/staff/seat').set(witness.header)).body.cos.laneId).toBe('optiolane');
  }, 30000);

  test('a stranger cannot seat a lane it does not own; no token is a real 401', async () => {
    const { strangerWitness } = await import('../helpers/witness.js');
    const stranger = strangerWitness();
    expect((await request(app).put('/api/v1/staff/seat').set(stranger.header).send({ laneId: 'optiolane' })).status).toBe(403);
    expect((await request(app).get('/api/v1/staff/seat')).status).toBe(401);
    expect((await request(app).get('/api/v1/staff/seat').set(witness.header)).body.cos).toBeNull();
  }, 30000);
});
