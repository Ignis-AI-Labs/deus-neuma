/**
 * bench read models + launch argv — RULE 0: every parser runs against REAL
 * artifacts captured from the sovereign harness (test/fixtures/bench/), the
 * serving probe runs against a REAL loopback HTTP server (up and down), and
 * buildArgs is proven pure against catalog facts loaded by the REAL catalog
 * readers from the fixture tree. No mock, stub, fake, or spy anywhere.
 */
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  buildBenchFixtureTree, FIXTURE_NIGHT_STAMP, FIXTURE_BUNDLE_ID, FIXTURE_PLAN_NAME,
} from '../helpers/bench-fixture-tree.js';

const NIGHT_STAMP = FIXTURE_NIGHT_STAMP;
const BUNDLE_ID = FIXTURE_BUNDLE_ID;
const PLAN_NAME = FIXTURE_PLAN_NAME;

let tree; // the fixture harness tree, built once from the committed fixtures

// The real modules under test — static imports: nothing here needs env
// isolation because every reader takes the root explicitly.
import { available, resolveInside, servingUrl } from '../../backend/services/bench/bench-paths.js';
import {
  parseNightStatus, readLatestNightStatus, probeServing, pidAlive,
  readServingIncidents, readJsonlTail, readLoadedModel, supervisorOnBenchEndpoint,
} from '../../backend/services/bench/bench-status.js';
import {
  listBundles, readBundleArtifact, readScoreboard, parseMetricsCsv, listRuns,
} from '../../backend/services/bench/bench-reports.js';
import {
  listCells, getCell, applyVariant, listModels, getModel, listPlans, isPlanName,
} from '../../backend/services/bench/bench-catalog.js';
import { buildArgs, validateDeadline, isIsoWithTimezone, VERBS } from '../../backend/services/bench/bench-launch.js';
import { readFileSync } from 'node:fs';

beforeAll(async () => {
  tree = await createTempDir('bench-harness');
  await buildBenchFixtureTree(tree);
});

describe('bench-paths', () => {
  test('available() — true on the fixture tree, false without bench.mjs, false on a missing root', async () => {
    expect(available(tree)).toBe(true);
    const bare = await createTempDir('bench-bare');
    expect(available(bare)).toBe(false);
    expect(available(path.join(bare, 'nowhere'))).toBe(false);
  });

  test('resolveInside — joins inside, refuses traversal totally', () => {
    expect(resolveInside(tree, 'logs', 'x.json')).toBe(path.join(tree, 'logs', 'x.json'));
    expect(() => resolveInside(tree, '..', 'outside')).toThrow(/escapes/);
    expect(() => resolveInside(tree, 'logs', '..', '..', 'outside')).toThrow(/escapes/);
  });
});

describe('night status', () => {
  test('readLatestNightStatus — projects the real window status', async () => {
    const night = await readLatestNightStatus(tree);
    expect(night.file).toBe(`${NIGHT_STAMP}-status.json`);
    expect(night.status).toBe('deadline-or-signal');
    expect(night.waitingFor).toBe('model-endpoint');
    expect(night.startedAt).toBe('2026-09-21T19:22:52.799Z');
    expect(night.deadline).toBe('2026-09-22T03:17:52.709Z');
    expect(night.groups).toEqual([{ id: 'heartbeat', status: 'endpoint-unavailable' }]);
    expect(night.steps).toEqual([]);
    expect(night.stepCount).toBe(0);
    expect(night.unstartedGroups).toEqual(['arc-bare']);
    expect(night.finishedAt).toBe('2026-09-22T03:16:28.434Z');
    expect(Number.isFinite(night.mtimeMs)).toBe(true);
  });

  test('readLatestNightStatus — null when the logs dir holds no window status', async () => {
    const empty = await createTempDir('bench-nologs');
    await fs.mkdir(path.join(empty, 'logs'), { recursive: true });
    expect(await readLatestNightStatus(empty)).toBeNull();
  });

  test('parseNightStatus — pure projection tolerates missing sections', () => {
    const projected = parseNightStatus({ status: 'running' }, 'night-x-status.json', 1);
    expect(projected.groups).toEqual([]);
    expect(projected.unstartedGroups).toEqual([]);
    expect(projected.waitingFor).toBeNull();
    expect(projected.serving).toBeNull();
  });
});

