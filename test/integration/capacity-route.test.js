import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';

/**
 * Integration tests for the substrate capacity routes (non-:id, rig-level).
 *
 * The REAL router, REAL capacity store on a real temp disk, and the REAL scan
 * path all the way to a real TCP connection attempt — the "offline" cases
 * point the provider at a dead local port and watch the genuine failure path
 * (testConnection → false → 503, nothing written). Only the auth gate uses
 * the documented passthrough pattern; a dedicated test proves the real 401.
 * The live-server measurement itself is proven in capacity-scan-live.test.js.
 */
describe('Substrate capacity routes', () => {
  let app;
  let dir;
  let setConfig;
  let witness;

  beforeEach(async () => {
    dir = await createTempDir('capacity-route');
    process.env.NEUMA_CAPACITY_PATH = dir;

    vi.resetModules();

    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against.
    const { strangerWitness } = await import('../helpers/witness.js');
    // This router carries no neuma lane — a real session that claims no
    // workspace is exactly the right shape.
    witness = strangerWitness();

    ({ setConfig } = await import('../../backend/services/llm-provider.js'));
    // A local provider at a dead port: scannable, but genuinely unreachable.
    setConfig({ provider: 'lm-studio', endpoint: 'http://127.0.0.1:59999', model: 'test-model' });

    const { default: substrateRouter } = await import('../../backend/routes/substrate-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/substrate', substrateRouter);
  });

  afterEach(async () => {
    delete process.env.NEUMA_CAPACITY_PATH;
    await fs.rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('401 without a real session token (real auth)', async () => {
    // Auth is real now — no header against the real router IS the real 401.
    expect((await request(app).get('/api/v1/substrate/capacity')).status).toBe(401);
    expect((await request(app).post('/api/v1/substrate/capacity')).status).toBe(401);
  });

  test('GET before any scan: honest empty history, measurable on a local provider', async () => {
    const res = await request(app).get('/api/v1/substrate/capacity').set(witness.header);
    expect(res.status).toBe(200);
    // `current` (the live substrate snapshot for model-aware staleness)
    // joined the payload after this test was written — its exact contents
    // are the substrate lens's concern; this contract test pins the history
    // semantics and that a snapshot is present.
    expect(res.body).toMatchObject({ runs: [], latest: null, measurable: true });
    expect(res.body.current).toMatchObject({ provider: 'lm-studio', model: expect.any(String) });
  });

  test('POST with the substrate offline: 503 and nothing written (AC-4)', async () => {
    const res = await request(app).post('/api/v1/substrate/capacity').set(witness.header);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/No scan was recorded/);
    expect(await fs.readdir(dir).catch(() => [])).toEqual([]);
  });

  test('POST on a remote provider: 400 not measurable, nothing fired', async () => {
    setConfig({ provider: 'anthropic', endpoint: 'https://api.anthropic.com', model: 'claude' });
    const res = await request(app).post('/api/v1/substrate/capacity').set(witness.header);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not measurable/i);
  });

  test('GET on a remote provider reports measurable: false (drives NOT MEASURABLE state)', async () => {
    setConfig({ provider: 'openai', endpoint: 'https://api.openai.com', model: 'gpt' });
    const res = await request(app).get('/api/v1/substrate/capacity').set(witness.header);
    expect(res.body.measurable).toBe(false);
  });

  test('POST when the scan completes but the store write fails: 200 with the result, stored: false, nothing recorded', { timeout: 60000 }, async () => {
    // A REAL local provider: a tiny HTTP server speaking the OpenAI SSE chat
    // shape the probe parser reads — the scan genuinely runs its whole ladder
    // over real sockets. No mock anywhere.
    const provider = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"one two three"}}]}\n');
      res.write('data: [DONE]\n');
      res.end();
    });
    const port = await new Promise((resolve) =>
      provider.listen(0, '127.0.0.1', () => resolve(provider.address().port)));
    setConfig({ provider: 'lm-studio', endpoint: `http://127.0.0.1:${port}`, model: 'test-model' });

    // A REAL store failure: the store path is occupied by a plain FILE, so the
    // store's own mkdir/write genuinely fails on real disk.
    const occupied = path.join(dir, 'occupied-store');
    await fs.writeFile(occupied, 'a file sitting where the store dir must go');
    process.env.NEUMA_CAPACITY_PATH = occupied;

    try {
      const res = await request(app).post('/api/v1/substrate/capacity').set(witness.header);
      // The scan is a fact the witness paid load for: persistence failing must
      // surface as stored:false — never the offline 503 […].
      expect(res.status).toBe(200);
      expect(res.body.stored).toBe(false);
      expect(res.body.id).toBeNull();
      expect(res.body.result.ceiling).toBeGreaterThanOrEqual(1);
      expect(res.body.result.rawSamples.length).toBeGreaterThan(0);
      // And truly nothing recorded: the path is still just the occupying file.
      expect((await fs.stat(occupied)).isFile()).toBe(true);
    } finally {
      provider.closeAllConnections?.();
      await new Promise((resolve) => provider.close(resolve));
    }
  });

  test('GET returns stored runs newest-first with the latest full record', async () => {
    const { writeCapacity } = await import('../../backend/services/capacity-store.js');
    const result = (runAt, ceiling) => ({
      ceiling, limitedBy: 'throughput', incomplete: false,
      aggregateTokPerSecAtCeiling: 100 * ceiling, perAgentLatencyAtCeiling: 1200,
      boundClass: 'A', vramFitEstimate: null,
      rawSamples: [{ concurrency: 1, aggregateTokPerSec: 100, perAgentLatencyMs: 1000, ok: true, tokenSource: 'whitespace-proxy' }],
      substrate: { model: 'test-model', provider: 'lm-studio', endpoint: 'http://127.0.0.1:59999', gpu: null, vramGB: null, memoryGB: 64 },
      runAt, consent: { by: '0xtest', at: runAt },
    });
    await writeCapacity(result('2026-07-04T10:00:00.000Z', 4));
    await writeCapacity(result('2026-07-04T12:00:00.000Z', 8));

    const res = await request(app).get('/api/v1/substrate/capacity').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.runs.map((r) => r.ceiling)).toEqual([8, 4]);
    expect(res.body.runs[0].rawSamples).toBeUndefined(); // summaries stay light
    // The desk may use no more than the server's slots run (the line fronts
    // them); the measured number stays, named as measured (2026-10-13).
    expect(res.body.latest).toMatchObject({ ceiling: 4, measuredCeiling: 8, servedSlots: 4 });
    expect(res.body.latest.rawSamples).toHaveLength(1); // full record keeps provenance
  });
});
