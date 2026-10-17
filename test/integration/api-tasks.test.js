// Tasks API — the witness's lists for self and house neuma. REAL router,
// REAL encrypted sovereign workspace, REAL realm disk (RULE 0); only auth is
// stubbed (the sanctioned route-test passthrough — auth itself is covered by
// its own enforcement tests). Proves: both lanes' CRUD, ownership gating,
// corrections as 400s, encryption at rest, lazy recurrence persisting on
// read, and the load-bearing half — the lists ride the prompt sections.

import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';

const KEY = 'gnosis-tasks-routes-key-long-enough-ok';

describe('Tasks API — witness lists for self and house neuma', () => {
  let app, workspace, setWorkspacesRoot, workspacesRoot, realmRoot, neumaId;
  let prevKey, witnessFor, strangerWitness, witness;

  beforeEach(async () => {
    vi.resetModules();
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;

    // Imported AFTER resetModules — the token must be minted from the same
    // auth.js instance the router will verify against (memoized HMAC secret
    // per module instance; a stale import 401s honestly).
    ({ witnessFor, strangerWitness } = await import('../helpers/witness.js'));

    const realm = await import('../../backend/services/user-realm.js');
    realmRoot = await createTempDir('tasks-realm');
    realm.setRealmRoot(realmRoot);

    const wsMod = await import('../../core/workspace/neuma-workspace.js');
    workspace = wsMod.default;
    setWorkspacesRoot = wsMod.setWorkspacesRoot;
    workspacesRoot = path.join(await createTempDir('tasks-ws'), 'workspaces');
    setWorkspacesRoot(workspacesRoot);
    neumaId = 'tasks-being-' + Math.random().toString(36).slice(2, 10);
    await workspace.create(neumaId);
    witness = await witnessFor(workspacesRoot, neumaId);

    const { default: router } = await import('../../backend/routes/task-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/tasks', router);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('mine: the full add → list → settle cycle lands on real realm disk', async () => {
    const empty = await request(app).get('/api/v1/tasks/mine').set(witness.header);
    expect(empty.status).toBe(200);
    expect(empty.body.plan.tasks).toEqual([]);

    const daily = await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'Morning run', cadence: 'daily' });
    expect(daily.status).toBe(201);
    expect(daily.body.task).toMatchObject({ title: 'Morning run', cadence: 'daily', status: 'open' });
    await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'Meal prep', cadence: 'weekly', detail: 'Sunday afternoon' });
    await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'Drink water', cadence: 'baseline' });
    await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'First 5k', cadence: 'milestone', dueDate: '2026-09-01' });
    const once = await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'One-off errand', cadence: 'once' });
    expect(once.status).toBe(201);
    expect(once.body.task).toMatchObject({ cadence: 'once', status: 'open' });

    const list = await request(app).get('/api/v1/tasks/mine').set(witness.header);
    expect(list.body.plan.tasks).toHaveLength(5);

    const done = await request(app).patch(`/api/v1/tasks/mine/${daily.body.task.id}`).set(witness.header).send({ status: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.task.status).toBe('done');
    expect(done.body.task.completedAt).toBeTruthy();

    // The realm is the witness's readable store — plaintext on real disk.
    const raw = await fs.readFile(path.join(realmRoot, witness.address.toLowerCase(), 'tasks.json'), 'utf8');
    expect(raw).toContain('Morning run');
    expect(raw).toContain('"status": "done"');
  });

  it('mine: the wider rhythms cross the route — monthly, biweekly, and custom with its days', async () => {
    const monthly = await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'Pay rent', cadence: 'monthly' });
    expect(monthly.status).toBe(201);
    expect(monthly.body.task).toMatchObject({ cadence: 'monthly', status: 'open' });
    const biweekly = await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'Deep clean', cadence: 'biweekly' });
    expect(biweekly.status).toBe(201);
    const custom = await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'Lift', cadence: 'custom', days: [5, 1, 3] });
    expect(custom.status).toBe(201);
    expect(custom.body.task.days).toEqual([1, 3, 5]); // normalized sorted

    // The days survive the store and can be redesigned in place.
    const redesigned = await request(app).patch(`/api/v1/tasks/mine/${custom.body.task.id}`).set(witness.header).send({ days: [0, 6] });
    expect(redesigned.status).toBe(200);
    expect(redesigned.body.task.days).toEqual([0, 6]);
    // Leaving custom sheds the days; a dayless custom add is a named 400.
    const toWeekly = await request(app).patch(`/api/v1/tasks/mine/${custom.body.task.id}`).set(witness.header).send({ cadence: 'weekly' });
    expect(toWeekly.body.task.days).toBeUndefined();
    const dayless = await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'x', cadence: 'custom' });
    expect(dayless.status).toBe(400);
    expect(dayless.body.error).toMatch(/needs its days/);
  });

  it('mine: corrections arrive as 400s with the fix named', async () => {
    expect((await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: '  ', cadence: 'daily' })).status).toBe(400);
    expect((await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'x', cadence: 'hourly' })).status).toBe(400);
    const dueOnDaily = await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'x', cadence: 'daily', dueDate: '2026-08-01' });
    expect(dueOnDaily.status).toBe(400);
    expect(dueOnDaily.body.error).toMatch(/milestone/);

    const baseline = await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'Stand watch', cadence: 'baseline' });
    const settleBaseline = await request(app).patch(`/api/v1/tasks/mine/${baseline.body.task.id}`).set(witness.header).send({ status: 'done' });
    expect(settleBaseline.status).toBe(400);
    expect(settleBaseline.body.error).toMatch(/never settles/);

    const unknown = await request(app).patch('/api/v1/tasks/mine/no-such-id').set(witness.header).send({ status: 'done' });
    expect(unknown.status).toBe(400);
  });

  it('neuma lane: CRUD, encryption at rest, and the STANDING WORK prompt section', async () => {
    const added = await request(app).post(`/api/v1/tasks/neuma/${neumaId}`).set(witness.header).send({ title: 'Review memory qzv', cadence: 'daily' });
    expect(added.status).toBe(201);

    // Encrypted at rest like every sovereign file.
    const raw = await fs.readFile(path.join(workspacesRoot, neumaId, 'tasks', 'assigned.json'), 'utf8');
    expect(raw).not.toContain('qzv');
    const stored = await workspace.readAssignedPlan(neumaId);
    expect(stored.tasks[0].title).toBe('Review memory qzv');

    // LOAD-BEARING: the persisted plan rides the being's STANDING WORK section.
    const { assemblePromptSections } = await import('../../core/runtime/prompt-assembler.js');
    const section = assemblePromptSections({ assignedPlan: stored }).find((s) => s.id === 'assigned');
    expect(section).toBeDefined();
    expect(section.label).toBe('STANDING WORK');
    expect(section.text).toContain('Review memory qzv');

    // Settle it — the section leaves the next turn's prompt.
    const done = await request(app).patch(`/api/v1/tasks/neuma/${neumaId}/${added.body.task.id}`).set(witness.header).send({ status: 'done' });
    expect(done.status).toBe(200);
    const settled = await workspace.readAssignedPlan(neumaId);
    expect(assemblePromptSections({ assignedPlan: settled }).find((s) => s.id === 'assigned')).toBeUndefined();
  });

  it('neuma lane: the being\'s own self-taken tasks ride the GET, read-only', async () => {
    await workspace.writeTaskLedger(neumaId, {
      tasks: [{
        id: 'self-1', title: 'Self taken qself', status: 'active',
        createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z',
      }],
    });
    const res = await request(app).get(`/api/v1/tasks/neuma/${neumaId}`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.ledger.tasks.map((t) => t.title)).toContain('Self taken qself');
    // The being's ledger is never touched by the witness's lane writes.
    await request(app).post(`/api/v1/tasks/neuma/${neumaId}`).set(witness.header).send({ title: 'Witness-set', cadence: 'daily' });
    const ledger = await workspace.readTaskLedger(neumaId);
    expect(ledger.tasks).toHaveLength(1);
    expect(ledger.tasks[0].title).toBe('Self taken qself');
  });

  it('subtasks: add, toggle, remove on the mine lane, persisted to realm disk', async () => {
    const parent = await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'Work out', cadence: 'daily' });
    const taskId = parent.body.task.id;
    const sub = await request(app).post(`/api/v1/tasks/mine/${taskId}/subtasks`).set(witness.header).send({ title: 'Push-ups' });
    expect(sub.status).toBe(201);
    expect(sub.body.subtask).toMatchObject({ title: 'Push-ups', status: 'open' });

    const toggled = await request(app).patch(`/api/v1/tasks/mine/${taskId}/subtasks/${sub.body.subtask.id}`).set(witness.header).send({ status: 'done' });
    expect(toggled.status).toBe(200);
    expect(toggled.body.subtask.status).toBe('done');

    // Real realm disk holds the checklist.
    const raw = await fs.readFile(path.join(realmRoot, witness.address.toLowerCase(), 'tasks.json'), 'utf8');
    expect(raw).toContain('Push-ups');

    const removed = await request(app).delete(`/api/v1/tasks/mine/${taskId}/subtasks/${sub.body.subtask.id}`).set(witness.header);
    expect(removed.status).toBe(200);
    expect(removed.body.task.subtasks ?? []).toHaveLength(0);

    // Corrections: unknown parent and empty title are 400s.
    expect((await request(app).post('/api/v1/tasks/mine/no-such/subtasks').set(witness.header).send({ title: 'x' })).status).toBe(400);
    expect((await request(app).post(`/api/v1/tasks/mine/${taskId}/subtasks`).set(witness.header).send({ title: '  ' })).status).toBe(400);
  });

  it('subtasks on the neuma lane persist encrypted and ride the STANDING WORK section', async () => {
    const parent = await request(app).post(`/api/v1/tasks/neuma/${neumaId}`).set(witness.header).send({ title: 'Train qsub', cadence: 'daily' });
    const taskId = parent.body.task.id;
    const sub = await request(app).post(`/api/v1/tasks/neuma/${neumaId}/${taskId}/subtasks`).set(witness.header).send({ title: 'Chest' });
    expect(sub.status).toBe(201);

    const raw = await fs.readFile(path.join(workspacesRoot, neumaId, 'tasks', 'assigned.json'), 'utf8');
    expect(raw).not.toContain('qsub'); // encrypted at rest
    const stored = await workspace.readAssignedPlan(neumaId);
    expect(stored.tasks[0].subtasks[0].title).toBe('Chest');

    // The open step rides the being's prompt, indented under its parent.
    const { assemblePromptSections } = await import('../../core/runtime/prompt-assembler.js');
    const section = assemblePromptSections({ assignedPlan: stored }).find((s) => s.id === 'assigned');
    expect(section.text).toContain('– Chest');

    // Ownership still gates subtask writes.
    expect((await request(app).post('/api/v1/tasks/neuma/no-such-being/x/subtasks').set(witness.header).send({ title: 'x' })).status).toBe(404);
  });

  it('presets: list, save custom, apply to both lanes, delete custom', async () => {
    const listed = await request(app).get('/api/v1/tasks/presets').set(witness.header);
    expect(listed.status).toBe(200);
    expect(listed.body.builtins.length).toBeGreaterThanOrEqual(4);
    expect(listed.body.customs).toEqual([]);

    const saved = await request(app).post('/api/v1/tasks/presets').set(witness.header).send({
      name: 'Push Day qpx',
      tasks: [{ title: 'Push day', cadence: 'once', subtasks: [{ title: 'Bench 4×8' }, { title: 'Dips 3×12' }] }],
    });
    expect(saved.status).toBe(201);
    const presetId = saved.body.preset.id;
    expect((await request(app).post('/api/v1/tasks/presets').set(witness.header).send({ name: 'X', tasks: [] })).status).toBe(400);

    // Apply to the witness's own list — bundle lands with subtasks.
    const appliedMine = await request(app).post('/api/v1/tasks/mine/apply-preset').set(witness.header).send({ presetId });
    expect(appliedMine.status).toBe(201);
    expect(appliedMine.body.added[0].subtasks.map((s) => s.title)).toEqual(['Bench 4×8', 'Dips 3×12']);

    // Apply to a being's assigned plan — persisted in the sovereign workspace.
    const appliedNeuma = await request(app).post(`/api/v1/tasks/neuma/${neumaId}/apply-preset`).set(witness.header).send({ presetId });
    expect(appliedNeuma.status).toBe(201);
    const stored = await workspace.readAssignedPlan(neumaId);
    expect(stored.tasks.some((t) => t.title === 'Push day' && t.subtasks.length === 2)).toBe(true);

    // Unknown preset is a 404; a built-in applies too.
    expect((await request(app).post('/api/v1/tasks/mine/apply-preset').set(witness.header).send({ presetId: 'nope' })).status).toBe(404);
    expect((await request(app).post('/api/v1/tasks/mine/apply-preset').set(witness.header).send({ presetId: 'builtin:daily-training' })).status).toBe(201);

    // Built-ins are never deletable; the custom is.
    expect((await request(app).delete('/api/v1/tasks/presets/builtin:daily-training').set(witness.header)).status).toBe(404);
    const deleted = await request(app).delete(`/api/v1/tasks/presets/${presetId}`).set(witness.header);
    expect(deleted.status).toBe(200);
    expect((await request(app).get('/api/v1/tasks/presets').set(witness.header)).body.customs).toEqual([]);
  });

  it('neuma lane: history (newest first) and the rolled ledger ride the GET', async () => {
    await workspace.appendTaskHistory(neumaId, { id: 'h1', title: 'First settled', status: 'done', settledAt: '2026-07-17T10:00:00.000Z' });
    await workspace.appendTaskHistory(neumaId, { id: 'h2', title: 'Later settled', status: 'dropped', settledAt: '2026-07-18T10:00:00.000Z' });
    await workspace.writeTaskLedger(neumaId, {
      tasks: [{
        id: 'old-daily', title: 'Rhythm qday', cadence: 'daily', status: 'done',
        completedAt: '2000-01-01T00:00:00.000Z', createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z',
      }],
    });

    const res = await request(app).get(`/api/v1/tasks/neuma/${neumaId}`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.history.map((h) => h.id)).toEqual(['h2', 'h1']);
    // The being's done daily has already rolled open for display.
    expect(res.body.ledger.tasks[0].status).toBe('open');

    // The history file itself is encrypted at rest.
    const raw = await fs.readFile(path.join(workspacesRoot, neumaId, 'tasks', 'history.jsonl'), 'utf8');
    expect(raw).not.toContain('First settled');
  });

  it('neuma lane: ownership is fail-closed — missing 404, foreign 403', async () => {
    expect((await request(app).get('/api/v1/tasks/neuma/no-such-being').set(witness.header)).status).toBe(404);

    const foreignId = 'foreign-being-' + Math.random().toString(36).slice(2, 10);
    await workspace.create(foreignId);
    const other = strangerWitness();
    await claimOwner(workspacesRoot, foreignId, other.address);
    expect((await request(app).get(`/api/v1/tasks/neuma/${foreignId}`).set(witness.header)).status).toBe(403);
    expect((await request(app).post(`/api/v1/tasks/neuma/${foreignId}`).set(witness.header).send({ title: 'x', cadence: 'daily' })).status).toBe(403);
  });

  it('lazy recurrence: a done daily whose period rolled reopens on GET — and persists', async () => {
    // Seed an old completed daily directly (as if completed yesterday).
    const seeded = {
      tasks: [{
        id: 'old-daily', title: 'Old rhythm', cadence: 'daily', status: 'done',
        completedAt: '2000-01-01T00:00:00.000Z', createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z',
      }],
    };
    await workspace.writeAssignedPlan(neumaId, seeded);

    const res = await request(app).get(`/api/v1/tasks/neuma/${neumaId}`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.plan.tasks[0].status).toBe('open');
    // The roll-forward persisted — it is not recomputed theater.
    const stored = await workspace.readAssignedPlan(neumaId);
    expect(stored.tasks[0].status).toBe('open');
  });

  it('WITNESS LIST: the witness\'s own list rides the prompt so a being can help carry it', async () => {
    await request(app).post('/api/v1/tasks/mine').set(witness.header).send({ title: 'Stretch qwx', cadence: 'daily' });
    const { readUserTasks } = await import('../../backend/services/user-tasks.js');
    const plan = await readUserTasks(witness.address);

    const { assemblePromptSections } = await import('../../core/runtime/prompt-assembler.js');
    const section = assemblePromptSections({ witnessPlan: plan }).find((s) => s.id === 'operator');
    expect(section).toBeDefined();
    expect(section.label).toBe('OPERATOR LIST');
    expect(section.text).toContain('Stretch qwx');

    // Settle the only task — the section vanishes.
    await request(app).patch(`/api/v1/tasks/mine/${plan.tasks[0].id}`).set(witness.header).send({ status: 'done' });
    const settled = await readUserTasks(witness.address);
    expect(assemblePromptSections({ witnessPlan: settled }).find((s) => s.id === 'operator')).toBeUndefined();
  });
});

