/**
 * bench-failure-report.test.js — GET /api/v1/bench/chain/report end to end:
 * REAL wallet auth (#390), a REAL spawned chain whose 'neuma' arm dies the
 * way the real harness died on 2026-09-25 (its refusal printed to stderr,
 * exit 1), and the report read back through the real route from the real
 * arm log on disk. No mocks anywhere.
 */
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import { buildBenchFixtureTree } from '../helpers/bench-fixture-tree.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const ENV = ['NEUMA_BENCH_HARNESS_PATH', 'NEUMA_BENCH_SERVING_URL', 'NEUMA_DATA_ROOT', 'WORKSPACES_ROOT', 'NEUMA_BENCH_TEST_PROCESS_PATTERN'];

// The stub harness: 'bare' passes; 'neuma' prints a colored refusal to stderr
// and exits 1 — the exact line the real harness wrote.
const STUB = `const arm = process.argv[process.argv.indexOf('--arm') + 1];
if (arm === 'neuma') {
  process.stdout.write('    cell      smoke\\n');
  process.stderr.write('\\x1b[31m  \\u2717 Error: test process is already running; benchmark refused:\\x1b[0m\\n    at assertTestProcessesClear\\n');
  setTimeout(() => process.exit(1), 30);
} else {
  process.stdout.write('    \\u2713 succeeded\\n');
  setTimeout(() => process.exit(0), 30);
}
`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));


// a settled set notifies its operator — into a temp realm, never the machine's
useTempRealm();
describe('GET /api/v1/bench/chain/report — the copyable failure report', () => {
  let house, witness, app, stopOwned;
  const saved = {};

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) { saved[k] = process.env[k]; }
    house = await createTempDir('bench-failure-report');
    const tree = path.join(house, 'harness');
    await buildBenchFixtureTree(tree);
    await fs.writeFile(path.join(tree, 'bench.mjs'), STUB);
    process.env.NEUMA_BENCH_HARNESS_PATH = tree;
    process.env.NEUMA_BENCH_SERVING_URL = 'http://127.0.0.1:9';
    process.env.NEUMA_DATA_ROOT = path.join(house, 'data');
    // The suite runs inside vitest: judge the clear-machine law by a marker
    // no real process carries (the busy verdict is proven in bench-failure-report).
    process.env.NEUMA_BENCH_TEST_PROCESS_PATTERN = `neuma-bench-clear-${process.pid}-${Date.now()}`;
    process.env.WORKSPACES_ROOT = path.join(house, 'workspaces');
    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(process.env.WORKSPACES_ROOT, 'benchlane');
    // The bench plane runs the machine's processes: its launches are the install owner's.
    await makeInstallOwner(witness.address);
    ({ stopOwned } = await import('../../backend/services/bench/bench-launch.js'));
    const { default: router } = await import('../../backend/routes/bench-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/bench', router);
  });

  afterEach(async () => {
    try { await stopOwned(); } catch { /* nothing owned */ }
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const get = (url) => request(app).get(url).set(witness.header);

  test('404 BENCH_NO_CHAIN before any set has run', async () => {
    const res = await get('/api/v1/bench/chain/report');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BENCH_NO_CHAIN');
  });

  test('a failed arm’s real log tail reaches the report, color stripped', async () => {
    const start = await request(app).post('/api/v1/bench/launch').set(witness.header).send({
      verb: 'run-benchmark',
      params: { cell: 'gsm8k', arms: ['bare', 'neuma'], model: 'qwen3.8-27b', lane: 'benchlane', limit: 5 },
    });
    expect(start.status).toBe(200);

    let report;
    for (let i = 0; i < 200; i += 1) {
      const res = await get('/api/v1/bench/chain/report');
      if (res.status === 200 && res.body.state === 'done') { report = res.body; break; }
      await sleep(50);
    }
    expect(report).toBeDefined();
    expect(report.failedArms).toEqual(['neuma']);
    expect(report.text).toContain('- ✓ BARE MODEL (bare) — clean');
    expect(report.text).toContain('- ✗ FULL BEING (neuma) — exit 1');
    expect(report.text).toContain('  ✗ Error: test process is already running; benchmark refused:\n    at assertTestProcessesClear');
    expect(report.text).not.toContain('\x1b[');
    // The bare arm passed — its log never pastes.
    expect(report.text).not.toContain('succeeded');
  });

  test('the report demands the operator’s token', async () => {
    const res = await request(app).get('/api/v1/bench/chain/report');
    expect(res.status).toBe(401);
  });
});
