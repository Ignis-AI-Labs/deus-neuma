// THE FORGE'S ATTEMPT LOG READS PER HOUSE (audit 2026-10-28 L-09). RULE 0: the real router behind
// the real requireAuth, real session tokens, real owner records on a real temp workspace, and the
// real attempt log on disk. Before: every signed-in wallet read every lane's prompts and names.
import express from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import workspace, { getWitnessesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { recordAttempt, toAttemptRecord } from '../../backend/services/image-forge/attempt-log.js';

let root; let saved; let app; let first; let second;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-attempts-scope-'));
  saved = { root: workspace.root, witnesses: getWitnessesRoot(), log: process.env.COMFYUI_ATTEMPT_LOG_PATH, data: process.env.NEUMA_DATA_ROOT };
  workspace.root = path.join(root, 'lanes');
  setWitnessesRoot(path.join(root, 'witnesses'));
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  process.env.COMFYUI_ATTEMPT_LOG_PATH = path.join(root, 'attempts.jsonl');
  first = await fullAuth();
  second = await fullAuth();
  for (const [lane, who] of [['lane-first', first], ['lane-second', second]]) {
    await workspace.create(lane);
    await claimOwner(workspace.root, lane, who.address);
    recordAttempt(toAttemptRecord({ jobId: `${lane}-job`, laneId: lane, beingName: `${lane}-name`, positive: `${lane} prompt`, outcome: 'refused', at: new Date().toISOString() }));
  }
  recordAttempt(toAttemptRecord({ jobId: 'desk-job', laneId: null, positive: 'the desk\'s own prompt', outcome: 'ok', at: new Date().toISOString() }));
  const { default: router } = await import('../../backend/routes/image-forge-routes.js');
  app = express();
  app.use('/api/v1/image-forge', router);
});

afterAll(async () => {
  workspace.root = saved.root;
  setWitnessesRoot(saved.witnesses);
  for (const [k, v] of [['COMFYUI_ATTEMPT_LOG_PATH', saved.log], ['NEUMA_DATA_ROOT', saved.data]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await fs.rm(root, { recursive: true, force: true });
});

const read = async (who) => (await request(app).get('/api/v1/image-forge/attempts').set('Authorization', `Bearer ${who.token}`)).body;

test('each house reads only its own lanes\' attempts; the laneless desk entry is the install owner\'s', async () => {
  // the first wallet at this desk is its owner (install-owner.js), so it also reads the desk's own
  const mine = await read(first);
  expect(mine.entries.map((e) => e.jobId).sort()).toEqual(['desk-job', 'lane-first-job']);
  expect(mine.total).toBe(2);
  const theirs = await read(second);
  expect(theirs.entries.map((e) => e.jobId)).toEqual(['lane-second-job']);
  expect(JSON.stringify(theirs)).not.toContain('lane-first');
  expect(theirs.total).toBe(1);
});
