/**
 * bench-matched.test.js — the matched set's chain mechanics against REAL
 * spawned children (RULE 0; the sibling's window-queue/window-stall idiom):
 * a fixture harness tree whose bench.mjs is a real stub child logging its
 * argv + lifecycle to a real file, driven by the real launch(). Sequential
 * order, the shared comparisonId, attempt 1, continue-after-fail, and the
 * plane's own stopOwned marking the chain stopped — no mocks anywhere.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createTempDir } from '../helpers/temp-fs.js';
import { buildBenchFixtureTree } from '../helpers/bench-fixture-tree.js';
import { useTempRealm } from '../helpers/temp-realm.js';

const ENV = ['NEUMA_BENCH_HARNESS_PATH', 'NEUMA_DATA_ROOT', 'WORKSPACES_ROOT', 'NEUMA_BENCH_TEST_PROCESS_PATTERN'];
const WALLET = '0xabc123def456';

// The stub child: logs start/end with its full argv to chain-calls.jsonl (in
// the child's cwd — the harness root), fails the 'platform' arm on purpose,
// and sleeps long on 'neuma' so the stop test can land mid-flight.
const STUB = `import fs from 'node:fs';
const arm = process.argv[process.argv.indexOf('--arm') + 1] ?? '?';
const row = (event) => fs.appendFileSync('chain-calls.jsonl', JSON.stringify({ event, arm, argv: process.argv.slice(2), at: Date.now() }) + '\\n');
row('start');
// 'silo' behaves like the real harness: it traps SIGTERM and exits with a code.
if (arm === 'silo') process.on('SIGTERM', () => { row('term'); process.exit(1); });
setTimeout(() => { row('end'); process.exit(arm === 'platform' ? 1 : 0); }, ['neuma', 'silo'].includes(arm) ? 900 : 60);
`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));


// a settled set notifies its operator — into a temp realm, never the machine's
useTempRealm();
describe('matched chains — real spawned children, real sequencing', () => {
  let house, tree, launch, stopOwned, ownedStatus, chainStates, liveChainWallet;
  const saved = {};

  beforeEach(async () => {
    vi.resetModules();
    for (const k of ENV) { saved[k] = process.env[k]; }
    house = await createTempDir('bench-matched');
    tree = path.join(house, 'harness');
    await buildBenchFixtureTree(tree);
    await fs.writeFile(path.join(tree, 'bench.mjs'), STUB);
    process.env.NEUMA_BENCH_HARNESS_PATH = tree;
    process.env.NEUMA_DATA_ROOT = path.join(house, 'data');
    // The suite runs inside vitest: judge the clear-machine law by a marker
    // no real process carries (the busy verdict is proven in bench-failure-report).
    process.env.NEUMA_BENCH_TEST_PROCESS_PATTERN = `neuma-bench-clear-${process.pid}-${Date.now()}`;
    process.env.WORKSPACES_ROOT = path.join(house, 'workspaces');
    const { claimOwner } = await import('../helpers/claim-owner.js');
    await claimOwner(process.env.WORKSPACES_ROOT, 'keir', WALLET);
    ({ launch, stopOwned, ownedStatus } = await import('../../backend/services/bench/bench-launch.js'));
    ({ chainStates, liveChainWallet } = await import('../../backend/services/bench/bench-matched.js'));
  });

  afterEach(async () => {
    // No chain may outlive a test: stop whatever the plane still owns.
    try { await stopOwned(); } catch { /* nothing owned */ }
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });

  const calls = async () => (await fs.readFile(path.join(tree, 'chain-calls.jsonl'), 'utf8'))
    .trim().split('\n').map(JSON.parse);

  const waitChain = async (state) => {
    for (let i = 0; i < 300; i += 1) {
      const chain = chainStates();
      if (chain?.state === state) return chain;
      await sleep(50);
    }
    throw new Error(`chain never reached ${state}`);
  };

  test('sequential order, one comparisonId, attempt 1, the chain continues after a failing arm', async () => {
    const start = await launch('run-benchmark', {
      cell: 'gsm8k', arms: ['bare', 'platform', 'silo'], model: 'qwen3.8-27b', lane: 'keir', limit: 5,
    }, WALLET);
    expect(start.ok).toBe(true);
    expect(start.comparisonId).toMatch(/^desk-/);
    expect(start.long).toBe(true);

    const chain = await waitChain('done');
    expect(chain.arms).toEqual(['bare', 'platform', 'silo']);
    expect(chain.comparisonId).toBe(start.comparisonId);
    expect(chain.outcomes.map((o) => `${o.arm}:${o.ok}`)).toEqual(['bare:true', 'platform:false', 'silo:true']);
    expect(chain.outcomes[1].exitCode).toBe(1); // the failing arm is marked, honestly
    expect(chain.currentArm).toBeNull();

    const rows = await calls();
    // SEQUENTIAL: each arm's start lands only after the previous arm's end.
    expect(rows.map((r) => `${r.event}:${r.arm}`)).toEqual([
      'start:bare', 'end:bare', 'start:platform', 'end:platform', 'start:silo', 'end:silo',
    ]);
    for (const row of rows.filter((r) => r.event === 'start')) {
      const cid = row.argv[row.argv.indexOf('--comparison-id') + 1];
      expect(cid).toBe(start.comparisonId); // one comparison id on every arm
      expect(row.argv[row.argv.indexOf('--attempt') + 1]).toBe('1');
      expect(row.argv[row.argv.indexOf('--approved-by') + 1]).toBe(WALLET);
      expect(row.argv[row.argv.indexOf('--limit') + 1]).toBe('5');
    }
    const starts = rows.filter((r) => r.event === 'start');
    expect(starts[0].argv).toContain('--endpoint'); // floor arms get the loopback endpoint
    expect(starts[2].argv).toContain('--lane'); // the identity arm rides the lane
    expect(starts[2].argv).not.toContain('--endpoint'); // and never the default endpoint
    expect(ownedStatus()).toEqual([]); // nothing owned after the chain settles
  }, 30000);

  test('stopOwned mid-chain: SIGTERM marks the arm, the chain reads stopped, the rest never spawn', async () => {
    const start = await launch('run-benchmark', {
      cell: 'gsm8k', arms: ['neuma', 'bare'], model: 'qwen3.8-27b', lane: 'keir',
    }, WALLET);
    expect(start.ok).toBe(true);
    // neuma runs long (the stub's 900ms) — wait until the child ITSELF is
    // alive (its own start row on disk), not merely registered: a SIGTERM
    // during node's boot kills it before it ever wrote, and a stop-before-
    // start proves nothing about stopping MID-arm.
    const startedRows = async (arm) => {
      try { return (await calls()).filter((r) => r.event === 'start' && r.arm === arm); }
      catch { return []; }
    };
    for (let i = 0; i < 200 && (await startedRows('neuma')).length === 0; i += 1) await sleep(25);
    expect((await startedRows('neuma')).length).toBe(1);
    expect(chainStates().currentArm).toBe('neuma');
    // the bench watch addresses the rig's alerts to the wallet whose set runs — kept off the desk's snapshot
    expect(liveChainWallet()).toBe(WALLET);
    expect(JSON.stringify(chainStates())).not.toContain(WALLET);
    expect(ownedStatus().length).toBe(1);
    expect(ownedStatus()[0].verb).toBe('run-benchmark');

    const stopped = await stopOwned();
    expect(stopped.ok).toBe(true);
    expect(stopped.stopped.length).toBe(1);

    const chain = await waitChain('stopped');
    expect(chain.outcomes).toEqual([
      expect.objectContaining({ arm: 'neuma', signal: 'SIGTERM' }),
      expect.objectContaining({ arm: 'bare', skipped: true }),
    ]);
    const rows = await calls();
    expect(rows.filter((r) => r.arm === 'bare')).toEqual([]); // never spawned
    expect(ownedStatus()).toEqual([]);
    expect(liveChainWallet()).toBeNull(); // a settled set addresses nothing
  }, 30000);

  test('one STOP ends the whole set even when the harness traps SIGTERM and exits with a code (#568)', async () => {
    const start = await launch('run-benchmark', {
      cell: 'gsm8k', arms: ['silo', 'neuma', 'bare'], model: 'qwen3.8-27b', lane: 'keir',
    }, WALLET);
    expect(start.ok).toBe(true);
    const started = async (arm) => {
      try { return (await calls()).some((r) => r.event === 'start' && r.arm === arm); }
      catch { return false; }
    };
    for (let i = 0; i < 200 && !(await started('silo')); i += 1) await sleep(25);
    expect(await started('silo')).toBe(true);
    expect((await stopOwned()).ok).toBe(true);
    const chain = await waitChain('stopped');
    expect(chain.outcomes).toEqual([
      expect.objectContaining({ arm: 'silo', exitCode: 1, signal: null }),
      expect.objectContaining({ arm: 'neuma', skipped: true }),
      expect.objectContaining({ arm: 'bare', skipped: true }),
    ]);
    const rows = await calls();
    expect(rows.some((r) => r.arm === 'silo' && r.event === 'term')).toBe(true);
    expect(rows.filter((r) => r.arm === 'neuma' || r.arm === 'bare')).toEqual([]); // never spawned
  }, 30000);

  test('the plane-busy and rig-lock laws bind the whole chain', async () => {
    const first = await launch('run-benchmark', {
      cell: 'gsm8k', arms: ['neuma', 'bare'], model: 'qwen3.8-27b', lane: 'keir',
    }, WALLET);
    expect(first.ok).toBe(true);
    for (let i = 0; i < 100 && ownedStatus().length === 0; i += 1) await sleep(25);
    const second = await launch('run-benchmark', {
      cell: 'gsm8k', arms: ['bare'], model: 'qwen3.8-27b',
    }, WALLET);
    expect(second.ok).toBe(false);
    expect(second.code).toBe('BENCH_PLANE_BUSY');
    await stopOwned();
    await waitChain('stopped');
  }, 30000);

  test('a live rig lock refuses the chain (409) before anything spawns', async () => {
    // The lock names a LIVE pid (this test process) — real liveness law.
    await fs.mkdir(path.join(tree, 'active.lock'), { recursive: true });
    await fs.writeFile(path.join(tree, 'active.lock', 'owner.json'), JSON.stringify({ pid: process.pid }));
    const res = await launch('run-benchmark', {
      cell: 'gsm8k', arms: ['bare'], model: 'qwen3.8-27b',
    }, WALLET);
    expect(res.ok).toBe(false);
    expect(res.code).toBe('BENCH_RIG_LOCKED');
    expect(res.message).toContain(String(process.pid));
    expect(await fs.readFile(path.join(tree, 'chain-calls.jsonl')).catch(() => null)).toBeNull();
  });
});
