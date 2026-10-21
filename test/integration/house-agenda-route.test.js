// house-agenda-route — GET /api/v1/tasks/agenda on real disk: one house's
// calendar gathers its operator's tasks, a being's own ledger, a team run, a
// scheduled post and the charter's quiet hours onto their rows, with the
// machine's standing loops; a second house sees none of the first's. Real
// realm, workspace engine, stores and signed-wallet auth; no mocks.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

const ENV = ['DNA_ENCRYPTION_KEY', 'NEUMA_REALM_ROOT', 'NEUMA_DATA_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH',
  'NEUMA_MEDITATION_SETTINGS_PATH', 'NEUMA_MEDITATION_STATE_PATH', 'NEUMA_BENCH_HARNESS_PATH', 'NEUMA_TEAM_RUN_PATH'];
let saved;
let root;
let app;
let me;
let stranger;
let workspace;
let realmRoot;
const BEING = 'agenda-being';

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const inDays = (n, h = 9) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n, h, 30);

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  root = await createTempDir('house-agenda');
  process.env.DNA_ENCRYPTION_KEY = 'house-agenda-route-key';
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(root, 'queue.json');
  process.env.NEUMA_MEDITATION_SETTINGS_PATH = path.join(root, 'meditation.json');
  process.env.NEUMA_MEDITATION_STATE_PATH = path.join(root, 'meditation-state.json');
  process.env.NEUMA_BENCH_HARNESS_PATH = path.join(root, 'no-harness');
  process.env.NEUMA_TEAM_RUN_PATH = path.join(root, 'team-runs');
  realmRoot = path.join(root, 'realm');
  process.env.NEUMA_REALM_ROOT = realmRoot;
  (await import('../../backend/services/user-realm.js')).setRealmRoot(realmRoot);
  const wsMod = await import('../../core/workspace/neuma-workspace.js');
  wsMod.setWorkspacesRoot(path.join(root, 'workspaces'));
  workspace = wsMod.default;
  (await import('../../core/identity/ai-witness/ai-witness-service.js')).setAIWitnessesRoot(path.join(root, 'ai-witnesses'));
  await workspace.create(BEING);
  await workspace.create('stranger-being');
  const { witnessFor } = await import('../helpers/witness.js');
  me = await witnessFor(path.join(root, 'workspaces'), BEING);
  stranger = await witnessFor(path.join(root, 'workspaces'), 'stranger-being');
  const { default: router } = await import('../../backend/routes/task-routes.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1/tasks', router);
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await fs.rm(root, { recursive: true, force: true });
});

