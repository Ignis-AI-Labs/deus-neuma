/**
 * Bench routes (/api/v1/bench) — the operator's window onto the sovereign
 * benchmark harness, end to end against REAL auth (a real wallet with a real
 * HMAC token proves every request, RULE 0 #390), a REAL fixture harness tree
 * built from captured artifacts, REAL spawned short verbs, and — in the
 * gnosis describe — the REAL harness on this box.
 *
 * Structure mirrors test/integration/staff-routes.test.js: env isolation,
 * vi.resetModules, dynamic imports after env is set.
 */
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  buildBenchFixtureTree, FIXTURE_NIGHT_STAMP, FIXTURE_BUNDLE_ID, FIXTURE_PLAN_NAME,
} from '../helpers/bench-fixture-tree.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const ENV = [
  'NEUMA_BENCH_HARNESS_PATH', 'NEUMA_BENCH_SERVING_URL', 'NEUMA_BENCH_WATCH_PATH',
  'NEUMA_DATA_ROOT', 'WORKSPACES_ROOT', 'NEUMA_BENCH_TEST_PROCESS_PATTERN',
];

const REAL_HARNESS = '/workspace/repos/project-fuvofos';
const realHarnessPresent = existsSync(path.join(REAL_HARNESS, 'bench.mjs'));
if (!realHarnessPresent) {
  process.stderr.write('\n*** bench-routes GNOSIS describe SKIPPED — no harness at /workspace/repos/project-fuvofos ***\n');
}


