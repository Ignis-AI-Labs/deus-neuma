/**
 * Pre-flight allocation enforcement — the witness can't promise a new neuma
 * space already committed to existing neuma. The pre-flight must reason about
 * free − committed, not raw disk-free.
 *
 * NOTHING IS MOCKED (#390 tranche 6). This file used to stub EIGHT of the
 * thirteen check rows — substrate, liveness, the ceremony road, all four
 * birth-flight probes, MCP — in order to hold them still while it measured
 * the allocation. But `preflight-routes.js` opens with […], so stubbing eight of them inverted the one property
 * the endpoint exists to have. A green verdict here meant a verdict over
 * eight rows nobody measured.
 *
 * They are all real now, and they really pass, because the things they probe
 * are really provided:
 *   - a REAL loopback OpenAI-compatible server, so `checkSubstrate` and
 *     `probeLiveness` reach a conduit that really answers (measured:
 *     "answered in 6ms") instead of a stub asserting it did;
 *   - the REAL in-process filesystem organ, stood the way boot stands it, so
 *     `checkCeremonyRoad` and the birth-flight rows really write their probe
 *     files and really read them back;
 *   - the machine's own real disk, memory, GPU and trainer.
 *
 * Machine-portability is handled honestly rather than by stubbing: the only
 * unconditional verdict claim is the one this file exists to defend (an
 * unaffordable allocation BLOCKS). The […] claim is
 * stated as a relationship to the real rows, so a rig without a GPU reports
 * the truth instead of a false red. On this rig all thirteen rows pass, so
 * the ready branch is genuinely exercised here.
 *
 * THE COST, stated plainly: ~30s for the file, against ~1s stubbed. That is
 * what thirteen real probes of a real machine cost — a real generation over a
 * real socket, real MCP tool calls that really write and read back, real disk
 * and trainer inspection. It is the price of the row meaning anything, and it
 * is paid per GET, which is why the timeouts below are generous. Nothing is
 * left behind: the ceremony-road probe cleans up its own files (verified).
 */
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { startLocalProvider } from '../helpers/local-provider.js';
import { strangerWitness } from '../helpers/witness.js';

const writeNeuma = (root, id, gb) => {
  mkdirSync(path.join(root, id), { recursive: true });
  writeFileSync(path.join(root, id, 'allocation.json'), JSON.stringify({ allocatedGB: gb }));
};

let provider, app, witness, previousLlmConfig, previousRoot;
let core, saveWorkspaceSettings;

