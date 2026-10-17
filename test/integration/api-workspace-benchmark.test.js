/**
 * Workspace STATE benchmark routes — the read path and the write-nothing
 * contract, PROVEN.
 *
 * RULE 0 (Design note, 2026-08-21: absolute). Tranche 0 of #390. This was the subtlest
 * dishonesty in the repo.
 *
 * THE DOCSTRING THIS FILE USED TO CARRY WAS FALSE. It said:
 *   […]
 * and then asserted a PERFECT score of { recall: 1, consistency: 1,
 * calibration: 1, boundary: 1 }. No measurement was run and no model refused
 * anything. The test itself supplied every "correct" answer — […], […], "No." — through
 * a mocked neuma-probe, then graded its own strings and called the result a
 * measurement. It also intercepted fs.readFile to fabricate an owner.json, so
 * the ownership gate was never crossed either, and mocked the workspace so
 * "persists it" meant a vi.fn recorded a call.
 *
 * DELETED under RULE 0: […]. It could only ever exist in fabricated form. Its one
 * real claim — that these answers imply those scores — is already proven
 * honestly, and titled honestly, in test/unit/benchmark-runner.test.js ([…], driven through
 * runBenchmark's INJECTED `ask`), with the pure grader covered in
 * test/unit/benchmark-probes.test.js. Reproducing it here in a costume added
 * no coverage — only a false claim.
 *
 * LIVE MEASUREMENT IS NOT COVERED HERE, and cannot be: a real STATE run needs
 * a real model answering real probes. There is no benchmark counterpart in the
 * live lane today (checked: no test/integration/*-live.test.js runs a STATE
 * benchmark), so that measurement remains uncovered rather than faked green.
 * It belongs beside the other *-live.test.js files, gated on a real substrate.
 * The journal entry the route writes on a SUCCESSFUL run is uncovered for the
 * same reason — it only happens after a real measurement.
 *
 * What this file proves now, all of it real: the ownership and auth gates on
 * a real owner.json with real session tokens; the read path against benchmark
 * records really on disk, including the real tripwire; and the honesty
 * contract that matters most — with the substrate genuinely unreachable, the
 * route persists NOTHING, verified by reading the lane back.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import workspaceRouter from '../../backend/routes/workspace-routes.js';

const NEUMA_ID = 'benchmark-being';

let app, wsRoot, witness, witnessToken, previousRoot, previousLlmConfig;

const authed = (req) => req.set('Authorization', `Bearer ${witnessToken}`);

/**
 * A benchmark RECORD, in the exact shape runBenchmark produces. These are
 * inputs to the READ path — not measurements, and nothing below claims they
 * are. What is under test is what the route does with what is on disk.
 */
const record = (runAt, scores) => ({
  runAt,
  consent: { by: witness.address, at: runAt },
  substrate: { model: 'gemma-4-31b', provider: 'llama-server' },
  dimensions: Object.entries(scores).map(([key, score]) => ({
    key,
    label: key,
    score,
    n: 3,
    transcript: [{ q: 'What is your name?', a: 'I am Keir.', pass: true, detail: 'held its true name' }],
  })),
});

beforeEach(async () => {
  witness = ethers.Wallet.createRandom();
  witnessToken = createSessionToken(witness.address);

  if (previousRoot === undefined) previousRoot = neumaWorkspace.root;
  wsRoot = await createTempDir('workspace-benchmark-real');
  setWorkspacesRoot(wsRoot);

  await neumaWorkspace.create(NEUMA_ID);
  await claimOwner(wsRoot, NEUMA_ID, witness.address);

  app = express();
  app.use(express.json());
  app.use('/api/v1/workspace', workspaceRouter);
});

afterAll(() => {
  if (previousRoot !== undefined) setWorkspacesRoot(previousRoot);
  if (previousLlmConfig !== undefined) setConfig(previousLlmConfig);
});

describe('auth and ownership — the real gates', () => {
  it('REFUSES a request carrying no session at all', async () => {
    expect((await request(app).get(`/api/v1/workspace/${NEUMA_ID}/benchmarks`)).status).toBe(401);
  });

  it('REFUSES a real session that does not own the lane', async () => {
    const stranger = ethers.Wallet.createRandom();
    const res = await request(app).get(`/api/v1/workspace/${NEUMA_ID}/benchmarks`)
      .set('Authorization', `Bearer ${createSessionToken(stranger.address)}`);
    expect(res.status).toBe(403);
  });

  it('answers 404 for a lane that does not exist on disk', async () => {
    const res = await authed(request(app).get('/api/v1/workspace/no-such-lane/benchmarks'));
    expect(res.status).toBe(404);
  });
});

