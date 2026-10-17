/**
 * bench-machine.test.js — THE CLEAR-MACHINE LAW end to end: a REAL process
 * stands on the machine (a node child carrying a unique marker in its argv),
 * the probe's pattern points at that marker, and the real launch route
 * refuses the run BEFORE any arm spawns; /status reads the same verdict.
 * The process dies — the machine reads clear. Real pgrep, real auth, no mocks.
 */
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createTempDir } from '../helpers/temp-fs.js';
import { buildBenchFixtureTree } from '../helpers/bench-fixture-tree.js';
import { useTempRealm } from '../helpers/temp-realm.js';

const ENV = [
  'NEUMA_BENCH_HARNESS_PATH', 'NEUMA_BENCH_SERVING_URL', 'NEUMA_DATA_ROOT', 'WORKSPACES_ROOT',
  'NEUMA_BENCH_TEST_PROCESS_PATTERN',
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));


// a settled set notifies its operator — into a temp realm, never the machine's
useTempRealm();
describe('the clear-machine law — a test run on the box refuses the benchmark', () => {
  let house, tree, witness, app, marker, standing;
  const saved = {};

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) { saved[k] = process.env[k]; }
    house = await createTempDir('bench-machine');
    tree = path.join(house, 'harness');
    await buildBenchFixtureTree(tree);
    // Any spawn would write this file — its absence proves no arm ran.
    await fs.writeFile(path.join(tree, 'bench.mjs'), "require('node:fs').writeFileSync('spawned', '1');");
    process.env.NEUMA_BENCH_HARNESS_PATH = tree;
    process.env.NEUMA_BENCH_SERVING_URL = 'http://127.0.0.1:9';
    process.env.NEUMA_DATA_ROOT = path.join(house, 'data');
    process.env.WORKSPACES_ROOT = path.join(house, 'workspaces');
    marker = `neuma-bench-busy-${process.pid}-${Date.now()}`;
    process.env.NEUMA_BENCH_TEST_PROCESS_PATTERN = marker;
    const { witnessFor } = await import('../helpers/witness.js');
    witness = await witnessFor(process.env.WORKSPACES_ROOT, 'benchlane');
    const { default: router } = await import('../../backend/routes/bench-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/bench', router);
  });

  afterEach(() => {
    standing?.kill('SIGKILL');
    standing = null;
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const standUp = async () => {
    standing = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', marker], { stdio: 'ignore' });
    await new Promise((ok) => standing.once('spawn', ok));
    return standing.pid;
  };

  test('a standing test process refuses the run with its pid, and /status reads it', async () => {
    const pid = await standUp();
    const status = await request(app).get('/api/v1/bench/status').set(witness.header);
    expect(status.status).toBe(200);
    expect(status.body.machine.clear).toBe(false);
    expect(status.body.machine.processes.map((p) => p.pid)).toContain(pid);

    const res = await request(app).post('/api/v1/bench/launch').set(witness.header).send({
      verb: 'run-benchmark', params: { cell: 'gsm8k', arms: ['bare'], model: 'qwen3.8-27b' },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BENCH_MACHINE_BUSY');
    expect(res.body.error.message).toContain(`${pid} `);
    await sleep(200);
    await expect(fs.stat(path.join(tree, 'spawned'))).rejects.toThrow();
  });

  test('a SHELL whose text merely names a runner is not a test run (2026-10-15: a launch held on itself)', async () => {
    // a real bash whose command line carries the marker — what `pgrep -af 'vitest|…'; node proof` looked like
    standing = spawn('bash', ['-c', `sleep 60; true # ${marker}`], { stdio: 'ignore' });
    await new Promise((ok) => standing.once('spawn', ok));
    // the pattern DOES see the shell — the executable is what clears it
    const { execFileSync } = await import('node:child_process');
    expect(execFileSync('pgrep', ['-af', marker], { encoding: 'utf8' })).toContain(String(standing.pid));
    const status = await request(app).get('/api/v1/bench/status').set(witness.header);
    expect(status.body.machine).toEqual({ clear: true, processes: [] });
  });

  test('once the test process is gone the machine reads clear', async () => {
    await standUp();
    standing.kill('SIGKILL');
    await new Promise((ok) => standing.once('exit', ok));
    standing = null;
    const status = await request(app).get('/api/v1/bench/status').set(witness.header);
    expect(status.body.machine).toEqual({ clear: true, processes: [] });
  });
});