// a settled set notifies its operator — into a temp realm, never the machine's
useTempRealm();
describe('Bench routes (/api/v1/bench)', () => {
  let house, witness;
  const saved = {};

  const buildApp = async () => {
    const { default: router } = await import('../../backend/routes/bench-routes.js');
    const a = express();
    a.use(express.json());
    a.use('/api/v1/bench', router);
    return a;
  };

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) { saved[k] = process.env[k]; }

    house = await createTempDir('bench-routes');
    process.env.WORKSPACES_ROOT = path.join(house, 'workspaces');
    process.env.NEUMA_DATA_ROOT = path.join(house, 'data');
    // The suite runs inside vitest: judge the clear-machine law by a marker
    // no real process carries (the busy verdict is proven in bench-failure-report).
    process.env.NEUMA_BENCH_TEST_PROCESS_PATTERN = `neuma-bench-clear-${process.pid}-${Date.now()}`;
    process.env.NEUMA_BENCH_WATCH_PATH = path.join(house, 'watch', 'incidents.jsonl');
    // A closed loopback port: the serving probe reads DOWN fast, never hangs.
    process.env.NEUMA_BENCH_SERVING_URL = 'http://127.0.0.1:9';

    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against.
    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(process.env.WORKSPACES_ROOT, 'benchlane');
    // The bench plane runs the machine's processes: its launches are the install owner's.
    await makeInstallOwner(witness.address);
  });

  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  describe('against the fixture harness', () => {
    let app;
    beforeEach(async () => {
      const tree = path.join(house, 'harness');
      await buildBenchFixtureTree(tree);
      process.env.NEUMA_BENCH_HARNESS_PATH = tree;
      app = await buildApp();
    });
    const get = (url) => request(app).get(url).set(witness.header);
    const post = (url, body) => request(app).post(url).set(witness.header).send(body);

    test('GET /status — serving DOWN reading, the night window, daemons, incidents, owned', async () => {
      const res = await get('/api/v1/bench/status');
      expect(res.status).toBe(200);
      expect(res.body.serving.ok).toBe(false);
      expect(res.body.night.status).toBe('deadline-or-signal');
      expect(res.body.night.file).toBe(`${FIXTURE_NIGHT_STAMP}-status.json`);
      expect(res.body.lock).toBeNull();
      // Shape only — on THIS box the harness's real daemons are live, so a
      // running:false assertion would be a lie about the process table.
      expect(typeof res.body.daemons.servingWatchdog.running).toBe('boolean');
      expect(Array.isArray(res.body.daemons.servingWatchdog.pids)).toBe(true);
      expect(res.body.incidents.length).toBe(1);
      expect(res.body.incidents[0].event).toBe('postmortem');
      expect(res.body.owned).toEqual([]);
      // every benchmark running on this MACHINE, whoever launched it (the real process table)
      expect(Array.isArray(res.body.live)).toBe(true);
    });

    test('GET /live — the light watch: the runs on this machine and this desk\'s set, no probes', async () => {
      const res = await get('/api/v1/bench/live');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['chain', 'live']);
      expect(Array.isArray(res.body.live)).toBe(true);
      for (const run of res.body.live) expect(run).toEqual(expect.objectContaining({ cell: expect.any(String), minutes: expect.any(Number) }));
    });

    test('GET /queue — the parsed night status', async () => {
      const res = await get('/api/v1/bench/queue');
      expect(res.status).toBe(200);
      expect(res.body.queue.waitingFor).toBe('model-endpoint');
      expect(res.body.queue.unstartedGroups).toEqual(['arc-bare']);
    });

    test('GET /runs /reports /scoreboard /catalog /models /plans /incidents', async () => {
      expect((await get('/api/v1/bench/runs')).body.runs).toEqual([]);

      const reports = (await get('/api/v1/bench/reports')).body;
      expect(reports.bundles.map((b) => b.id)).toEqual([FIXTURE_BUNDLE_ID]);

      const board = (await get('/api/v1/bench/scoreboard')).body;
      expect(board.scoreboard).toContain('SCOREBOARD');
      expect(board.nightLatest.length).toBeGreaterThan(0);

      const catalog = (await get('/api/v1/bench/catalog')).body;
      expect(catalog.cells.map((c) => c.id)).toEqual(['gsm8k', 'gsm8k-2568']); // the base and its variant
      expect(catalog.cells[0].id).toBe('gsm8k');
      expect(catalog.cells[1]).toMatchObject({ family: 'gsm8k', variant: true });
      expect(catalog.cells[0].arms).toEqual(['bare', 'platform', 'harness', 'silo', 'neuma']);

      const models = (await get('/api/v1/bench/models')).body;
      expect(models.models.length).toBe(4);
      expect(models.models.find((m) => m.key === 'qwen3.8-27b').hasSha256).toBe(true);

      const plans = (await get('/api/v1/bench/plans')).body;
      expect(plans.plans).toEqual([{
        name: FIXTURE_PLAN_NAME, windowHours: 8,
        model: 'qwen3.8-27b-uncensored-hauhaucs', groupCount: 1, stepCount: 1,
      }]);

      const incidents = (await get('/api/v1/bench/incidents')).body;
      expect(incidents.serving.length).toBe(1);
      expect(incidents.watch).toEqual([]);
    });

    test('GET /reports/:bundle — metadata + report text; 404 unknown; 400 bad id', async () => {
      const one = await get(`/api/v1/bench/reports/${FIXTURE_BUNDLE_ID}`);
      expect(one.status).toBe(200);
      expect(one.body.bundle.id).toBe(FIXTURE_BUNDLE_ID);
      expect(one.body.report).toContain('# Benchmark night 20260920t230631z');

      expect((await get('/api/v1/bench/reports/no-such-bundle')).status).toBe(404);
      const bad = await get('/api/v1/bench/reports/bad_id');
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('BENCH_BAD_ID');
    });

    test('GET /reports/:bundle/:artifact — text, 404 missing, 400 outside the closed map', async () => {
      const metrics = await get(`/api/v1/bench/reports/${FIXTURE_BUNDLE_ID}/metrics`);
      expect(metrics.status).toBe(200);
      expect(metrics.body.text).toContain('gsm8k/exact_match,strict-match');

      expect((await get(`/api/v1/bench/reports/${FIXTURE_BUNDLE_ID}/receipts`)).status).toBe(404);
      const bad = await get(`/api/v1/bench/reports/${FIXTURE_BUNDLE_ID}/plan`);
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('BENCH_BAD_ARTIFACT');
    });

    test('no token is a real 401', async () => {
      expect((await request(app).get('/api/v1/bench/status')).status).toBe(401);
      expect((await request(app).post('/api/v1/bench/launch').send({ verb: 'list' })).status).toBe(401);
    });

    test('POST /launch refusals — unknown verb, bad arm, bad plan, bad cell', async () => {
      const unknownVerb = await post('/api/v1/bench/launch', { verb: 'bogus' });
      expect(unknownVerb.status).toBe(400);
      expect(unknownVerb.body.error.code).toBe('BENCH_UNKNOWN_VERB');
      expect(unknownVerb.body.error.message).toContain('bogus');

      const badArm = await post('/api/v1/bench/launch', {
        verb: 'preflight-cell', params: { cell: 'gsm8k', arm: 'cheat', model: 'qwen3.8-27b' },
      });
      expect(badArm.status).toBe(400);
      expect(badArm.body.error.code).toBe('BENCH_BAD_PARAMS');
      expect(badArm.body.error.message).toContain('not one of gsm8k');

      const badPlan = await post('/api/v1/bench/launch', { verb: 'night-start', params: { plan: 'BAD PLAN' } });
      expect(badPlan.status).toBe(400);
      expect(badPlan.body.error.message).toContain('bad plan name');

      const badCell = await post('/api/v1/bench/preflight', { cell: 'nope', arm: 'neuma', model: 'qwen3.8-27b' });
      expect(badCell.status).toBe(400);
      expect(badCell.body.error.message).toContain('unknown cell');
    });

    test('POST /stop — 404 when the plane owns nothing', async () => {
      const res = await post('/api/v1/bench/stop', {});
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('BENCH_NOTHING_OWNED');
    });

    // The recovery console's refusals — proven WITHOUT ever spawning a daemon:
    // validation and the serving probe both fire before any spawn point.
    test('POST /relight — 400 unknown model (catalog judges first)', async () => {
      const res = await post('/api/v1/bench/relight', { model: 'gpt-5' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BENCH_BAD_PARAMS');
      expect(res.body.error.message).toContain('unregistered model');
    });

    test('POST /relight — 409 BENCH_SERVING_HEALTHY against a REAL live endpoint', async () => {
      // A real loopback server answers /v1/models — the relight's serving
      // probe reads it live and refuses: nothing to relight.
      const live = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"data":[{"id":"fixture"}]}');
      });
      await new Promise((done) => live.listen(0, '127.0.0.1', done));
      process.env.NEUMA_BENCH_SERVING_URL = `http://127.0.0.1:${live.address().port}`;
      try {
        const res = await post('/api/v1/bench/relight', { model: 'qwen3.8-27b' });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('BENCH_SERVING_HEALTHY');
        expect(res.body.error.message).toContain('nothing to relight');
      } finally {
        await new Promise((done) => live.close(done));
        process.env.NEUMA_BENCH_SERVING_URL = 'http://127.0.0.1:9';
      }
    });

    test('POST /relight — no token is a real 401', async () => {
      expect((await request(app).post('/api/v1/bench/relight').send({ model: 'qwen3.8-27b' })).status).toBe(401);
    });

    // THE IDENTITY LAW — the wallet sees and drives only its OWN lanes.
    const seedLanes = async () => {
      const { strangerWitness } = await import('../helpers/witness.js');
      const { claimOwner } = await import('../helpers/claim-owner.js');
      const stranger = strangerWitness();
      await claimOwner(process.env.WORKSPACES_ROOT, 'otherlane', stranger.address);
      // A witness lane of MINE on the witnesses' ground (the marker + the claim).
      const witnessDir = path.join(house, 'witnesses', 'witness-xai-Testa');
      await fs.mkdir(witnessDir, { recursive: true });
      await fs.writeFile(path.join(witnessDir, 'lane.json'), JSON.stringify({ kind: 'witness' }));
      await fs.writeFile(path.join(witnessDir, 'owner.json'),
        JSON.stringify({ wallet: witness.address, claimedAt: new Date().toISOString() }));
      return stranger;
    };

    test('GET /lanes — the wallet sees its own house + witness lanes, never a stranger\u2019s', async () => {
      const stranger = await seedLanes();
      const mine = (await get('/api/v1/bench/lanes')).body.lanes;
      expect(mine.map((l) => l.laneId).sort()).toEqual(['benchlane', 'witness-xai-Testa']);
      expect(mine.find((l) => l.laneId === 'benchlane').kind).toBe('neuma');
      expect(mine.find((l) => l.laneId === 'witness-xai-Testa').kind).toBe('witness');
      const theirs = (await request(app).get('/api/v1/bench/lanes').set(stranger.header)).body.lanes;
      expect(theirs.map((l) => l.laneId)).toEqual(['otherlane']);
      expect(theirs.some((l) => l.laneId === 'benchlane')).toBe(false);
      expect((await request(app).get('/api/v1/bench/lanes')).status).toBe(401);
    });

    test('the boundary re-proves ownership from disk — a stranger\u2019s lane is 403, mine really launches', async () => {
      const stranger = await seedLanes();
      const stolen = await post('/api/v1/bench/launch', {
        verb: 'run-cell', params: { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'otherlane' },
      });
      expect(stolen.status).toBe(403);
      expect(stolen.body.error.code).toBe('BENCH_NOT_YOUR_LANE');
      expect(stolen.body.error.message).toContain('otherlane');
      // Same law on preflight — the gate stands on both verbs.
      const stolenGate = await post('/api/v1/bench/preflight', {
        cell: 'gsm8k', arm: 'silo', model: 'qwen3.8-27b', lane: 'otherlane',
      });
      expect(stolenGate.status).toBe(403);
      // My own lane passes the gate and the plane really spawns the long verb
      // (the fixture stub exits clean; no GPU, no rig lock).
      const mine = await post('/api/v1/bench/launch', {
        verb: 'run-cell', params: { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'benchlane' },
      });
      expect(mine.status).toBe(200);
      expect(mine.body.long).toBe(true);
      expect(mine.body.argv).toEqual(expect.arrayContaining(['--lane', 'benchlane']));
      // A lane that exists on NOBODY's claim is the same refusal.
      const nobody = await post('/api/v1/bench/launch', {
        verb: 'run-cell', params: { cell: 'gsm8k', arm: 'neuma', model: 'qwen3.8-27b', lane: 'ghostlane' },
      });
      expect(nobody.status).toBe(403);
    }, 30000);

    test('run-benchmark validation — the matched-set law reads plain', async () => {
      const none = await post('/api/v1/bench/launch', { verb: 'run-benchmark', params: { cell: 'gsm8k', arms: [], model: 'qwen3.8-27b' } });
      expect(none.status).toBe(400);
      expect(none.body.error.message).toContain('one to five arms');
      const five = await post('/api/v1/bench/launch', { verb: 'run-benchmark', params: { cell: 'gsm8k', arms: ['bare', 'platform', 'harness', 'silo', 'neuma', 'bare'], model: 'qwen3.8-27b', lane: 'benchlane' } });
      expect(five.status).toBe(400);
      expect(five.body.error.message).toContain('one to five arms');
      const foreign = await post('/api/v1/bench/launch', { verb: 'run-benchmark', params: { cell: 'gsm8k', arms: ['cheat'], model: 'qwen3.8-27b' } });
      expect(foreign.status).toBe(400);
      expect(foreign.body.error.message).toContain('not one of gsm8k');
      const noLane = await post('/api/v1/bench/launch', { verb: 'run-benchmark', params: { cell: 'gsm8k', arms: ['neuma'], model: 'qwen3.8-27b' } });
      expect(noLane.status).toBe(400);
      expect(noLane.body.error.message).toContain('--lane');
      const dup = await post('/api/v1/bench/launch', { verb: 'run-benchmark', params: { cell: 'gsm8k', arms: ['bare', 'bare'], model: 'qwen3.8-27b' } });
      expect(dup.status).toBe(400);
      expect(dup.body.error.message).toContain('an arm rides once');
    });

    test('the matched set rides the ownership law — a stranger\u2019s lane 403s the whole set', async () => {
      await seedLanes();
      const stolen = await post('/api/v1/bench/launch', {
        verb: 'run-benchmark',
        params: { cell: 'gsm8k', arms: ['bare', 'neuma'], model: 'qwen3.8-27b', lane: 'otherlane' },
      });
      expect(stolen.status).toBe(403);
      expect(stolen.body.error.code).toBe('BENCH_NOT_YOUR_LANE');
      expect(stolen.body.error.message).toContain('otherlane');
      // The same set with MY lane passes the gate and the chain starts —
      // one click, both arms, one comparison id.
      const mine = await post('/api/v1/bench/launch', {
        verb: 'run-benchmark',
        params: { cell: 'gsm8k', arms: ['bare', 'neuma'], model: 'qwen3.8-27b', lane: 'benchlane' },
      });
      expect(mine.status).toBe(200);
      expect(mine.body.comparisonId).toMatch(/^desk-/);
      expect(mine.body.arms).toEqual(['bare', 'neuma']);
      // The chain's live state rides /status for the desk's progress block.
      const status = (await get('/api/v1/bench/status')).body;
      expect(status.chain).toBeTruthy();
      expect(status.chain.arms).toEqual(['bare', 'neuma']);
      await post('/api/v1/bench/stop', {}); // the fixture stub children settle alone; stop is belt
    }, 30000);

    test('GET /status — nothing serving reads loaded: null (intent is never a reading)', async () => {
      const res = await get('/api/v1/bench/status');
      expect(res.status).toBe(200);
      expect(res.body.serving.ok).toBe(false);
      expect(res.body.serving.loaded).toBeNull();
    });

    test('POST /launch list — a REAL spawn of the fixture stub, stdout captured, journaled', async () => {
      const res = await post('/api/v1/bench/launch', { verb: 'list' });
      expect(res.status).toBe(200);
      expect(res.body.exitCode).toBe(0);
      expect(res.body.verb).toBe('list');
      // The fired argv rides the response — the operator sees exactly what ran.
      expect(res.body.argv).toEqual(['bench.mjs', 'list', '--json']);
      expect(typeof res.body.stdout).toBe('string');
      // The launch journal lives under the ISOLATED data root — never the repo's.
      expect(res.body.logFile.startsWith(process.env.NEUMA_DATA_ROOT)).toBe(true);
    }, 30000);
  });

  describe('absent harness', () => {
    let app;
    beforeEach(async () => {
      process.env.NEUMA_BENCH_HARNESS_PATH = path.join(house, 'no-such-harness');
      app = await buildApp();
    });

    test('every route 503s BENCH_HARNESS_ABSENT with the reason', async () => {
      const status = await request(app).get('/api/v1/bench/status').set(witness.header);
      expect(status.status).toBe(503);
      expect(status.body.error.code).toBe('BENCH_HARNESS_ABSENT');
      expect(status.body.error.message).toContain('no-such-harness');

      const launch = await request(app).post('/api/v1/bench/launch').set(witness.header).send({ verb: 'list' });
      expect(launch.status).toBe(503);
      expect(launch.body.error.code).toBe('BENCH_HARNESS_ABSENT');
    });
  });

  // GNOSIS — the REAL harness on this box. Read-only verbs only: `list`
  // spawns `node bench.mjs list --json` (CPU-only, seconds); /status reads
  // files. No run, no window, no GPU — the attended law is untouched.
  describe.skipIf(!realHarnessPresent)('gnosis — the real harness', () => {
    let app;
    beforeEach(async () => {
      process.env.NEUMA_BENCH_HARNESS_PATH = REAL_HARNESS;
      app = await buildApp();
    });

    test('POST /launch {verb:list} really spawns bench.mjs and the stdout parses as JSON', async () => {
      const res = await request(app).post('/api/v1/bench/launch')
        .set(witness.header)
        .send({ verb: 'list' });
      expect(res.status).toBe(200);
      expect(res.body.exitCode).toBe(0);
      const cells = JSON.parse(res.body.stdout);
      expect(Array.isArray(cells)).toBe(true);
      expect(cells.some((cell) => cell.id === 'smoke')).toBe(true);
    }, 30000);

    test('GET /status reads the real harness state', async () => {
      const res = await request(app).get('/api/v1/bench/status').set(witness.header);
      expect(res.status).toBe(200);
      expect(typeof res.body.night.status).toBe('string');
      expect(res.body.night.file).toMatch(/^night-\d{8}t\d{6}z-status\.json$/);
      // Weather-proof gnosis: the route must serve what the probes see RIGHT
      // NOW — cross-checked against direct readings of the same box, so the
      // test is true whether the daemons stand or the gap is open.
      const { pgrepPids, probeGpu } = await import('../../backend/services/bench/bench-status.js');
      const directWatchdog = await pgrepPids('serving-watchdog.mjs');
      expect(res.body.daemons.servingWatchdog.running).toBe(directWatchdog.length > 0);
      expect(res.body.daemons.servingWatchdog.pids).toEqual(directWatchdog);
      const directGpu = await probeGpu();
      expect(res.body.gpu.ok).toBe(directGpu.ok);
      if (directGpu.ok) {
        expect(res.body.gpu.name).toBe(directGpu.name);
        // The gauges are LIVE — VRAM moves between the two probes. Identity
        // (the name) must match; the gauges must both be real integers.
        expect(Number.isInteger(res.body.gpu.memoryUsedMiB)).toBe(true);
        expect(Number.isInteger(directGpu.memoryUsedMiB)).toBe(true);
      }
      // The loaded-model truth — cross-checked against the supervisor's own
      // READ channel, weather-proof: when the bench endpoint answers AND the
      // platform's serving config resolves there, the route's `loaded` is
      // exactly what the channel says; otherwise null (never a guess).
      const { activeServedModelKey } = await import('../../backend/services/served-model-truth.js');
      const { resolveServingLaunchConfig } = await import('../../backend/services/serving-launch-config.js');
      const cfg = resolveServingLaunchConfig(process.env);
      const sameEndpoint = cfg.host === '127.0.0.1' && String(cfg.port) === '8089';
      const directKey = await activeServedModelKey(process.env).catch(() => null);
      if (res.body.serving.ok && sameEndpoint) {
        expect(res.body.serving.loaded).toBe(directKey);
      } else {
        expect(res.body.serving.loaded).toBeNull();
      }
    }, 30000);

    test('GET /runs serves the timestamped, hash-carrying ledger rows (real receipts)', async () => {
      const res = await request(app).get('/api/v1/bench/runs?limit=5').set(witness.header);
      expect(res.status).toBe(200);
      expect(res.body.runs.length).toBeGreaterThan(0);
      const row = res.body.runs[0];
      // The v2 row: times, the benchmark, the score, the hashes — real fields
      // off real receipts, null-honest where an older run lacks a section.
      expect('startedAt' in row).toBe(true);
      expect('durationMs' in row).toBe(true);
      expect(row.hashes).toHaveProperty('protocol');
      expect(row.hashes).toHaveProperty('model');
      expect(row).toHaveProperty('suiteId');
      expect(row).toHaveProperty('approvedBy');
      expect(row).toHaveProperty('primaryMetric');
      // The newest run on this box is a real sealed run — its stamp parses.
      expect(Number.isFinite(Date.parse(row.startedAt))).toBe(true);
    }, 30000);
  });
});