describe('serving probe — real loopback HTTP, no mock', () => {
  let server, base;
  afterEach(async () => {
    if (server) await new Promise((done) => server.close(done));
    server = null;
  });

  test('a live endpoint reports its model ids', async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'qwen3.8-27b' }, { id: 'gemma-4-31b' }] }));
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${server.address().port}`;
    const probe = await probeServing(base);
    expect(probe.ok).toBe(true);
    expect(probe.models).toEqual(['qwen3.8-27b', 'gemma-4-31b']);
  });

  test('a dead endpoint is a reading, never a throw', async () => {
    server = http.createServer(() => {});
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const port = server.address().port;
    await new Promise((done) => server.close(done));
    server = null;
    const probe = await probeServing(`http://127.0.0.1:${port}`);
    expect(probe.ok).toBe(false);
    expect(typeof probe.error).toBe('string');
  });
});

describe('pid + incidents', () => {
  test('pidAlive — this process lives; nonsense pids do not', () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-5)).toBe(false);
  });

  test('readServingIncidents — the real journal tail parses row by row', async () => {
    const rows = await readServingIncidents(tree);
    expect(rows.length).toBe(1);
    expect(rows[0].event).toBe('postmortem');
    expect(rows[0].downMs).toBe(173100000);
    expect(rows[0].note).toContain('watchdog now owns this');
  });

  test('readJsonlTail — missing file reads as empty, a truncated tail line is skipped', async () => {
    expect(await readJsonlTail(path.join(tree, 'logs', 'absent.jsonl'))).toEqual([]);
    const ragged = path.join(tree, 'logs', 'ragged.jsonl');
    await fs.writeFile(ragged, '{"a":1}\n{"b":2\n{"c":3}\n');
    const rows = await readJsonlTail(ragged);
    expect(rows).toEqual([{ a: 1 }, { c: 3 }]);
  });
});