// Deadlines on every store + the ICS subscribe feed (Design note, 2026-09-20. REAL
// router, REAL realm disk, REAL workspace; auth passthrough as above — EXCEPT
// the feed itself, which is the one route that must answer WITHOUT any
// session: the share token is its whole authentication, and a revoked token
// reads as nothing.
describe('deadlines aggregate + the ICS subscribe feed', () => {
  let app, feed, workspace, realmRoot, workspacesRoot, neumaId, witness, witnessFor, prevKey;

  beforeEach(async () => {
    vi.resetModules();
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;

    ({ witnessFor } = await import('../helpers/witness.js'));

    const realm = await import('../../backend/services/user-realm.js');
    realmRoot = await createTempDir('ics-realm');
    realm.setRealmRoot(realmRoot);

    const wsMod = await import('../../core/workspace/neuma-workspace.js');
    workspace = wsMod.default;
    workspacesRoot = path.join(await createTempDir('ics-ws'), 'workspaces');
    wsMod.setWorkspacesRoot(workspacesRoot);
    neumaId = 'ics-being-' + Math.random().toString(36).slice(2, 10);
    await workspace.create(neumaId);
    witness = await witnessFor(workspacesRoot, neumaId);

    const { default: router, calendarFeedRouter } = await import('../../backend/routes/task-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/tasks', router);
    feed = express();
    feed.use(express.json());
    feed.use('/api/v1/tasks', calendarFeedRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  it('deadlines persist on every store and aggregate into one read', async () => {
    // The operator's list: a daily with a due TIME, a milestone with a DATE.
    await request(app).post('/api/v1/tasks/mine').set(witness.header)
      .send({ title: 'Body qics', cadence: 'daily', dueTime: '18:00' });
    await request(app).post('/api/v1/tasks/mine').set(witness.header)
      .send({ title: 'Passport qics', cadence: 'milestone', dueDate: '2026-10-01' });
    // A due DATE on recurring work is refused at the boundary — 400, honestly.
    const refused = await request(app).post('/api/v1/tasks/mine').set(witness.header)
      .send({ title: 'x', cadence: 'daily', dueDate: '2026-10-01' });
    expect(refused.status).toBe(400);

    // A lane's ledger and standing plan: deadlines seeded the way the being's
    // own tool path writes them.
    await workspace.writeTaskLedger(neumaId, {
      tasks: [{ id: 'lane-1', title: 'Refactor qics', status: 'open', cadence: 'once', dueDate: '2026-09-30', dueTime: '12:00', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' }],
    });
    await workspace.writeAssignedPlan(neumaId, {
      tasks: [{ id: 'standing-1', title: 'Standing owes qics', status: 'open', cadence: 'weekly', dueTime: '09:00', createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' }],
    });

    const res = await request(app).get('/api/v1/tasks/deadlines').set(witness.header);
    expect(res.status).toBe(200);
    const byTitle = Object.fromEntries(res.body.deadlines.map((d) => [d.title, d]));
    expect(byTitle['Body qics']).toMatchObject({ source: 'OPERATOR', dueTime: '18:00', laneId: 'me', kind: 'operator' });
    expect(byTitle['Passport qics']).toMatchObject({ dueDate: '2026-10-01', laneName: 'ME' });
    expect(byTitle['Refactor qics']).toMatchObject({ source: expect.stringContaining('LANE'), laneId: neumaId, kind: 'neuma', list: 'LANE' });
    expect(byTitle['Standing owes qics']).toMatchObject({ source: expect.stringContaining('STANDING'), list: 'STANDING' });
  });

  it('the feed answers on the token alone — no session — and a revoked token reads as nothing', async () => {
    await request(app).post('/api/v1/tasks/mine').set(witness.header)
      .send({ title: 'Feed owes qics', cadence: 'milestone', dueDate: '2026-10-01' });

    const minted = await request(app).post('/api/v1/tasks/calendar-token').set(witness.header).send({});
    expect(minted.status).toBe(200);
    const { token } = minted.body;

    const withoutSession = await request(feed).get(`/api/v1/tasks/calendar.ics?token=${token}`);
    expect(withoutSession.status).toBe(200);
    expect(withoutSession.headers['content-type']).toContain('text/calendar');
    expect(withoutSession.text).toContain('BEGIN:VCALENDAR');
    expect(withoutSession.text).toContain('SUMMARY:Feed owes qics [OPERATOR]');
    expect(withoutSession.text).toContain('DTSTART;VALUE=DATE:20261001');

    const bad = await request(feed).get('/api/v1/tasks/calendar.ics?token=deadbeefdeadbeefdeadbeef');
    expect(bad.status).toBe(401);

    await request(app).delete('/api/v1/tasks/calendar-token').set(witness.header).send({});
    const revoked = await request(feed).get(`/api/v1/tasks/calendar.ics?token=${token}`);
    expect(revoked.status).toBe(401);
  });
});