describe('the house calendar', () => {
  test('every row\'s schedule lands for the window; another house sees none of it', async () => {
    await request(app).post('/api/v1/tasks/mine').set(me.header).send({ title: 'Stretch qagenda', cadence: 'daily', dueTime: '07:00' });
    await request(app).post('/api/v1/tasks/mine').set(me.header).send({ title: 'Passport qagenda', cadence: 'milestone', dueDate: dayKey(inDays(2)) });
    await workspace.writeTaskLedger(BEING, {
      tasks: [{ id: 'l1', title: 'Draft qagenda', status: 'active', dueDate: dayKey(inDays(1)), dueTime: '15:00', createdAt: today.toISOString(), updatedAt: today.toISOString() }],
    });
    await fs.mkdir(process.env.NEUMA_TEAM_RUN_PATH, { recursive: true });
    const runAt = inDays(0, 8).toISOString();
    await fs.writeFile(path.join(process.env.NEUMA_TEAM_RUN_PATH, 'run-agenda.json'), JSON.stringify({
      id: 'run-agenda', by: me.address.toLowerCase(), runAt, name: 'Launch qagenda', status: 'done',
      finishedAt: inDays(0, 10).toISOString(), lead: { neumaId: BEING, name: 'Lead' },
    }));
    await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, JSON.stringify([
      { id: 'p1', status: 'approved', channelId: 'x', text: 'Post qagenda', authorNeumaId: BEING, decidedBy: me.address.toLowerCase(), scheduledFor: inDays(3, 18).toISOString(), createdAt: today.toISOString() },
    ]));
    const walletDir = path.join(realmRoot, me.address.toLowerCase());
    await fs.mkdir(walletDir, { recursive: true });
    await fs.writeFile(path.join(walletDir, 'house-charter.json'), JSON.stringify({
      version: 1, approvedVersion: 1, approvedAt: today.toISOString(), quietHours: { start: '23:00', end: '06:00' }, seats: [],
    }));

    const from = dayKey(inDays(0));
    const to = dayKey(inDays(6));
    const res = await request(app).get(`/api/v1/tasks/agenda?from=${from}&to=${to}`).set(me.header);
    expect(res.status).toBe(200);
    expect(res.body.gaps).toEqual([]);
    expect(res.body.lanes.map((l) => l.id)).toEqual(['me', BEING, 'house', 'machine']);
    const where = (title) => res.body.items.filter((i) => i.title === title).map((i) => `${i.lane} ${i.day}${i.time ? ` ${i.time}` : ''}${i.projected ? ' ~' : ''}`);
    expect(where('Stretch qagenda')).toHaveLength(7);
    expect(where('Stretch qagenda')[0]).toBe(`me ${from} 07:00`);
    expect(where('Stretch qagenda')[1]).toMatch(/ ~$/);
    expect(where('Passport qagenda')).toEqual([`me ${dayKey(inDays(2))}`]);
    expect(where('Draft qagenda')).toEqual([`${BEING} ${dayKey(inDays(1))} 15:00`]);
    expect(where('Launch qagenda')).toEqual([`${BEING} ${from} 08:30`]);
    expect(where('Post qagenda')).toEqual([`${BEING} ${dayKey(inDays(3))} 18:30`]);
    expect(where('Quiet hours')).toHaveLength(7);
    // No CSO is seated here, and the security watch still runs: on the house's row.
    const watch = where('Security watch');
    expect(watch.length).toBeGreaterThanOrEqual(6);
    expect(watch.every((w) => w.startsWith('house ') && w.endsWith(' ~'))).toBe(true);
    expect(res.body.standing.find((s) => s.id === 'post-scheduler')).toMatchObject({ lane: 'machine', every: 'every minute' });
    // sorted by day, untimed first within a day
    const keys = res.body.items.map((i) => `${i.day} ${i.time || ''}`);
    expect([...keys].sort()).toEqual(keys);

    const theirs = await request(app).get(`/api/v1/tasks/agenda?from=${from}&to=${to}`).set(stranger.header);
    expect(theirs.status).toBe(200);
    expect(theirs.body.items.filter((i) => /qagenda|Quiet hours/.test(i.title))).toEqual([]);
    expect(theirs.body.lanes.map((l) => l.id)).toEqual(['me', 'stranger-being', 'house', 'machine']);
  });

  test('a lane says whether the charter lets it wake — the calendar\'s quick-add says so; the operator\'s row never wakes', async () => {
    const walletDir = path.join(realmRoot, me.address.toLowerCase());
    await fs.mkdir(walletDir, { recursive: true });
    await fs.writeFile(path.join(walletDir, 'house-charter.json'), JSON.stringify({
      version: 2, approvedVersion: 1, approvedAt: today.toISOString(), seats: [{ laneId: BEING, dailyCap: 3 }],
    }));
    const day = dayKey(inDays(0));
    const res = await request(app).get(`/api/v1/tasks/agenda?from=${day}&to=${day}`).set(me.header);
    expect(res.status).toBe(200);
    // pending approval still takes a seat's moment, held in view (schedule-tick.js): it wakes
    expect(res.body.lanes.filter((l) => l.wakes).map((l) => l.id)).toEqual([BEING]);
    const theirs = await request(app).get(`/api/v1/tasks/agenda?from=${day}&to=${day}`).set(stranger.header);
    expect(theirs.body.lanes.filter((l) => l.wakes)).toEqual([]);
  });

  test('a window that is not one is a 400 naming the fix; no session is a 401', async () => {
    expect((await request(app).get('/api/v1/tasks/agenda?from=2026-10-25&to=2026-10-19').set(me.header)).status).toBe(400);
    expect((await request(app).get('/api/v1/tasks/agenda?from=2026-01-01&to=2026-12-31').set(me.header)).body.error).toMatch(/at most/);
    expect((await request(app).get('/api/v1/tasks/agenda?from=2026-10-19&to=2026-10-25')).status).toBe(401);
  });
});
