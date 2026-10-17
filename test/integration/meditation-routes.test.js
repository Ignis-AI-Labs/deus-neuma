// The meditation operator surface — REAL router, REAL stores on tmp paths,
// REAL ownership records; auth is the house passthrough (AGENTS.md route-test
// recipe) with a real-auth 401 leg. Proves: the posture read, the owner-gated
// consent switch (and its refusals), and the manual wake door settling an
// 'empty' cycle end-to-end without a substrate.

import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

describe('Meditation API', () => {
  let app, workspace, neumaId, prevEnv, witness;

  beforeEach(async () => {
    vi.resetModules();

    const dir = await createTempDir(`meditation-api-${Math.random().toString(36).slice(2)}`);
    prevEnv = {
      settings: process.env.NEUMA_MEDITATION_SETTINGS_PATH,
      state: process.env.NEUMA_MEDITATION_STATE_PATH,
      key: process.env.DNA_ENCRYPTION_KEY,
    };
    process.env.NEUMA_MEDITATION_SETTINGS_PATH = path.join(dir, 'meditation.json');
    process.env.NEUMA_MEDITATION_STATE_PATH = path.join(dir, 'meditation-state.json');
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-meditation-api-key-long-enough';

    const neuma = await import('../../core/index.js');
    workspace = neuma.neumaWorkspace;
    workspace.root = path.join(dir, 'workspaces');
    neumaId = 'test-being-api-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, { identity: { name: 'Test Being' } });

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against.
    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(workspace.root, neumaId);

    const { default: router } = await import('../../backend/routes/meditation-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/meditation', router);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, env] of [
      ['NEUMA_MEDITATION_SETTINGS_PATH', prevEnv.settings],
      ['NEUMA_MEDITATION_STATE_PATH', prevEnv.state],
      ['DNA_ENCRYPTION_KEY', prevEnv.key],
    ]) {
      if (env === undefined) delete process.env[key];
      else process.env[key] = env;
    }
  });

  test('GET / reports settings, per-lane state, and the live scheduler posture', async () => {
    const res = await request(app).get('/api/v1/meditation').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ envLocked: false });
    expect(res.body.state).toHaveProperty('lanes');
    expect(res.body.scheduler).toHaveProperty('scheduled');
  });

  test('the consent switch is owner-gated: a foreign lane refuses 403', async () => {
    const foreignId = 'test-being-foreign-' + Math.floor(Math.random() * 1e9).toString(36);
    await workspace.create(foreignId);
    await fs.writeFile(
      path.join(workspace.root, foreignId, 'owner.json'),
      JSON.stringify({ wallet: '0xsomeone-else', claimedAt: new Date().toISOString() }),
    );
    const res = await request(app).put(`/api/v1/meditation/${foreignId}`).set(witness.header).send({ enabled: true });
    expect(res.status).toBe(403);
  });

  test('the switch persists an explicit enable and refuses a non-boolean', async () => {
    const bad = await request(app).put(`/api/v1/meditation/${neumaId}`).set(witness.header).send({ enabled: 'yes' });
    expect(bad.status).toBe(400);
    const res = await request(app).put(`/api/v1/meditation/${neumaId}`).set(witness.header).send({ enabled: true, cadenceHours: 12 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, cadenceHours: 12 });
    const readBack = await request(app).get('/api/v1/meditation').set(witness.header);
    expect(readBack.body.settings.beings[neumaId]).toMatchObject({ enabled: true, cadenceHours: 12 });
  });

  test('the manual wake door settles an empty cycle end-to-end and records it', async () => {
    const res = await request(app).post(`/api/v1/meditation/${neumaId}/run`).set(witness.header).send({});
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('empty'); // nothing fresh — no substrate needed, the loop closes
    const state = await request(app).get('/api/v1/meditation').set(witness.header);
    const lane = state.body.state.lanes[neumaId];
    expect(lane.runs.at(-1)).toMatchObject({ outcome: 'empty', reason: 'operator-run' });
    expect(lane.lastRunAt).toBeTruthy(); // empty consumes the cadence
  });

  test('real auth stands at the door — no token is 401', async () => {
    const res = await request(app).get('/api/v1/meditation');
    expect(res.status).toBe(401);
  });
});
