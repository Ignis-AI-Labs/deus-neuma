/**
 * BENCHMARKS FROM THE CONVERSATION (RULE 0) — Design note, 2026-10-15: […].
 *
 * The REAL benchmarks repository on this machine (read only — its cells,
 * models and run receipts), a real temp realm with a real harness lane and a
 * real being lane, the real catalog builder, the real dispatcher's handler and
 * the real launch boundary. Nothing here launches a run: every launch path
 * exercised refuses BEFORE a child is spawned (a seat's arms, a harness lane
 * carrying no being, a benchmark already running on this machine).
 * Skips when no benchmarks repository is connected.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setHarnessRoot } from '../../core/workspace/lane-grounds.js';
import { generateKeypair } from '../../core/weave/keypair.js';
import { ensureHarnessLane } from '../../backend/services/harness-lane.js';
import { available, harnessRoot } from '../../backend/services/bench/bench-paths.js';
import { benchToolsFor, handleBenchTool, isBenchTool, liveRuns } from '../../backend/services/bench/bench-being-tools.js';
import { listOwnedLanes, laneRootFor } from '../../backend/services/bench/bench-lanes.js';
import { launch } from '../../backend/services/bench/bench-launch.js';
import { platformToolsFor } from '../../backend/services/portal-tool-catalog.js';
import { TOOL_RESULT_MAX_CHARS } from '../../backend/services/tool-exchange.js';

const connected = available(harnessRoot());
const ENV = ['DNA_ENCRYPTION_KEY', 'NEUMA_ROUTES_PATH', 'NEUMA_PROVIDER_CREDENTIALS_PATH'];
let root; let saved; let savedHouse; let wallet; let harnessLane;
const BEING = 'bench-tools-being';

const seat = (laneId) => ({
  walletAddress: wallet, toolMode: 'auto', activeTurn: new AbortController(),
  companion: { name: 'X', neumaId: laneId, participantKind: laneId.startsWith('harness-') ? 'harness' : 'neuma' },
});
const call = (laneId, toolName, args = {}) => handleBenchTool(null, seat(laneId), null, 'auto', { server: 'bench', toolName }, args);

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  savedHouse = getWorkspacesRoot();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-tools-'));
  Object.assign(process.env, {
    DNA_ENCRYPTION_KEY: 'bench-tools-test-key-long-enough-for-the-law',
    NEUMA_ROUTES_PATH: path.join(root, 'routes.json'), NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(root, 'cred.json'),
  });
  setWorkspacesRoot(path.join(root, 'house'));
  setHarnessRoot(path.join(root, 'harness'));
  wallet = generateKeypair().address.toLowerCase();
  ({ laneId: harnessLane } = await ensureHarnessLane(wallet, { providerId: 'llama-server', model: 'qwen3.8-27b' }));
  await workspace.create(BEING);
  await workspace.writeDNA(BEING, { version: '1.0.0', identity: { name: 'Bench' } });
  await fs.writeFile(path.join(workspace.pathFor(BEING), 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
});

afterAll(async () => {
  setHarnessRoot(null);
  setWorkspacesRoot(savedHouse);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await fs.rm(root, { recursive: true, force: true });
});

describe.runIf(connected)('the connected benchmarks, from the conversation', () => {
  test('the bench family rides the harness seat and a being\'s, once a lane is bound', async () => {
    expect(benchToolsFor(seat(harnessLane)).map((t) => t.name)).toEqual(['bench_list', 'bench_status', 'bench_run']);
    expect(benchToolsFor({ companion: null })).toEqual([]);
    // inside a benchmark, the item under test never reaches the bench that measures it
    expect(benchToolsFor({ ...seat(harnessLane), _benchmarkControls: { platformOnly: true } })).toEqual([]);
    const harnessSurface = (await platformToolsFor(seat(harnessLane), { seat: 'harness' })).tools.map((t) => `${t.server}/${t.name}`);
    expect(harnessSurface).toEqual(expect.arrayContaining(['bench/bench_list', 'bench/bench_status', 'bench/bench_run']));
    expect(isBenchTool({ tool: 'bench/bench_list' })).toBe(true);
  });

  test('bench_list reads the real repository: the harness runs bare and harness, a being also itself', async () => {
    const onHarness = await call(harnessLane, 'bench_list', { query: 'gsm8k platinum' });
    expect(onHarness.status).toBe('ok');
    expect(onHarness.content).toContain(`in the benchmarks repository (${harnessRoot()}); this seat runs arms bare, harness.`);
    expect(onHarness.content).toMatch(/^gsm8k-platinum — GSM8K Platinum \[math, reasoning\] t1/m);
    const onBeing = await call(BEING, 'bench_list', { query: 'gsm8k platinum' });
    expect(onBeing.content).toContain('this seat runs arms bare, harness, neuma.');
    // the whole catalog fits ONE tool result — never a page the model must fetch back
    const whole = await call(harnessLane, 'bench_list');
    expect(whole.content.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    // a cell this seat runs only in part says which arms
    expect(whole.content).toMatch(/^terminal-bench — .* · arms here: harness/m);
    // a filter that matches nothing says so rather than listing nothing
    expect((await call(harnessLane, 'bench_list', { query: 'no-such-benchmark-anywhere' })).content).toContain('No cell matches');
  });

  test('bench_status reads this machine: what runs now and the latest finished runs', async () => {
    const status = await call(harnessLane, 'bench_status');
    expect(status.status).toBe('ok');
    expect(status.content).toMatch(/^(Running now on this machine|Nothing is running)/);
    // a live run is named by its cell and arm, read from the runner itself
    for (const run of await liveRuns()) expect(status.content).toContain(run.split(' · running')[0]);
    expect(status.content).toContain('Latest finished runs:');
  });

  test('bench_run refuses an arm the seat cannot run — before anything spawns', async () => {
    const r = await call(harnessLane, 'bench_run', { cell: 'smoke', arms: ['neuma'] });
    expect(r).toMatchObject({ status: 'denied' });
    expect(r.error).toContain('This seat cannot run neuma');
  });

  test('bench_run refuses while a benchmark already runs on this machine (two runs would measure each other)', async (ctx) => {
    if (!(await liveRuns()).length) ctx.skip(); // nothing running to prove against
    const r = await call(harnessLane, 'bench_run', { cell: 'smoke', arms: ['harness'] });
    expect(r).toMatchObject({ status: 'denied' });
    expect(r.error).toContain('already running on this machine');
  });

  test('house work reads the bench but never launches: no Optio CLEAR or charter stands in for the operator\'s yes', async () => {
    // a wake's or a team member's connection, as wake-turn.js / team-member-turn.js build it
    const houseWork = (laneId) => ({ ...seat(laneId), toolMode: 'ask', sessionId: 's-house', _approvalRefusal: 'nobody is at the desk' });
    expect(benchToolsFor(houseWork(BEING)).map((t) => t.name)).toEqual(['bench_list', 'bench_status']);
    const surface = (await platformToolsFor(houseWork(BEING), { seat: 'neuma' })).tools.map((t) => `${t.server}/${t.name}`);
    expect(surface).not.toContain('bench/bench_run');
    // a call made anyway is refused before the gate: no route is asked, nothing spawns, no approval is recorded
    const r = await handleBenchTool(null, houseWork(BEING), null, 'ask', { server: 'bench', toolName: 'bench_run' }, { cell: 'no-such-cell', arms: ['bare'] });
    expect(r).toMatchObject({ tool: 'bench/bench_run', status: 'denied' });
    expect(r.error).toContain('only your operator opens');
    expect(r.error).toContain('It was NOT launched');
    expect((await call(BEING, 'bench_status')).status).toBe('ok'); // the reads stay open
  });

  test('the desk\'s lanes include the operator\'s harness lane; it lives on its own ground', async () => {
    const lanes = await listOwnedLanes(wallet);
    expect(lanes).toEqual(expect.arrayContaining([
      { laneId: harnessLane, label: 'HARNESS', kind: 'harness' }, expect.objectContaining({ laneId: BEING, kind: 'neuma' }),
    ]));
    expect(laneRootFor(harnessLane)).toBe(path.join(root, 'harness'));
    expect(await listOwnedLanes(generateKeypair().address.toLowerCase())).toEqual([]);
  });

  test('the launch boundary: a harness lane carries no being — neuma on it is refused before any spawn', async () => {
    const r = await launch('run-benchmark', {
      cell: 'smoke', arms: ['harness', 'neuma'], model: 'qwen3.8-27b-uncensored-hauhaucs', lane: harnessLane,
    }, wallet);
    expect(r).toMatchObject({ ok: false, status: 400, code: 'BENCH_BAD_PARAMS' });
    expect(r.message).toContain('a harness lane carries no being');
  });
});