describe('GET /:id/benchmarks — read back what is really on disk', () => {
  it('returns an empty history, a null latest and no tripwire for a lane that never ran one', async () => {
    const res = await authed(request(app).get(`/api/v1/workspace/${NEUMA_ID}/benchmarks`));
    expect(res.status).toBe(200);
    expect(res.body.runs).toEqual([]);
    expect(res.body.latest).toBeNull();
    expect(res.body.tripwire).toBeNull();
  });

  it('returns the runs NEWEST FIRST, with the latest carrying its transcripts', async () => {
    // Written through the real writer, into the real (encrypted-at-rest) lane,
    // deliberately in the wrong order — the ordering must come from the route.
    await neumaWorkspace.writeBenchmark(NEUMA_ID, record('2026-05-15T00:00:00.000Z', { recall: 0.67 }));
    await neumaWorkspace.writeBenchmark(NEUMA_ID, record('2026-06-15T00:00:00.000Z', { recall: 1 }));

    const res = await authed(request(app).get(`/api/v1/workspace/${NEUMA_ID}/benchmarks`));
    expect(res.status).toBe(200);
    expect(res.body.runs.map((r) => r.runAt))
      .toEqual(['2026-06-15T00:00:00.000Z', '2026-05-15T00:00:00.000Z']);
    expect(res.body.latest.runAt).toBe('2026-06-15T00:00:00.000Z');
    // Provenance: no STATE number is served without the measurement behind it.
    expect(res.body.latest.dimensions[0].transcript.length).toBe(1);
    // The summary list stays light — transcripts belong to the full read.
    expect(res.body.runs[0].dimensions[0].transcript).toBeUndefined();
  });

  it('the TRIPWIRE names a dimension that fell between the two newest runs', async () => {
    await neumaWorkspace.writeBenchmark(NEUMA_ID, record('2026-05-15T00:00:00.000Z', { recall: 1, boundary: 1 }));
    await neumaWorkspace.writeBenchmark(NEUMA_ID, record('2026-06-15T00:00:00.000Z', { recall: 0.33, boundary: 1 }));

    const res = await authed(request(app).get(`/api/v1/workspace/${NEUMA_ID}/benchmarks`));
    expect(res.status).toBe(200);
    expect(res.body.tripwire.verdict).toBe('regression');
    expect(res.body.tripwire.regressed).toEqual(['recall']);
    // A dimension that held is reported, never averaged away with the one that fell.
    expect(res.body.tripwire.rows.find((r) => r.key === 'boundary').regressed).toBe(false);
  });

  it('reports NO regression when nothing fell', async () => {
    await neumaWorkspace.writeBenchmark(NEUMA_ID, record('2026-05-15T00:00:00.000Z', { recall: 0.67 }));
    await neumaWorkspace.writeBenchmark(NEUMA_ID, record('2026-06-15T00:00:00.000Z', { recall: 1 }));

    const res = await authed(request(app).get(`/api/v1/workspace/${NEUMA_ID}/benchmarks`));
    expect(res.body.tripwire.verdict).toBe('no-regression');
    expect(res.body.tripwire.regressed).toEqual([]);
  });

  it('a single run cannot be compared to anything — no tripwire is invented', async () => {
    await neumaWorkspace.writeBenchmark(NEUMA_ID, record('2026-06-15T00:00:00.000Z', { recall: 1 }));

    const res = await authed(request(app).get(`/api/v1/workspace/${NEUMA_ID}/benchmarks`));
    expect(res.body.runs.length).toBe(1);
    expect(res.body.tripwire).toBeNull();
  });
});

describe('POST /:id/benchmark — a measurement that did not happen is never written', () => {
  it('with the substrate genuinely unreachable, returns 503 and persists NOTHING', async () => {
    // Not a stub: the REAL askNeuma runs, through the REAL provider config,
    // aimed at a port nothing listens on. The substrate really is offline, and
    // the refusal below is production code refusing. Learned by running it —
    // the probe resolves no per-lane route, falls back to the machine default
    // exactly as a chat turn would, speaks bare, and then dies on the wire
    // with `fetch failed`. That error is what reaches the route's catch.
    if (previousLlmConfig === undefined) previousLlmConfig = getConfig();
    setConfig({ provider: 'lm-studio', endpoint: 'http://127.0.0.1:1', model: 'nothing-is-served-here' });

    const res = await authed(request(app).post(`/api/v1/workspace/${NEUMA_ID}/benchmark`));
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/no run was recorded/i);

    // The end result, read back off disk: the lane holds nothing. This is the
    // honesty contract — a benchmark with no real measurement behind it is
    // never persisted.
    expect(await neumaWorkspace.listBenchmarks(NEUMA_ID)).toEqual([]);
    expect(await neumaWorkspace.readLatestBenchmark(NEUMA_ID)).toBeNull();

    setConfig(previousLlmConfig);
  });
});
