/**
 * The HANDS on a working run's width and clocks (#577): the team/tune intent
 * over the REAL intent sweep (policy tier, validate, execute) — filed by the
 * run's lead, or by the house's seated Optio — and the operator's own route
 * over the REAL routes with REAL auth. The run is a real live-registry entry;
 * its frames go out through the real frame sender.
 *
 * Design note, 2026-10-13: the concurrency cap […]
 */
import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

const WALLET = '0x5777777777777777777777777777777777777778';
const LEAD = 'tune-lead';
const OPTIO = 'tune-optio';
const OTHER = 'tune-other';
const NAMES = Object.freeze({ [LEAD]: 'Lead', [OPTIO]: 'Optio', [OTHER]: 'Other' });

describe('team/tune — the lead and the house\'s Optio change a working run', () => {
  let saved, prevRealm, setRealmRoot, setWorkspacesRoot, neumaWorkspace, sweepIntents, live, cos, teamTuneIntent;
  const frames = [];
  let n = 0;

  beforeAll(async () => {
    const root = await createTempDir('team-tune');
    saved = { ...process.env };
    process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');
    process.env.NEUMA_STAFF_COS_PATH = path.join(root, 'staff-cos.json');
    process.env.NEUMA_TEAM_RUN_PATH = path.join(root, 'runs');
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    const realm = await import('../../backend/services/user-realm.js');
    setRealmRoot = realm.setRealmRoot;
    prevRealm = realm.getRealmRoot();
    setRealmRoot(path.join(root, 'realm'));
    const ws = await import('../../core/workspace/neuma-workspace.js');
    setWorkspacesRoot = ws.setWorkspacesRoot;
    neumaWorkspace = ws.default;
    setWorkspacesRoot(process.env.WORKSPACES_ROOT);
    const { writeOwner } = await import('../helpers/audit-auth.js');
    for (const id of [LEAD, OPTIO, OTHER]) {
      await neumaWorkspace.create(id);
      await writeOwner(path.dirname(neumaWorkspace.pathFor(id)), id, WALLET);
      await neumaWorkspace.writeDNA(id, { version: '1.0.0', identity: { name: NAMES[id] }, genesis: `# Essence\nI am ${NAMES[id]}.` });
    }
    ({ sweepIntents } = await import('../../backend/services/intents/intent-sweep.js'));
    live = await import('../../backend/services/team-run-live.js');
    live.setRunFrameSender((_wallet, frame) => frames.push(frame));
    ({ cosDesignation: cos } = await import('../../backend/services/staff/cos-designation.js'));
    ({ teamTuneIntent } = await import('../../backend/services/intents/team-tune.js'));
  }, 60000);

  afterEach(async () => {
    for (const run of live.liveRunsFor(WALLET)) live.endRun(run.id);
    await cos.clear(WALLET);
    frames.length = 0;
  });

  afterAll(() => {
    live?.setRunFrameSender(null);
    setWorkspacesRoot?.(null);
    setRealmRoot?.(prevRealm);
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  // A working run the lead leads: two parts, one at a time, the rig's ceiling 3.
  const liveRun = (id) => live.registerRun({
    id, wallet: WALLET, laneId: LEAD, lead: 'Lead', name: 'TUNED CREW', goal: 'Prove the hands.',
    board: [{ id: 'a', member: 'Lead', state: 'working' }, { id: 'b', member: 'Other', state: 'waiting' }],
    governs: { concurrency: 1, ceiling: 3, clock: null, clocks: {} },
  });

  // File one intent from a lane through the real sweep; the settled outcome.
  const file = async (laneId, payload, extra = {}) => {
    const dir = path.join(neumaWorkspace.pathFor(laneId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    n += 1;
    await fs.writeFile(path.join(dir, `tune-${n}.json`), JSON.stringify(payload));
    const events = [];
    const connection = { ws: null, companion: { name: NAMES[laneId], neumaId: laneId }, walletAddress: WALLET, ...extra };
    await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: (e) => events.push(e) });
    return events.filter((e) => e.status !== 'executing').at(-1);
  };

  test('the lead widens its own run and gives one part its own clock — every desk is told who', async () => {
    const entry = liveRun('tune-lead-run');
    const widened = await file(LEAD, { type: 'team/tune', concurrency: 2 });
    expect(widened.status).toBe('ok');
    expect(widened.detail).toMatch(/^The run works 2 at a time; the run's clock: no clock — works until done or stopped\./);
    expect(entry.concurrency).toBe(2);

    const clocked = await file(LEAD, { type: 'team/tune', step: 'b', clock: { work: 90, then: 'notify' } });
    expect(clocked.status).toBe('ok');
    expect(clocked.detail).toContain('b\'s clock: 1h 30m of work, then notify');
    expect(entry.clocks.b).toEqual({ work: 90, dueDate: null, dueTime: null, then: 'notify' });
    const told = frames.filter((f) => f.type === 'operator:team_tune' && f.id === 'tune-lead-run');
    expect(told.map((f) => f.by)).toEqual(['Lead (lead)', 'Lead (lead)']);
    expect(told[1].partClocks.b).toMatchObject({ own: { work: 90 }, words: '1h 30m of work, then notify', limitMs: 90 * 60_000 });
    expect(told[1].partClocks.a.words).toBe('no clock — works until done or stopped');
  });

  test('the house\'s Optio tunes any run of its house — named; a lane that is neither lead nor Optio is refused', async () => {
    const entry = liveRun('tune-optio-run');
    await cos.designate(WALLET, OPTIO);
    const unnamed = await file(OPTIO, { type: 'team/tune', concurrency: 3 });
    expect(unnamed.status).not.toBe('ok');
    expect(unnamed.detail).toBe('Name the run with {run}: tune-optio-run (TUNED CREW, led by Lead).');

    const named = await file(OPTIO, { type: 'team/tune', run: 'tune-optio-run', concurrency: 3, clock: '4h' });
    expect(named.status).toBe('ok');
    expect(entry.concurrency).toBe(3);
    expect(entry.clock).toMatchObject({ work: 240, then: 'wrap-up' });
    expect(frames.find((f) => f.type === 'operator:team_tune').by).toBe('Optio (the Optio)');

    const other = await file(OTHER, { type: 'team/tune', run: 'tune-optio-run', concurrency: 1 });
    expect(other.status).not.toBe('ok');
    expect(other.detail).toMatch(/^Only the run's lead or the house's Optio may change its clock and width/);
    expect(entry.concurrency).toBe(3);
  });

  test('a member never re-governs its run; a malformed clock comes back as the fix', async () => {
    const entry = liveRun('tune-member-run');
    const member = await file(LEAD, { type: 'team/tune', concurrency: 3 }, { _teamMember: true });
    expect(member.status).not.toBe('ok');
    expect(member.detail).toMatch(/^A member works its part/);
    expect(entry.concurrency).toBe(1);

    const bad = await file(LEAD, { type: 'team/tune', clock: { then: 'stop' } });
    expect(bad.status).toBe('error');
    expect(bad.detail).toMatch(/^the run: a clock needs work \(minutes of working time\) or a dueDate/);
  });

  test('offered only while it can act: the lead of a working run, the Optio while its house has one', async () => {
    const at = (laneId, extra = {}) => teamTuneIntent.availableFor({ laneId, connection: { companion: { neumaId: laneId }, walletAddress: WALLET, ...extra } });
    expect(await at(LEAD)).toBeNull(); // nothing working yet
    liveRun('tune-offer-run');
    expect(await at(LEAD)).toEqual({});
    expect(await at(OTHER)).toBeNull();
    expect(await at(OPTIO)).toBeNull(); // not seated
    await cos.designate(WALLET, OPTIO);
    expect(await at(OPTIO)).toEqual({});
    expect(await at(LEAD, { _teamMember: true })).toBeNull();
  });
});

describe('POST /api/v1/team/live/:id/tune — the operator\'s own hand', () => {
  let app, operator, stranger, live;

  beforeAll(async () => {
    const root = await createTempDir('team-tune-route');
    const { witnessFor, strangerWitness } = await import('../helpers/witness.js');
    operator = await witnessFor(path.join(root, 'workspaces'), 'tune-route-lead');
    stranger = strangerWitness();
    live = await import('../../backend/services/team-run-live.js');
    const { default: router } = await import('../../backend/routes/team-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/team', router);
  });

  test('the operator narrows and widens the run and sets its clock — never past the rig; a stranger reaches nothing', async () => {
    const entry = live.registerRun({
      id: 'tune-route-run', wallet: operator.address, laneId: 'tune-route-lead', lead: 'Lead', goal: 'g',
      board: [{ id: 'a', state: 'working' }], governs: { concurrency: 2, ceiling: 3 },
    });
    try {
      const forged = await request(app).post('/api/v1/team/live/tune-route-run/tune').set(stranger.header).send({ concurrency: 1 });
      expect(forged.status).toBe(404);
      expect(entry.concurrency).toBe(2);

      const narrowed = await request(app).post('/api/v1/team/live/tune-route-run/tune').set(operator.header).send({ concurrency: 1 });
      expect(narrowed.status).toBe(200);
      expect(narrowed.body).toMatchObject({ ok: true, concurrency: 1, note: null });

      const past = await request(app).post('/api/v1/team/live/tune-route-run/tune').set(operator.header).send({ concurrency: 9 });
      expect(past.body).toMatchObject({ concurrency: 3, note: 'the rig allows 3 at once — the run works 3 at a time' });

      const clocked = await request(app).post('/api/v1/team/live/tune-route-run/tune').set(operator.header)
        .send({ clock: { dueDate: '2026-10-20', dueTime: '18:00', then: 'stop' } });
      expect(clocked.body.clock).toEqual({ work: null, dueDate: '2026-10-20', dueTime: '18:00', then: 'stop' });

      const none = await request(app).post('/api/v1/team/live/tune-route-run/tune').set(operator.header).send({ clock: 'none' });
      expect(none.body.clock).toBeNull();

      const bad = await request(app).post('/api/v1/team/live/tune-route-run/tune').set(operator.header).send({ concurrency: 0 });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatch(/a whole number from 1 to 16/);
      const noStep = await request(app).post('/api/v1/team/live/tune-route-run/tune').set(operator.header).send({ stepId: 'zz', clock: '1h' });
      expect(noStep.status).toBe(400);
      expect(noStep.body.error).toBe('the run has no step zz');
    } finally {
      live.endRun('tune-route-run');
    }
  });
});
