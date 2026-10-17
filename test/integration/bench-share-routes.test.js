/**
 * Bench SUMMARY + SHARE routes (/api/v1/bench/summary, /share, /share/png) —
 * end to end against REAL auth (a real wallet's HMAC token, RULE 0 #390), a
 * REAL fixture harness tree carrying run receipts captured from the
 * sovereign harness, the REAL captured proof certificate, and the REAL
 * Chromium rasterizing the card with the vendored faces embedded.
 *
 * Structure mirrors bench-routes.test.js: env isolation, vi.resetModules,
 * dynamic imports after env is set.
 */
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  buildBenchFixtureTree, addBenchRunFixtures, addBenchProofFixture, FIXTURE_PROOF_ID,
} from '../helpers/bench-fixture-tree.js';

const ENV = [
  'NEUMA_BENCH_HARNESS_PATH', 'NEUMA_BENCH_SERVING_URL', 'NEUMA_BENCH_WATCH_PATH',
  'NEUMA_DATA_ROOT', 'WORKSPACES_ROOT',
];

// PNG bytes 16..23 are the IHDR width and height (big-endian) — the real
// pixel size of what the operator will post.
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });
const PNG_MAGIC = '89504e470d0a1a0a';

// supertest buffers a binary body only when told how.
const binary = (res, done) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('Bench SUMMARY + SHARE routes', () => {
  let house, witness, app, leadId;
  const saved = {};

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) { saved[k] = process.env[k]; }
    house = await createTempDir('bench-share-routes');
    process.env.WORKSPACES_ROOT = path.join(house, 'workspaces');
    process.env.NEUMA_DATA_ROOT = path.join(house, 'data');
    process.env.NEUMA_BENCH_WATCH_PATH = path.join(house, 'watch', 'incidents.jsonl');
    process.env.NEUMA_BENCH_SERVING_URL = 'http://127.0.0.1:9';
    const tree = path.join(house, 'harness');
    await buildBenchFixtureTree(tree);
    await addBenchRunFixtures(tree);
    await addBenchProofFixture(process.env.NEUMA_DATA_ROOT);
    process.env.NEUMA_BENCH_HARNESS_PATH = tree;

    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(process.env.WORKSPACES_ROOT, 'benchshare');
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

  test('no token, no summary — the bench plane is the operator\'s', async () => {
    expect((await request(app).get('/api/v1/bench/summary')).status).toBe(401);
  });

  test('GET /summary — series by the comparability law, each with its chart; what is owed; the proofs', async () => {
    const res = await get('/api/v1/bench/summary');
    expect(res.status).toBe(200);
    const [gsm] = res.body.suites;
    expect(gsm.suiteId).toBe('gsm8k-2568');
    expect(gsm.series.map((s) => s.n)).toEqual([100, 50, 25]);
    const lead = gsm.series[0];
    expect(lead.chart.bars.map((b) => `${b.label} ${b.display}`)).toEqual([
      'BARE 67.0%', 'HARNESS 87.0%', 'SILO 74.0%', 'NEUMA 98.0%',
    ]);
    // Owed counts BENCHMARKS: the gsm8k family is taken — receipts answered
    // its gsm8k-2568 variant — and a variant is never owed on its own.
    expect(res.body.notTaken.map((c) => c.id)).toEqual([]);
    expect(res.body.proofs.map((p) => p.id)).toEqual([FIXTURE_PROOF_ID]);
    expect(res.body.proofs[0].chart.bars.at(-1).display).toBe('90.7%  39/43');
    leadId = lead.id;
  });

  test('GET /share — the Markdown table and the PNG filename for a series and a proof', async () => {
    const lead = (await get('/api/v1/bench/summary')).body.suites[0].series[0];
    const series = await get(`/api/v1/bench/share?kind=series&id=${encodeURIComponent(lead.id)}&size=1x1`);
    expect(series.status).toBe(200);
    expect(series.body.markdown).toContain('| **NEUMA** | **98.0%** | +31.0 pts |');
    expect(series.body.filename).toBe('neuma-bench-gsm8k-2568-2026-09-15-1x1.png');

    const proof = await get(`/api/v1/bench/share?kind=proof&id=${FIXTURE_PROOF_ID}&size=16x9`);
    expect(proof.status).toBe(200);
    expect(proof.body.markdown).toContain('| **TOTAL** | **90.7% 39/43** |');
  });

  test('GET /share — refusals name the fault', async () => {
    const bad = async (q) => (await get(`/api/v1/bench/share?${q}`)).body.error.code;
    expect(await bad('kind=series&id=x&size=9x16')).toBe('BENCH_BAD_SIZE');
    expect(await bad('kind=series&id=../etc&size=1x1')).toBe('BENCH_BAD_ID');
    expect(await bad('kind=chart&id=x&size=1x1')).toBe('BENCH_BAD_KIND');
    expect(await bad('kind=series&id=nope~0~0&size=1x1')).toBe('BENCH_SERIES_NOT_FOUND');
    expect(await bad('kind=proof&id=nope&size=1x1')).toBe('BENCH_PROOF_NOT_FOUND');
  });

  test('GET /share/png — a real PNG at the card\'s dimensions × the raster density, every size', async () => {
    const lead = leadId ?? (await get('/api/v1/bench/summary')).body.suites[0].series[0].id;
    const expected = { '16x9': [4000, 2250], '1x1': [3000, 3000], '4x5': [2700, 3375] };
    for (const [size, [w, h]] of Object.entries(expected)) {
      // eslint-disable-next-line no-await-in-loop -- one Chromium at a time
      const res = await get(`/api/v1/bench/share/png?kind=series&id=${encodeURIComponent(lead)}&size=${size}`)
        .buffer(true).parse(binary);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.body.subarray(0, 8).toString('hex')).toBe(PNG_MAGIC);
      expect(pngSize(res.body)).toEqual({ width: w, height: h });
    }
  }, 120000);
  test('GET /runs/:runId/evidence — WHAT HAPPENED: the stage that died and its real stderr tail', async () => {
    const id = 'night-20260921t031900z-heartbeat-neuma-a1-20260921032101811';
    const res = await get(`/api/v1/bench/runs/${id}/evidence`);
    expect(res.status).toBe(200);
    expect(res.body.executions[0]).toMatchObject({ stage: 'lm-eval', exitCode: 1, ok: false });
    expect(res.body.logs[0].tail).toContain('502 Server Error: Bad Gateway');
    expect((await get('/api/v1/bench/runs/no-such-run/evidence')).status).toBe(404);
    expect((await get('/api/v1/bench/runs/..%2F..%2Fetc/evidence')).status).toBe(400);
    expect((await request(app).get(`/api/v1/bench/runs/${id}/evidence`)).status).toBe(401);
  });
});
