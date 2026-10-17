/**
 * bench-diagnose.test.js — GET /api/v1/bench/diagnose/:comparisonId end to
 * end (#557): REAL wallet auth, a temp harness tree holding the REAL captured
 * validation-night runs (trimmed), and one arm invalidated through the
 * harness's own invalidation.json format — it must be skipped, never
 * diagnosed as if it counted. No mocks.
 */
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { buildBenchFixtureTree } from '../helpers/bench-fixture-tree.js';

const ENV = ['NEUMA_BENCH_HARNESS_PATH', 'NEUMA_BENCH_SERVING_URL', 'NEUMA_DATA_ROOT', 'WORKSPACES_ROOT'];
const GSM = 'validate-20260925t193750z-gsm100-4arm';

describe('GET /api/v1/bench/diagnose/:comparisonId', () => {
  let house, tree, witness, app;
  const saved = {};

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) { saved[k] = process.env[k]; }
    house = await createTempDir('bench-diagnose');
    tree = path.join(house, 'harness');
    await buildBenchFixtureTree(tree);
    await fs.cp(path.resolve('test/fixtures/bench/diagnose'), path.join(tree, 'runs'), { recursive: true });
    process.env.NEUMA_BENCH_HARNESS_PATH = tree;
    process.env.NEUMA_BENCH_SERVING_URL = 'http://127.0.0.1:9';
    process.env.NEUMA_DATA_ROOT = path.join(house, 'data');
    process.env.WORKSPACES_ROOT = path.join(house, 'workspaces');
    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(process.env.WORKSPACES_ROOT, 'benchlane');
    const { default: router } = await import('../../backend/routes/bench-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/bench', router);
  });

  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const get = (url) => request(app).get(url).set(witness.header);

  test('a real matched set diagnoses every arm, classed and paired against BARE', async () => {
    const res = await get(`/api/v1/bench/diagnose/${GSM}`);
    expect(res.status).toBe(200);
    const { diagnosis, markdown } = res.body;
    expect(diagnosis.arms.map((a) => a.arm)).toEqual(['bare', 'platform', 'silo', 'neuma']);
    expect(diagnosis.arms.find((a) => a.arm === 'silo').causes.format).toBeGreaterThan(0);
    expect(diagnosis.arms.find((a) => a.arm === 'platform').causes['budget-in-reasoning']).toBe(1);
    expect(markdown).toContain('### What is getting in the way');
  });

  test('an invalidated arm is skipped with its reason, never diagnosed as counting', async () => {
    const runs = await fs.readdir(path.join(tree, 'runs'));
    const siloRun = runs.find((d) => d.startsWith(GSM) && d.includes('-silo-a'));
    await fs.writeFile(path.join(tree, 'runs', siloRun, 'invalidation.json'),
      JSON.stringify({ runId: siloRun, reason: 'test strike', by: 'test', at: new Date().toISOString() }));
    const res = await get(`/api/v1/bench/diagnose/${GSM}`);
    expect(res.status).toBe(200);
    expect(res.body.diagnosis.arms.map((a) => a.arm)).not.toContain('silo');
    expect(res.body.diagnosis.skipped[0]).toMatchObject({ arm: 'silo', reason: 'invalidated — test strike' });
  });

  test('unknown set 404s, a crafted id 400s, and the route demands the operator token', async () => {
    expect((await get('/api/v1/bench/diagnose/no-such-set')).status).toBe(404);
    expect((await get('/api/v1/bench/diagnose/..%2F..%2Fetc')).status).toBe(400);
    expect((await request(app).get(`/api/v1/bench/diagnose/${GSM}`)).status).toBe(401);
  });
});
