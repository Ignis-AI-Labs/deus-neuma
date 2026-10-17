/**
 * END THE STANDING PLAN (Design note, 2026-10-10 — DELETE /api/v1/staff/plan, end to end on the REAL
 * route, the REAL designation store, the REAL workspace engine (the plan record written and read
 * through it, encrypted) and REAL auth, with the REAL live-connection registry the portal keeps.
 *
 * A team plan whose workspace confined the lead's writes held the house's sprint stuck, and
 * nothing on the desk could end it. Proves: the record retires (moved aside, never destroyed),
 * a live connection drops the plan and its confinement at once, a working team run is never
 * pulled out from under itself, and a stranger cannot end another house's plan.
 */
import express from 'express';
import request from 'supertest';
import path from 'path';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';

const OPTIO = 'optiolane';

describe('END PLAN — the operator ends the office\'s standing plan', () => {
  let app, house, witness, workspace, portalConnections;
  const saved = {};
  const ENV = ['NEUMA_STAFF_COS_PATH', 'NEUMA_TEAM_RUN_PATH', 'WORKSPACES_ROOT', 'NEUMA_REALM_ROOT'];
  const added = [];

  const plansDir = () => path.join(process.env.WORKSPACES_ROOT, OPTIO, 'tasks');
  const live = (state) => {
    const id = `end-plan-test-${added.length}`;
    const connection = { companion: { neumaId: OPTIO }, ...state };
    portalConnections.set(id, connection);
    added.push(id);
    return connection;
  };

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) { saved[k] = process.env[k]; }
    house = await createTempDir('staff-end-plan');
    process.env.NEUMA_STAFF_COS_PATH = path.join(house, 'staff-cos.json');
    process.env.NEUMA_TEAM_RUN_PATH = path.join(house, 'team-runs');
    process.env.WORKSPACES_ROOT = path.join(house, 'workspaces');
    process.env.NEUMA_REALM_ROOT = path.join(house, 'realm'); // the house's seat, never the live realm

    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(process.env.WORKSPACES_ROOT, OPTIO);
    ({ default: workspace } = await import('../../core/workspace/neuma-workspace.js'));
    ({ portalConnections } = await import('../../backend/routes/portal-connections.js'));
    const { cosDesignation } = await import('../../backend/services/staff/cos-designation.js');
    await cosDesignation.designate(witness.address, OPTIO);
    await workspace.writePlanRecord(OPTIO, {
      name: 'gap-validation-sprint',
      goal: 'Validate the first gap.',
      steps: [{ id: 'one', neumaId: OPTIO, task: 'scan', needs: [] }],
      approvedAt: '2026-10-10T03:00:00.000Z',
      workspace: { root: path.join(house, 'arena'), budgetBytes: 1024 },
    });
    const { default: router } = await import('../../backend/routes/staff-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/staff', router);
  });

  afterEach(() => {
    for (const id of added.splice(0)) portalConnections.delete(id);
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('the record retires — moved aside, its bytes intact — and the live connection is unconfined now', async () => {
    const before = await fs.readFile(path.join(plansDir(), 'plan.json'));
    const connection = live({
      _approvedPlan: { name: 'gap-validation-sprint' },
      _teamWorkspace: { root: path.join(house, 'arena'), budgetBytes: 1024, usedBytes: 0 },
    });

    const res = await request(app).delete('/api/v1/staff/plan').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ended: true, name: 'gap-validation-sprint' });

    expect(await workspace.readPlanRecord(OPTIO)).toBeNull();
    const ended = await fs.readdir(path.join(plansDir(), 'plans-ended'));
    expect(ended).toHaveLength(1);
    expect(await fs.readFile(path.join(plansDir(), 'plans-ended', ended[0]))).toEqual(before);
    expect(connection._approvedPlan).toBeNull();
    expect(connection._teamWorkspace).toBeNull();

    const board = await request(app).get('/api/v1/staff/board').set(witness.header);
    expect(board.body.plan).toBeNull();
  });

  test('a team run working on the plan is never pulled out from under itself', async () => {
    const connection = live({ _approvedPlan: { name: 'x' }, _teamWorkspace: { root: house } });
    // The live registry is what a background run stands on.
    const { registerRun, endRun } = await import('../../backend/services/team-run-live.js');
    registerRun({ id: 'end-plan-live', wallet: witness.address, laneId: OPTIO, lead: OPTIO, goal: 'g', board: [] });
    const res = await request(app).delete('/api/v1/staff/plan').set(witness.header);
    endRun('end-plan-live');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/stop the run first/);
    expect(await workspace.readPlanRecord(OPTIO)).not.toBeNull();
    expect(connection._teamWorkspace).toEqual({ root: house });
  });

  test('with no plan standing it says so, and changes nothing', async () => {
    await request(app).delete('/api/v1/staff/plan').set(witness.header);
    const again = await request(app).delete('/api/v1/staff/plan').set(witness.header);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/No plan of record/);
    expect(await fs.readdir(path.join(plansDir(), 'plans-ended'))).toHaveLength(1);
  });

  test('a stranger cannot end the house\'s plan; no token is a real 401', async () => {
    const { strangerWitness } = await import('../helpers/witness.js');
    const stranger = strangerWitness();
    const res = await request(app).delete('/api/v1/staff/plan').set(stranger.header);
    expect([403, 404]).toContain(res.status);
    expect(await workspace.readPlanRecord(OPTIO)).not.toBeNull();
    expect((await request(app).delete('/api/v1/staff/plan')).status).toBe(401);
  });
});