describe('reports', () => {
  test('listBundles — the fixture bundle, newest first', async () => {
    const bundles = await listBundles(tree);
    expect(bundles.length).toBe(1);
    expect(bundles[0].id).toBe(BUNDLE_ID);
    expect(Number.isFinite(bundles[0].mtimeMs)).toBe(true);
  });

  test('readBundleArtifact — the real REPORT.md, queue-status and metrics.csv', async () => {
    const report = await readBundleArtifact(tree, BUNDLE_ID, 'report');
    expect(report).toContain('# Benchmark night 20260920t230631z');
    const queue = JSON.parse(await readBundleArtifact(tree, BUNDLE_ID, 'queue'));
    expect(queue.status).toBe('completed-with-failures');
    const metrics = parseMetricsCsv(await readBundleArtifact(tree, BUNDLE_ID, 'metrics'));
    expect(metrics.length).toBe(2);
  });

  test('readBundleArtifact — id + artifact refusals are coded, misses are null', async () => {
    await expect(readBundleArtifact(tree, '../..', 'report')).rejects.toMatchObject({ code: 'BENCH_BAD_ID' });
    await expect(readBundleArtifact(tree, 'bad/id', 'report')).rejects.toMatchObject({ code: 'BENCH_BAD_ID' });
    await expect(readBundleArtifact(tree, BUNDLE_ID, 'plan.json')).rejects.toMatchObject({ code: 'BENCH_BAD_ARTIFACT' });
    expect(await readBundleArtifact(tree, 'no-such-bundle', 'report')).toBeNull();
    // The fixture bundle carries no receipts.json — an honest null, not a crash.
    expect(await readBundleArtifact(tree, BUNDLE_ID, 'receipts')).toBeNull();
  });

  test('parseMetricsCsv — real rows incl. quoted commas; header-only parses empty', async () => {
    const text = await readBundleArtifact(tree, BUNDLE_ID, 'metrics');
    const rows = parseMetricsCsv(text);
    expect(rows).toEqual([
      {
        runId: 'night-20260920t230631z-heartbeat-neuma-a1-20260920230831179',
        comparisonId: 'night-20260920t230631z-heartbeat',
        arm: 'neuma', status: 'succeeded', attempt: 1,
        metric: 'gsm8k/exact_match,strict-match', value: 0.96,
      },
      {
        runId: 'night-20260920t230631z-heartbeat-neuma-a1-20260920230831179',
        comparisonId: 'night-20260920t230631z-heartbeat',
        arm: 'neuma', status: 'succeeded', attempt: 1,
        metric: 'gsm8k/exact_match,flexible-extract', value: 0.96,
      },
    ]);
    expect(parseMetricsCsv('runId,comparisonId,arm,status,attempt,metric,value\n')).toEqual([]);
    expect(parseMetricsCsv('')).toEqual([]);
  });

  test('readScoreboard — the three texts; an empty tree reads nulls', async () => {
    const board = await readScoreboard(tree);
    expect(board.scoreboard).toContain('SCOREBOARD');
    expect(board.ladder).toContain('LADDER');
    expect(board.nightLatest.length).toBeGreaterThan(0);
    const empty = await createTempDir('bench-noboard');
    expect(await readScoreboard(empty)).toEqual({ scoreboard: null, ladder: null, nightLatest: null });
  });

  test('listRuns — no runs dir reads empty, never throws', async () => {
    expect(await listRuns(tree)).toEqual([]);
  });

  test('listRuns — the REAL W5 receipt projects every ledger field; a sparse receipt stays null-honest', async () => {
    const receipt = JSON.parse(readFileSync(path.resolve('test/fixtures/bench/receipt-w5.json'), 'utf8'));
    const runDir = path.join(tree, 'runs', receipt.runId);
    await fs.mkdir(runDir, { recursive: true });
    await fs.copyFile(path.resolve('test/fixtures/bench/receipt-w5.json'), path.join(runDir, 'receipt.json'));
    const sparseDir = path.join(tree, 'runs', 'old-run');
    await fs.mkdir(path.join(tree, 'runs', 'old-run'), { recursive: true });
    await fs.writeFile(path.join(sparseDir, 'receipt.json'), JSON.stringify({ runId: 'old-run', status: 'succeeded' }));

    const rows = await listRuns(tree);
    expect(rows.length).toBe(2);
    const w5 = rows.find((r) => r.runId === receipt.runId);
    expect(w5.suiteId).toBe('smoke');
    expect(w5.suiteTier).toBe('t0');
    expect(w5.startedAt).toBe('2026-09-23T09:06:27.544Z');
    expect(w5.durationMs).toBe(58993);
    expect(w5.primaryMetric).toEqual({ id: 'gsm8k/exact_match,strict-match', value: 0.8, unit: 'ratio' });
    expect(w5.tokens).toEqual({ prompt: 6600, completion: 743 });
    expect(w5.hashes.model).toBe('4e7735df4d1e2ec721f2551f531b815702a2f89123238c564797eda4b0304bc2');
    expect(w5.hashes.samples).toBe('a8bc48fa8d083d8ec4d59c6b09de23e011f2157087232e3eba9223c932c9aba7');
    expect(w5.modelId).toBe('Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf');
    expect(w5.quantization).toBe('Q8_K_P');
    expect(w5.approvedBy).toBe('0x0b8aa7ee9b16e5f4cdb366f2e7096a9c01ae69b5');

    const old = rows.find((r) => r.runId === 'old-run');
    expect(old.primaryMetric).toBeNull();
    expect(old.tokens).toBeNull();
    expect(old.hashes).toEqual({ protocol: null, model: null, tokenizer: null, samples: null });
  });
});

