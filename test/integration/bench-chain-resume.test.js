/**
 * bench-chain-resume.test.js — A MATCHED SET OUTLIVES A DESK RELAUNCH (Founder,
 * 2026-10-20). A real desk process launches a two-arm set and is SIGKILLed
 * mid-arm, as another session's relaunch did that night. The arm (a real stub
 * child) runs on; the next desk (this test process) boots, adopts the set, reads
 * the arm's outcome from its sealed receipt, and launches the arm still to
 * come. No mocks (RULE 0).
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempDir } from '../helpers/temp-fs.js';
import { buildBenchFixtureTree } from '../helpers/bench-fixture-tree.js';
import { useTempRealm } from '../helpers/temp-realm.js';

const ENV = ['NEUMA_BENCH_HARNESS_PATH', 'NEUMA_DATA_ROOT', 'WORKSPACES_ROOT', 'NEUMA_BENCH_TEST_PROCESS_PATTERN'];
const WALLET = '0xabc123def456';
const LAUNCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend/services/bench/bench-launch.js');

// The stub arm: logs start/end, seals a receipt as the real harness does, and
// runs long on 'bare' so the desk can die under it.
const STUB = `import fs from 'node:fs';
const arg = (k) => process.argv[process.argv.indexOf(k) + 1];
const arm = arg('--arm');
const row = (event) => fs.appendFileSync('chain-calls.jsonl', JSON.stringify({ event, arm, pid: process.pid, at: Date.now() }) + '\\n');
row('start');
// Refused once, in the harness's own words, when the test leaves a marker for this arm.
if (fs.existsSync('refuse-once-' + arm)) {
  fs.rmSync('refuse-once-' + arm);
  process.stderr.write('  ✗ Error: test process is already running; benchmark refused:\\n');
  process.exit(1);
}
const startedAt = new Date().toISOString();
setTimeout(() => {
  const dir = 'runs/' + arg('--comparison-id') + '-' + arm + '-a1-' + Date.now();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + '/receipt.json', JSON.stringify({ comparisonId: arg('--comparison-id'), arm, status: 'succeeded', attempt: 1, timing: { startedAt } }));
  row('end');
  process.exit(0);
}, arm === 'bare' ? 2500 : 100);
`;

// The first desk: launches the set, then idles until it is killed.
const DESK = `const { launch } = await import(${JSON.stringify(LAUNCH)});
const r = await launch('run-benchmark', { cell: 'gsm8k', arms: ['bare', 'platform'], model: 'qwen3.8-27b', lane: 'keir' }, ${JSON.stringify(WALLET)});
process.stdout.write(JSON.stringify(r) + '\\n');
setInterval(() => {}, 1000);
`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

useTempRealm();
describe('a matched set outlives a desk relaunch', () => {
  let house, tree;
  const saved = {};
  // Every desk this file spawns, so a failing test can never leave one (or its arm) running.
  const desks = [];
  const spawnDesk = (stdio) => {
    const desk = spawn(process.execPath, ['--input-type=module', '-e', DESK], { env: process.env, stdio });
    desks.push(desk);
    return desk;
  };

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) saved[k] = process.env[k];
    house = await createTempDir('bench-chain-resume');
    tree = path.join(house, 'harness');
    await buildBenchFixtureTree(tree);
    await fs.writeFile(path.join(tree, 'bench.mjs'), STUB);
    process.env.NEUMA_BENCH_HARNESS_PATH = tree;
    process.env.NEUMA_DATA_ROOT = path.join(house, 'data');
    process.env.NEUMA_BENCH_TEST_PROCESS_PATTERN = `neuma-bench-clear-${process.pid}-${Date.now()}`;
    process.env.WORKSPACES_ROOT = path.join(house, 'workspaces');
    const { claimOwner } = await import('../helpers/claim-owner.js');
    await claimOwner(process.env.WORKSPACES_ROOT, 'keir', WALLET);
  });

  afterEach(async () => {
    for (const desk of desks.splice(0)) if (desk.exitCode === null && desk.signalCode === null) desk.kill('SIGKILL');
    try {
      const { stopOwned } = await import('../../backend/services/bench/bench-launch.js');
      await stopOwned();
    } catch { /* nothing owned */ }
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const calls = async () => (await fs.readFile(path.join(tree, 'chain-calls.jsonl'), 'utf8').catch(() => ''))
    .trim().split('\n').filter(Boolean).map(JSON.parse);
  const until = async (check, what) => {
    for (let i = 0; i < 600; i += 1) {
      const value = await check();
      if (value) return value;
      await sleep(50);
    }
    throw new Error(`never: ${what}`);
  };

  test('the desk dies mid-arm: the arm runs on, the next desk adopts the set and launches the rest', async () => {
    const desk = spawnDesk(['ignore', 'pipe', 'pipe']);
    let out = '';
    desk.stdout.on('data', (c) => { out += c; });
    const started = await until(async () => (await calls()).find((c) => c.event === 'start' && c.arm === 'bare'), 'the bare arm started');
    const launched = await until(() => out.split('\n').find((l) => l.startsWith('{"ok"')), 'the desk answered the launch');
    expect(JSON.parse(launched).ok).toBe(true);

    // The relaunch: the desk is killed outright, mid-arm.
    desk.kill('SIGKILL');
    await new Promise((done) => desk.once('exit', done));
    expect(alive(started.pid)).toBe(true);

    // The next desk boots and carries the set on.
    const { resumeBenchChain } = await import('../../backend/services/bench/bench-launch.js');
    const { chainStates } = await import('../../backend/services/bench/bench-matched.js');
    const comparisonId = await resumeBenchChain();
    expect(comparisonId).toMatch(/^desk-/);
    expect(chainStates().state).toBe('running');

    const chain = await until(() => (chainStates()?.state === 'done' ? chainStates() : null), 'the set finished');
    expect(chain.outcomes.map((o) => [o.arm, o.ok])).toEqual([['bare', true], ['platform', true]]);
    expect(chain.outcomes[0].adopted).toBe(true);
    // Each arm ran exactly once: the adopted arm was never spawned again.
    const rows = await calls();
    expect(rows.filter((c) => c.event === 'start').map((c) => c.arm)).toEqual(['bare', 'platform']);
  }, 60000);

  test('STOP reaches an adopted arm: the set reads stopped and the rest never spawn', async () => {
    const desk = spawnDesk('ignore');
    const started = await until(async () => (await calls()).find((c) => c.event === 'start' && c.arm === 'bare'), 'the bare arm started');
    desk.kill('SIGKILL');
    await new Promise((done) => desk.once('exit', done));
    const { resumeBenchChain, stopOwned } = await import('../../backend/services/bench/bench-launch.js');
    const { chainStates } = await import('../../backend/services/bench/bench-matched.js');
    expect(await resumeBenchChain()).toMatch(/^desk-/);
    expect((await stopOwned()).stopped).toEqual([started.pid]);
    const chain = await until(() => (chainStates()?.state === 'stopped' ? chainStates() : null), 'the set stopped');
    expect(chain.outcomes.map((o) => o.arm)).toEqual(['bare', 'platform']);
    expect(chain.outcomes[1].skipped).toBe(true);
    expect((await calls()).filter((c) => c.event === 'start').map((c) => c.arm)).toEqual(['bare']);
  }, 60000);

  test('a test run that starts mid-set holds the next arm until it ends, never refusing it', async () => {
    const { launch } = await import('../../backend/services/bench/bench-launch.js');
    const { chainStates } = await import('../../backend/services/bench/bench-matched.js');
    expect((await launch('run-benchmark', { cell: 'gsm8k', arms: ['bare', 'platform'], model: 'qwen3.8-27b', lane: 'keir' }, WALLET)).ok).toBe(true);
    // A real runner process carrying the test door's marker: the machine is busy while it lives.
    const tests = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)', process.env.NEUMA_BENCH_TEST_PROCESS_PATTERN], { stdio: 'ignore' });
    desks.push(tests);
    const testsEnded = new Promise((done) => tests.once('exit', () => done(Date.now())));
    const chain = await until(() => (chainStates()?.state === 'done' ? chainStates() : null), 'the set finished');
    const platform = (await calls()).find((c) => c.event === 'start' && c.arm === 'platform');
    expect(platform.at).toBeGreaterThanOrEqual(await testsEnded);
    expect(chain.outcomes.map((o) => [o.arm, o.ok])).toEqual([['bare', true], ['platform', true]]);
  }, 60000);

  test('an arm refused by a test run is no result: it runs again and counts once', async () => {
    await fs.writeFile(path.join(tree, 'refuse-once-platform'), '');
    const { launch } = await import('../../backend/services/bench/bench-launch.js');
    const { chainStates } = await import('../../backend/services/bench/bench-matched.js');
    expect((await launch('run-benchmark', { cell: 'gsm8k', arms: ['bare', 'platform'], model: 'qwen3.8-27b', lane: 'keir' }, WALLET)).ok).toBe(true);
    const chain = await until(() => (chainStates()?.state === 'done' ? chainStates() : null), 'the set finished');
    expect(chain.outcomes.map((o) => [o.arm, o.ok])).toEqual([['bare', true], ['platform', true]]);
    expect((await calls()).filter((c) => c.event === 'start').map((c) => c.arm)).toEqual(['bare', 'platform', 'platform']);
  }, 60000);

  test('with no set running, a booting desk adopts nothing', async () => {
    const { resumeBenchChain } = await import('../../backend/services/bench/bench-launch.js');
    expect(await resumeBenchChain()).toBe(null);
  });
});