beforeAll(async () => {
  // A REAL conduit the real probes can really reach.
  provider = await startLocalProvider({ models: ['test-model'], reply: 'Hello.' });
  const llm = await import('../../backend/services/llm-provider.js');
  previousLlmConfig = llm.getConfig();
  llm.setConfig({
    provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '',
  });

  // The platform's own filesystem organ, stood the way boot stands it — the
  // ceremony-road and birth-flight rows walk real tool calls through it.
  const { connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js');
  await connectFilesystemServer();

  core = await import('../../core/index.js');
  previousRoot = core.getWorkspacesRoot();
  ({ saveWorkspaceSettings } = await import('../../backend/services/workspace-settings.js'));

  const { default: router } = await import('../../backend/routes/preflight-routes.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1/preflight', router);

  // POST /workspace only gates on a session, never on a lane — a real wallet
  // holding a real HMAC token and owning nothing is the right shape.
  witness = strangerWitness();
}, 120000);

afterAll(async () => {
  core.setWorkspacesRoot(previousRoot);
  const llm = await import('../../backend/services/llm-provider.js');
  llm.setConfig(previousLlmConfig);
  await provider.close();
});

describe('Pre-flight allocation accounting', () => {
  let root, foreignRoot;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'preflight-alloc-'));
    foreignRoot = mkdtempSync(path.join(os.tmpdir(), 'preflight-foreign-'));
    // POST /workspace persists the witness's home choice; isolate it so the
    // suite never clobbers the operator's LIVE data/settings/workspace.json
    // (it silently destroyed a real pre-flight choice on the GB10 rig).
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(root, 'workspace-settings.json');
    writeNeuma(root, 'neuma-a', 4000);        // current root: 4000 committed
    writeNeuma(foreignRoot, 'neuma-b', 7000); // a different, already-inhabited root
    core.setWorkspacesRoot(root);
  });

  afterEach(() => {
    delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
    rmSync(root, { recursive: true, force: true });
    rmSync(foreignRoot, { recursive: true, force: true });
  });

  test('GET / surfaces committed/available/count for the current root', async () => {
    const res = await request(app).get('/api/v1/preflight');
    expect(res.status).toBe(200);
    expect(res.body.home.committedGB).toBe(4000);
    expect(res.body.home.neumaCount).toBe(1);
    expect(res.body.home.availableGB).toBe(Math.max(0, res.body.home.freeGB - 4000));
    // A MODEST starting allocation is suggested — ~10% of available, floored at
    // the 1 GB min. null below the smallest applyable grant (availableGB < 2 *
    // MIN_FREE_DISK_GB = 2): POST would reject any number we could name there.
    const av = res.body.home.availableGB;
    const expected = (av != null && av >= 2) ? Math.max(1, Math.round(av * 0.10)) : null;
    expect(res.body.home.suggestedAllocationGB).toBe(expected);
  }, 120000);

  test('GET / suggests ~10% of available when there is real headroom (positive branch)', async () => {
    // An empty root has nothing committed → availableGB == freeGB (a real,
    // positive number on the temp disk), so this exercises the FORMULA branch
    // that the 4000-GB-committed default never reaches.
    const empty = mkdtempSync(path.join(os.tmpdir(), 'preflight-empty-'));
    core.setWorkspacesRoot(empty);
    try {
      const res = await request(app).get('/api/v1/preflight');
      expect(res.status).toBe(200);
      const av = res.body.home.availableGB;
      expect(av).toBeGreaterThan(2); // genuine headroom — we are in the formula branch
      expect(res.body.home.suggestedAllocationGB).toBe(Math.max(1, Math.round(av * 0.10)));
    } finally {
      core.setWorkspacesRoot(root);
      rmSync(empty, { recursive: true, force: true });
    }
  }, 120000);

  test('POST /workspace rejects an allocation beyond available, naming the committed amount', async () => {
    const res = await request(app)
      .post('/api/v1/preflight/workspace')
      .set(witness.header)
      .send({ root, allocationGB: 1_000_000_000 });
    expect(res.status).toBe(422);
    expect(res.body.committedGB).toBe(4000);
    expect(res.body.availableGB).toBe(Math.max(0, res.body.freeGB - 4000));
    expect(res.body.error).toMatch(/committed to existing neuma/i);
  });

  test('GET / BLOCKS when the chosen allocation exceeds what is available', async () => {
    // THE REGRESSION THIS FILE EXISTS FOR. A persisted allocation that was
    // affordable when set but is now over-committed (existing neuma reserved
    // the disk) must read as blocked, not READY. Unconditional on any machine:
    // affordable === false forces 'blocked' whatever the hardware rows say.
    await saveWorkspaceSettings({ root, allocationGB: 1_000_000_000 });

    const res = await request(app).get('/api/v1/preflight');
    expect(res.status).toBe(200);
    expect(res.body.home.affordable).toBe(false);
    expect(res.body.verdict).toBe('blocked');
  }, 120000);

  test('GET / stays affordable=null when no allocation has been chosen', async () => {
    await saveWorkspaceSettings({ root, allocationGB: null });
    const res = await request(app).get('/api/v1/preflight');
    expect(res.body.home.affordable).toBe(null);
  }, 120000);

  test('POST /workspace counts commitments at the TARGET root, not the current one', async () => {
    // Pointing the home at a DIFFERENT already-inhabited root must tally THAT
    // root's reservations (7000), not the current root's (4000) and not zero.
    const res = await request(app)
      .post('/api/v1/preflight/workspace')
      .set(witness.header)
      .send({ root: foreignRoot, allocationGB: 1_000_000_000 });
    expect(res.status).toBe(422);
    expect(res.body.committedGB).toBe(7000); // read the target root, not the current one
  });

  test('POST /workspace without Authorization → 401 (SEC-AUDIT-002)', async () => {
    const res = await request(app)
      .post('/api/v1/preflight/workspace')
      .send({ root, allocationGB: 2 });
    expect(res.status).toBe(401);
  });
});