describe('catalog', () => {
  test('listCells — the real gsm8k family: its base and its variant, projected', async () => {
    const cells = await listCells(tree);
    expect(cells.map((c) => c.id)).toEqual(['gsm8k', 'gsm8k-2568']);
    expect(cells[0]).toMatchObject({
      id: 'gsm8k',
      tier: 't1',
      dimensions: ['math', 'reasoning'],
      arms: ['bare', 'platform', 'harness', 'silo', 'neuma'],
      adapter: 'lm-eval',
      family: 'gsm8k',
      variant: false,
    });
    expect(cells[0].cost.gpu).toBe(true);
    // The variant is laid over its base: its own id and label, the rest inherited.
    expect(cells[1]).toMatchObject({ id: 'gsm8k-2568', family: 'gsm8k', variant: true, tier: 't1', adapter: 'lm-eval', arms: cells[0].arms });
    expect(cells[1].label).toContain('2568-token');
  });

  test('applyVariant — the harness law: objects merge, arrays and scalars replace whole', () => {
    const base = { id: 'b', arms: ['bare', 'neuma'], protocol: { maxTokens: 768, fewshot: 8 } };
    expect(applyVariant(base, { id: 'v', arms: ['neuma'], protocol: { maxTokens: 2568 } }))
      .toEqual({ id: 'v', arms: ['neuma'], protocol: { maxTokens: 2568, fewshot: 8 } });
    expect(base.protocol.maxTokens).toBe(768); // the base is never mutated
  });

  test('getCell — found by id; unknown and bad-charset ids read null', async () => {
    expect((await getCell(tree, 'gsm8k')).id).toBe('gsm8k');
    expect((await getCell(tree, 'gsm8k-2568')).family).toBe('gsm8k'); // a variant launches like any cell
    expect(await getCell(tree, 'nope')).toBeNull();
    expect(await getCell(tree, '../etc')).toBeNull();
  });

  test('listModels — the real models.json table with flags', async () => {
    const models = await listModels(tree);
    expect(models.map((m) => m.key).sort()).toEqual([
      'gemma-4-31b', 'qwen3-30b-a3b-thinking', 'qwen3.8-27b', 'qwen3.8-27b-uncensored-hauhaucs',
    ]);
    const qwen = models.find((m) => m.key === 'qwen3.8-27b');
    expect(qwen.hasSha256).toBe(true);
    expect(qwen.servedId).toBe('qwen3.8-27b');
    // The artifact basename rides the projection — the desk matches the
    // SERVED model to the registry by filename.
    expect(qwen.fileName).toBe('qwen3.8-27B-Q8_0.gguf');
    const hauhaucs = models.find((m) => m.key === 'qwen3.8-27b-uncensored-hauhaucs');
    expect(hauhaucs.fileName).toBe('Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf');
    expect(models.find((m) => m.key === 'qwen3-30b-a3b-thinking').hasSha256).toBe(false);
  });

  test('getModel — a dotted key resolves; unknown reads null', async () => {
    expect((await getModel(tree, 'qwen3.8-27b')).quantization).toBe('Q8_0');
    expect(await getModel(tree, 'nope')).toBeNull();
  });

  test('listPlans — the real plan, counted', async () => {
    const plans = await listPlans(tree);
    expect(plans).toEqual([{
      name: PLAN_NAME,
      windowHours: 8,
      model: 'qwen3.8-27b-uncensored-hauhaucs',
      groupCount: 1,
      stepCount: 1,
    }]);
  });

  test('isPlanName — the harness charset, nothing else', () => {
    expect(isPlanName('fleet-v8-neuma-headline')).toBe(true);
    expect(isPlanName('UPPER')).toBe(false);
    expect(isPlanName('../x')).toBe(false);
    expect(isPlanName('a b')).toBe(false);
    expect(isPlanName(42)).toBe(false);
  });
});

