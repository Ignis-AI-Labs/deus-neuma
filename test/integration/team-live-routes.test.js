/**
 * The operator's hands on a working team, over the REAL routes with REAL auth
 * (a signed session token — test/helpers/witness.js) and the REAL live
 * registry a background run stands on:
 *   GET  /api/v1/team/live           — the operator's working runs, as a
 *                                      window paints them
 *   POST /api/v1/team/live/:id/stop  — stop the run, or one member; the
 *                                      signal the member decodes under aborts
 *   POST /api/v1/team/live/:id/steer — the operator's note to one member
 *   GET  /api/v1/team/runs/:id/log/:stepId — one member's work log
 * and the TEAMS lane's resume, which must never replay a lead's run.
 * Owner-scoped: a stranger sees nothing and stops nothing.
 */
import express from 'express';
import request from 'supertest';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('team LIVE routes — watch and stop a working team', () => {
  let app, operator, stranger, live;

  beforeAll(async () => {
    const root = await createTempDir('team-live-routes');
    const { witnessFor, strangerWitness } = await import('../helpers/witness.js');
    operator = await witnessFor(path.join(root, 'workspaces'), 'live-lead');
    stranger = strangerWitness();
    live = await import('../../backend/services/team-run-live.js');
    const { default: router } = await import('../../backend/routes/team-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/team', router);
  });

  test('the operator sees the run, stops one member, then the run — a stranger can do neither', async () => {
    const entry = live.registerRun({
      id: 'live-route-run', wallet: operator.address, laneId: 'live-lead', lead: 'Lead',
      name: 'LIVE CREW', goal: 'Prove the hands work.',
      board: [{ id: 'a', state: 'working' }, { id: 'b', state: 'working' }],
    });
    const memberA = live.stepSignal(entry, 'a');
    const memberB = live.stepSignal(entry, 'b');
    try {
      const listed = await request(app).get('/api/v1/team/live').set(operator.header);
      expect(listed.status).toBe(200);
      expect(listed.body.runs).toHaveLength(1);
      expect(listed.body.runs[0]).toMatchObject({ id: 'live-route-run', name: 'LIVE CREW', lead: 'Lead', stopping: false });

      const theirs = await request(app).get('/api/v1/team/live').set(stranger.header);
      expect(theirs.body.runs).toEqual([]);
      const forged = await request(app).post('/api/v1/team/live/live-route-run/stop').set(stranger.header).send({});
      expect(forged.status).toBe(404);
      expect(entry.controller.signal.aborted).toBe(false);

      const one = await request(app).post('/api/v1/team/live/live-route-run/stop').set(operator.header).send({ stepId: 'a' });
      expect(one.status).toBe(200);
      expect(memberA.aborted).toBe(true);
      expect(memberB.aborted).toBe(false);

      const bad = await request(app).post('/api/v1/team/live/live-route-run/stop').set(operator.header).send({ stepId: 7 });
      expect(bad.status).toBe(400);

      const all = await request(app).post('/api/v1/team/live/live-route-run/stop').set(operator.header).send({});
      expect(all.status).toBe(200);
      expect(memberB.aborted).toBe(true);
      expect(memberB.reason.message).toBe('the operator stopped the run');
      const after = await request(app).get('/api/v1/team/live').set(operator.header);
      expect(after.body.runs[0].stopping).toBe(true);
    } finally {
      live.endRun('live-route-run');
    }
    const gone = await request(app).post('/api/v1/team/live/live-route-run/stop').set(operator.header).send({});
    expect(gone.status).toBe(404);
  });

  test('STEER over the route: a working member is cut; a done step and a stranger are refused', async () => {
    const entry = live.registerRun({
      id: 'steer-route-run', wallet: operator.address, laneId: 'live-lead', lead: 'Lead', goal: 'g',
      board: [{ id: 'a', state: 'working' }, { id: 'b', state: 'done' }],
    });
    const memberA = live.stepSignal(entry, 'a');
    try {
      const steered = await request(app).post('/api/v1/team/live/steer-route-run/steer').set(operator.header).send({ stepId: 'a', note: 'Shorter, please.' });
      expect(steered.status).toBe(200);
      expect(steered.body).toEqual({ ok: true, cut: true });
      expect(memberA.aborted).toBe(true);
      expect(memberA.reason.message).toBe(live.STEER_REASON);
      expect((await request(app).get('/api/v1/team/live').set(operator.header)).body.runs[0].notes.a[0].note).toBe('Shorter, please.');
      const done = await request(app).post('/api/v1/team/live/steer-route-run/steer').set(operator.header).send({ stepId: 'b', note: 'too late' });
      expect(done.status).toBe(409);
      const empty = await request(app).post('/api/v1/team/live/steer-route-run/steer').set(operator.header).send({ stepId: 'a', note: '  ' });
      expect(empty.status).toBe(409);
      const forged = await request(app).post('/api/v1/team/live/steer-route-run/steer').set(stranger.header).send({ stepId: 'a', note: 'mine now' });
      expect(forged.status).toBe(404);
    } finally {
      live.endRun('steer-route-run');
    }
  });

  test('a STOP after a STEER sticks; a note to a member that has answered is refused, never dropped', async () => {
    const entry = live.registerRun({
      id: 'stop-steer-run', wallet: operator.address, laneId: 'live-lead-2', lead: 'Lead', goal: 'g',
      board: [{ id: 'a', state: 'working' }, { id: 'b', state: 'working' }],
    });
    const memberA = live.stepSignal(entry, 'a');
    try {
      const steered = await request(app).post('/api/v1/team/live/stop-steer-run/steer').set(operator.header).send({ stepId: 'a', note: 'Shorter.' });
      expect(steered.body).toEqual({ ok: true, cut: true });
      // The steer's cut already aborted the member's signal; the stop must
      // still land — the re-start reads it and fails the part instead.
      const stopped = await request(app).post('/api/v1/team/live/stop-steer-run/stop').set(operator.header).send({ stepId: 'a' });
      expect(stopped.status).toBe(200);
      expect(memberA.reason.message).toBe(live.STEER_REASON);
      expect(entry.stopped.has('a')).toBe(true);
      // Between a cut and its re-start a working step holds no controller —
      // a stop then still lands.
      live.releaseStep(entry, 'a');
      expect((await request(app).post('/api/v1/team/live/stop-steer-run/stop').set(operator.header).send({ stepId: 'a' })).status).toBe(200);
      // b has answered (its part is being checked): a note could never reach it.
      entry.answered.add('b');
      const late = await request(app).post('/api/v1/team/live/stop-steer-run/steer').set(operator.header).send({ stepId: 'b', note: 'one more thing' });
      expect(late.status).toBe(409);
      expect(late.body.error).toContain('just answered');
      expect(entry.notes.b).toBeUndefined();
    } finally {
      live.endRun('stop-steer-run');
    }
  });

  test('a lead\'s run is never replayed through the TEAMS lane — and a working run is nothing to resume', async () => {
    process.env.NEUMA_TEAM_RUN_PATH = path.join(await createTempDir('team-live-routes-runs'), 'runs');
    try {
      const store = await import('../../backend/services/team-run-store.js');
      const plan = [{ id: 'a', neumaId: 'live-lead', task: 'part a', needs: [] }];
      const leadRun = await store.createRun({
        by: operator.address, runAt: new Date().toISOString(), lane: 'lead', lead: { neumaId: 'live-lead', name: 'Lead' },
        goal: 'g', steps: plan, status: 'failed', completed: {}, order: [],
      });
      const refused = await request(app).post('/api/v1/team/run').set(operator.header).send({ resume: leadRun });
      expect(refused.status).toBe(409);
      expect(refused.body.error).toContain('WORKFLOW');
      const working = await store.createRun({
        by: operator.address, runAt: new Date(Date.now() + 1000).toISOString(), goal: 'g', steps: plan, status: 'running', completed: {}, order: [],
      });
      const busy = await request(app).post('/api/v1/team/run').set(operator.header).send({ resume: working });
      expect(busy.status).toBe(409);
      expect(busy.body.error).toContain('still working');
      // Neither record was touched.
      expect((await store.readRun(leadRun, operator.address)).lane).toBe('lead');
    } finally {
      delete process.env.NEUMA_TEAM_RUN_PATH;
    }
  });

  test('the operator\'s word in the TEAM CHANNEL: to everyone or one member — kept on the run, never a cut; a stranger and a wrong name are refused', async () => {
    const entry = live.registerRun({
      id: 'channel-route-run', wallet: operator.address, laneId: 'live-lead-3', lead: 'Lead', goal: 'g',
      board: [{ id: 'a', member: 'Ash', state: 'working' }, { id: 'b', member: 'Birch', state: 'waiting' }],
    });
    const memberA = live.stepSignal(entry, 'a');
    try {
      const all = await request(app).post('/api/v1/team/live/channel-route-run/channel').set(operator.header).send({ text: 'Datadog first.' });
      expect(all.status).toBe(200);
      expect(all.body.message).toMatchObject({ n: 1, from: 'your operator', to: 'everyone', toStep: null, text: 'Datadog first.' });
      const one = await request(app).post('/api/v1/team/live/channel-route-run/channel').set(operator.header).send({ text: 'Keep it short.', to: 'Birch' });
      expect(one.body.message).toMatchObject({ n: 2, to: 'Birch', toStep: 'b' });
      expect(memberA.aborted).toBe(false); // a post is read when they look — it never cuts work
      const wrong = await request(app).post('/api/v1/team/live/channel-route-run/channel').set(operator.header).send({ text: 'x', to: 'Cedar' });
      expect(wrong.status).toBe(409);
      expect(wrong.body.error).toContain('not on this team');
      expect((await request(app).post('/api/v1/team/live/channel-route-run/channel').set(stranger.header).send({ text: 'mine now' })).status).toBe(404);
      const seen = (await request(app).get('/api/v1/team/live').set(operator.header)).body.runs.find((r) => r.id === 'channel-route-run');
      expect(seen.channel.map((m) => m.text)).toEqual(['Datadog first.', 'Keep it short.']);
    } finally {
      live.endRun('channel-route-run');
    }
  });

  test('ONE member\'s log, separately: the operator reads it whole and reads on from where the window left off — a stranger finds nothing', async () => {
    process.env.NEUMA_TEAM_RUN_PATH = path.join(await createTempDir('team-live-routes-logs'), 'runs');
    const { setWorkspacesRoot, default: workspace } = await import('../../core/workspace/neuma-workspace.js');
    setWorkspacesRoot(path.join(await createTempDir('team-live-routes-lanes'), 'workspaces'));
    try {
      const store = await import('../../backend/services/team-run-store.js');
      const id = await store.createRun({
        by: operator.address, runAt: new Date().toISOString(), lane: 'lead', lead: { neumaId: 'live-lead', name: 'Lead' },
        goal: 'g', steps: [{ id: 'a', neumaId: 'log-member', task: 'map the gap', needs: [] }], names: { 'log-member': 'Member' },
        status: 'running', completed: {}, order: [],
      });
      // The part's log, written where the run writes it: the member's own encrypted lane.
      for (const entry of [
        { kind: 'open', how: 'brief', text: 'Your part: map the gap.' },
        { kind: 'act', tool: 'web/web_search', status: 'ok', summary: '"gap" — 5 results' },
        { kind: 'words', text: 'The gap is mapped.' },
      ]) await workspace.appendTeamLog('log-member', id, 'a', { at: new Date().toISOString(), ...entry });

      const whole = await request(app).get(`/api/v1/team/runs/${id}/log/a`).set(operator.header);
      expect(whole.status).toBe(200);
      expect(whole.body).toMatchObject({ stepId: 'a', neumaId: 'log-member', member: 'Member', task: 'map the gap', total: 3, from: 0, next: 3 });
      expect(whole.body.entries.map((e) => e.kind)).toEqual(['open', 'act', 'words']);
      const onward = await request(app).get(`/api/v1/team/runs/${id}/log/a?from=2`).set(operator.header);
      expect(onward.body.entries.map((e) => e.text)).toEqual(['The gap is mapped.']);

      expect((await request(app).get(`/api/v1/team/runs/${id}/log/a`).set(stranger.header)).status).toBe(404);
      expect((await request(app).get(`/api/v1/team/runs/${id}/log/zz`).set(operator.header)).status).toBe(404);
    } finally {
      setWorkspacesRoot(null);
      delete process.env.NEUMA_TEAM_RUN_PATH;
    }
  });

  test('no token is a real 401', async () => {
    const res = await request(app).get('/api/v1/team/live');
    expect(res.status).toBe(401);
  });
});