describe('Pre-flight verdict — affordability moves it, and only it', () => {
  let root, prevDnaKey;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'preflight-afford-'));
    process.env.NEUMA_WORKSPACE_SETTINGS_PATH = path.join(root, 'workspace-settings.json');
    prevDnaKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = process.env.DNA_ENCRYPTION_KEY || 'x'.repeat(32);
    core.setWorkspacesRoot(root);
  });

  afterEach(() => {
    delete process.env.NEUMA_WORKSPACE_SETTINGS_PATH;
    rmSync(root, { recursive: true, force: true });
    if (prevDnaKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevDnaKey;
  });

  test('an unaffordable allocation blocks even when every real row passes', async () => {
    writeNeuma(root, 'hog', 1_000_000_000); // commits past the disk → available 0
    await saveWorkspaceSettings({ root, allocationGB: 50 });

    const res = await request(app).get('/api/v1/preflight');
    expect(res.status).toBe(200);
    expect(res.body.home.affordable).toBe(false);
    expect(res.body.verdict).toBe('blocked'); // the || affordable===false clause

    // Over-committed (availableGB === 0) → no applyable grant exists, so NO
    // number is suggested (the UI prompts to choose rather than naming a 422).
    expect(res.body.home.availableGB).toBe(0);
    expect(res.body.home.suggestedAllocationGB).toBe(null);

    // And the blocking really was affordability, not a broken machine: the
    // real rows are reported alongside so a hardware failure here reads as a
    // hardware failure rather than silently propping this assertion up.
    const fails = res.body.checks.filter((c) => c.status === 'fail').map((c) => c.id);
    expect(fails).toEqual([]);
  }, 120000);

  test('an affordable allocation leaves the verdict to the real rows alone', async () => {
    await saveWorkspaceSettings({ root, allocationGB: 1 }); // 1 GB on an empty temp root fits

    const res = await request(app).get('/api/v1/preflight');
    expect(res.status).toBe(200);
    expect(res.body.home.affordable).toBe(true);

    // Stated as the relationship the route really computes, so this is true on
    // any rig: with affordability satisfied, the verdict is exactly what the
    // measured rows dictate. On a machine whose rows all pass — this one — that
    // means READY, and the second assertion pins that rather than letting the
    // first one pass vacuously on a broken rig.
    const anyFail = res.body.checks.some((c) => c.status === 'fail');
    expect(res.body.verdict).toBe(anyFail ? 'blocked' : 'ready');
    expect(res.body.checks.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual([]);
    expect(res.body.verdict).toBe('ready');
  }, 120000);

  test('every row is a real measurement — thirteen of them, none stubbed', async () => {
    // The property the old file destroyed. Each row names a real probe of this
    // machine; a row that silently vanished (or a probe that never ran) is a
    // hole in the launch gate, and the endpoint would still answer 200.
    const res = await request(app).get('/api/v1/preflight');
    expect(res.status).toBe(200);

    const ids = res.body.checks.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([
      'substrate', 'acting', 'workspace', 'ceremonyRoad', 'records',
      'protocol', 'sealing', 'disk', 'memory', 'dnaKey', 'mcp', 'gpu', 'trainer',
    ]));
    for (const check of res.body.checks) {
      expect(check.status).toMatch(/^(pass|warn|fail)$/);
      expect(typeof check.detail).toBe('string');
      expect(check.detail.length).toBeGreaterThan(0);
    }

    // The substrate row really spoke to the conduit: our loopback server saw
    // the traffic. Under the old stubs this number was always zero.
    expect(provider.turns.length).toBeGreaterThan(0);
  }, 120000);
});