describe('buildArgs — the closed verb catalog, pure', () => {
  let cell, modelKeys;
  const wallet = '0xabc123';
  beforeAll(async () => {
    cell = await getCell(tree, 'gsm8k');
    modelKeys = (await listModels(tree)).map((m) => m.key);
  });
  const ctx = () => ({ wallet, cell, modelKeys, servingEndpoint: 'http://127.0.0.1:8089' });

  test('every verb exact argv — happy paths', () => {
    expect(buildArgs('list', {}, ctx())).toEqual({ ok: true, argv: ['bench.mjs', 'list', '--json'] });
    expect(buildArgs('doctor', {}, ctx())).toEqual({ ok: true, argv: ['bench.mjs', 'doctor'] });
    expect(buildArgs('preflight-cell', { cell: 'gsm8k', arm: 'bare', model: 'qwen3.8-27b' }, ctx()))
      .toEqual({ ok: true, argv: ['bench.mjs', 'preflight', 'gsm8k', '--model', 'qwen3.8-27b', '--arm', 'bare', '--endpoint', 'http://127.0.0.1:8089'] });
    expect(buildArgs('run-cell', { cell: 'gsm8k', arm: 'bare', model: 'gemma-4-31b' }, ctx()))
      .toEqual({ ok: true, argv: ['bench.mjs', 'run', 'gsm8k', '--model', 'gemma-4-31b', '--arm', 'bare', '--endpoint', 'http://127.0.0.1:8089', '--approved-by', wallet] });
    expect(buildArgs('validate-window', { plan: PLAN_NAME }, ctx()))
      .toEqual({ ok: true, argv: ['scripts/validate-window.mjs', `plans/${PLAN_NAME}.json`] });
    expect(buildArgs('night-check', { plan: PLAN_NAME }, ctx()))
      .toEqual({ ok: true, argv: ['scripts/start-night.mjs', `plans/${PLAN_NAME}.json`, '--check'] });
    expect(buildArgs('night-start', { plan: PLAN_NAME }, ctx()))
      .toEqual({ ok: true, argv: ['scripts/start-night.mjs', `plans/${PLAN_NAME}.json`, '--start'] });
  });

  test('run-cell validated optionals slot in order', () => {
    const built = buildArgs('run-cell', {
      cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'keir',
      limit: 25, attempt: 2, deadline: '2026-10-01T00:00:00Z', comparisonId: 'cmp-1',
    }, ctx());
    expect(built.ok).toBe(true);
    expect(built.argv).toEqual([
      'bench.mjs', 'run', 'gsm8k', '--model', 'qwen3.8-27b', '--arm', 'neuma',
      '--approved-by', wallet, '--lane', 'keir',
      '--limit', '25', '--attempt', '2', '--deadline', '2026-10-01T00:00:00Z', '--comparison-id', 'cmp-1',
    ]);
  });

  test('every refusal — the reason text reaches the caller', () => {
    const bad = (verb, params, context = ctx()) => {
      const built = buildArgs(verb, params, context);
      expect(built.ok).toBe(false);
      return built.reason;
    };
    expect(bad('bogus', {})).toContain('unknown verb');
    expect(bad('preflight-cell', { cell: 'nope', arm: 'neuma', model: 'qwen3.8-27b' })).toContain('unknown cell');
    expect(bad('preflight-cell', { cell: 'gsm8k', arm: 'cheat', model: 'qwen3.8-27b' })).toContain('not one of gsm8k');
    expect(bad('preflight-cell', { cell: 'gsm8k', arm: 'neuma', model: 'gpt-5' })).toContain('unregistered model');
    expect(bad('run-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'keir' }, { cell, modelKeys })).toContain('approving wallet');
    expect(bad('run-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'keir', limit: 0 })).toContain('limit');
    expect(bad('run-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'keir', attempt: 1.5 })).toContain('attempt');
    expect(bad('run-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'keir', deadline: '2026-10-01T00:00:00' })).toContain('timezone');
    expect(bad('run-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'keir', deadline: '2020-01-01T00:00:00Z' })).toContain('past');
    expect(bad('run-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'keir', deadline: '2027-12-31T00:00:00Z' })).toContain('24 days');
    expect(bad('run-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'keir', comparisonId: 'Bad_ID' })).toContain('comparisonId');
    expect(bad('validate-window', { plan: '../etc/passwd' })).toContain('bad plan name');
    expect(bad('night-start', { plan: 'UPPER' })).toContain('bad plan name');
    expect(VERBS).toContain('run-cell');
  });

  test('identity arms — --lane is law (bench.mjs:459), --workspace-root optional but absolute', () => {
    const ctx = () => ({ wallet, cell, modelKeys, servingEndpoint: 'http://127.0.0.1:8089' });
    // neuma/silo arms die at the harness without --lane — the plane refuses first.
    const noLane = buildArgs('run-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b' }, ctx());
    expect(noLane.ok).toBe(false);
    expect(noLane.reason).toContain('--lane');
    const noLanePreflight = buildArgs('preflight-cell', { cell: 'gsm8k', arm: 'silo', model: 'qwen3.8-27b' }, ctx());
    expect(noLanePreflight.ok).toBe(false);
    expect(noLanePreflight.reason).toContain('--lane');

    // With the lane the argv carries it; the workspace root slots when absolute.
    expect(buildArgs('run-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'keir' }, ctx()))
      .toEqual({ ok: true, argv: ['bench.mjs', 'run', 'gsm8k', '--model', 'qwen3.8-27b', '--arm', 'neuma', '--approved-by', wallet, '--lane', 'keir'] });
    expect(buildArgs('preflight-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'keir', workspaceRoot: '/mnt/data/neuma/claude/aldmere' }, ctx()))
      .toEqual({ ok: true, argv: ['bench.mjs', 'preflight', 'gsm8k', '--model', 'qwen3.8-27b', '--arm', 'neuma', '--lane', 'keir', '--workspace-root', '/mnt/data/neuma/claude/aldmere'] });

    // Refusals: lane charset, relative workspace root.
    expect(buildArgs('run-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'bad lane!' }, ctx()).reason)
      .toContain('lane must match');
    expect(buildArgs('run-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'keir', workspaceRoot: 'relative/dir' }, ctx()).reason)
      .toContain('absolute path');

    // A floor arm still runs lane-free; a lane given there rides through (the
    // harness reads it for comparison grouping).
    expect(buildArgs('run-cell', { cell: 'gsm8k', arm: 'bare', model: 'qwen3.8-27b', lane: 'keir' }, ctx()).ok).toBe(true);
  });

  test('endpoint law — floor arms get the serving URL, remote hosts refused', () => {
    // Default: the plane's serving URL is injected for floor arms.
    expect(buildArgs('run-cell', { cell: 'gsm8k', arm: 'platform', model: 'qwen3.8-27b' }, ctx()).argv)
      .toEqual(expect.arrayContaining(['--endpoint', 'http://127.0.0.1:8089']));
    // An explicit loopback override wins.
    expect(buildArgs('run-cell', { cell: 'gsm8k', arm: 'bare', model: 'qwen3.8-27b', endpoint: 'http://localhost:18091' }, ctx()).argv)
      .toEqual(expect.arrayContaining(['--endpoint', 'http://localhost:18091']));
    // No source at all for a floor arm → the refusal names the harness's own law.
    const noServing = buildArgs('run-cell', { cell: 'gsm8k', arm: 'bare', model: 'qwen3.8-27b' }, { wallet, cell, modelKeys });
    expect(noServing.ok).toBe(false);
    expect(noServing.reason).toContain('--endpoint is required');
    // Remote endpoints are refused outright — this plane never aims the harness at a third-party host.
    const remote = buildArgs('run-cell', { cell: 'gsm8k', arm: 'bare', model: 'qwen3.8-27b', endpoint: 'https://api.openai.com' }, ctx());
    expect(remote.ok).toBe(false);
    expect(remote.reason).toContain('loopback');
    expect(buildArgs('run-cell', { cell: 'gsm8k', arm: 'bare', model: 'qwen3.8-27b', endpoint: 'not a url' }, ctx()).reason)
      .toContain('not a valid URL');
    // Identity arms route through the lane — nothing injected; an explicit endpoint rides.
    const identity = buildArgs('run-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'keir' }, ctx());
    expect(identity.argv).not.toContain('--endpoint');
    expect(buildArgs('run-cell', { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'keir', endpoint: 'http://127.0.0.1:8089' }, ctx()).argv)
      .toEqual(expect.arrayContaining(['--endpoint', 'http://127.0.0.1:8089']));
  });

  test('deadline rules — timezone explicit, future, ≤ 24 days', () => {
    expect(isIsoWithTimezone('2026-10-01T00:00:00Z')).toBe(true);
    expect(isIsoWithTimezone('2026-10-01T02:00:00+02:00')).toBe(true);
    expect(isIsoWithTimezone('2026-10-01T00:00:00')).toBe(false);
    const now = Date.parse('2026-09-23T00:00:00Z');
    expect(validateDeadline('2026-09-24T00:00:00Z', now).ok).toBe(true);
    expect(validateDeadline('2026-10-17T00:00:01Z', now).ok).toBe(false);
    expect(validateDeadline('not-a-date', now).ok).toBe(false);
  });
});


describe('the loaded-model truth (read side only, never commands)', () => {
  it('readLoadedModel — not serving reads null without touching the environment', async () => {
    expect(await readLoadedModel('http://127.0.0.1:8089', false)).toBeNull();
  });

  it('supervisorOnBenchEndpoint — a foreign endpoint is never ours to name', () => {
    // A port nothing sane resolves to: the answer must be false on any box.
    expect(supervisorOnBenchEndpoint('http://127.0.0.1:59999')).toBe(false);
    expect(supervisorOnBenchEndpoint('not a url')).toBe(false);
    // The box's own resolution answers for itself (weather-consistent).
    expect(typeof supervisorOnBenchEndpoint(servingUrl())).toBe('boolean');
  });
});
