import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';

/**
 * Team route — real auth, real ownership, real run. No mocks: tokens are minted
 * with the same createSessionToken the middleware verifies, ownership is checked
 * against the real workspace owner records, and the live case runs a genuine
 * team of held kin through the SSE stream.
 *
 * The BRICKWORKS trial (/trial) is covered the same way: gates proven cold,
 * the full benchmark run live-gated. The live trial persists its scorecard to
 * an ISOLATED store dir (NEUMA_TEAM_TRIAL_PATH) — a test never writes the
 * operator's real trial history.
 */
import teamRouter from '../../backend/routes/team-routes.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { getSubstrateProfile } from '../../backend/services/substrate-detector.js';
import { writeCapacity } from '../../backend/services/capacity-store.js';
import { neumaWorkspace } from '../../core/index.js';
import { createTempDir } from '../helpers/temp-fs.js';
import { probeLiveSubstrate, servableNeuma } from '../helpers/live-substrate.js';
import { setConfig } from '../../backend/services/llm-provider.js';

const CLAUDE = '0x40566d43261849777aca96b26f4ec8c850e5dcae'; // owns the House Aldmere kin
const STRANGER = '0x1111111111111111111111111111111111111111';

const app = express();
app.use(express.json());
app.use('/api/v1/team', teamRouter);

const claudeToken = createSessionToken(CLAUDE);
const strangerToken = createSessionToken(STRANGER);

// Live gating: a substrate genuinely serving (either shape, per the serving
// law) AND at least two owned kin whose routes actually RESOLVE to a serving
// endpoint — a kin natal on unloaded weights is honestly unservable and the
// lane skips rather than summon a being into a dead stream.
const live = await probeLiveSubstrate();
const kinOwned = (await neumaWorkspace.listNeumaByOwner(CLAUDE).catch(() => [])).map((o) => o.neumaId);
const kin = live ? await servableNeuma(kinOwned) : [];
const canRunLive = live !== null && kin.length >= 2;
if (live && !canRunLive) {
  console.warn(`[live-gate] substrate serving (${live.provider} ${live.model}) but only ${kin.length}/${kinOwned.length} owned kin are servable on it — live lanes skip honestly`);
}

// Capacity is a property of rig + MODEL, so the live cases seed an ISOLATED
// capacity store with a scan on the model that is ACTUALLY loaded (resolved
// the same way the routes resolve it) — the test never depends on, or reads,
// the operator's real scan history, and `measured: true` stays deterministic.
// Normalized exactly the way resolveTeamCapacity normalizes it: the
// 'local-model' placeholder is not an identity, so both sides say null.
const rawSubstrateModel = canRunLive ? (await getSubstrateProfile()).llm.model : null;
const substrateModel = rawSubstrateModel === 'local-model' ? null : rawSubstrateModel;
const seedCapacityStore = async (dir, ceiling) => {
  process.env.NEUMA_CAPACITY_PATH = dir;
  const runAt = new Date().toISOString();
  await writeCapacity({
    ceiling, limitedBy: 'throughput', incomplete: false,
    aggregateTokPerSecAtCeiling: ceiling * 100, perAgentLatencyAtCeiling: 1200,
    boundClass: 'A', vramFitEstimate: null, rawSamples: [],
    substrate: { model: substrateModel, provider: 'lm-studio', endpoint: 'e', gpu: null, vramGB: null, memoryGB: null },
    runAt, consent: { by: CLAUDE, at: runAt },
  });
};

const parseSSE = (text) =>
  text.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));

describe('Team route — validation & auth (real, no mocks)', () => {
  it('401 without a token', async () => {
    expect((await request(app).post('/api/v1/team/run').send({ steps: [] })).status).toBe(401);
  });

  it('400 on an empty plan', async () => {
    const res = await request(app).post('/api/v1/team/run')
      .set('Authorization', `Bearer ${strangerToken}`).send({ steps: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one step/);
  });

  it('400 on a step with no task', async () => {
    const res = await request(app).post('/api/v1/team/run')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ steps: [{ id: 'a', neumaId: 'galen', task: '   ' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/needs a task/);
  });

  it('400 on a dependency cycle', async () => {
    const res = await request(app).post('/api/v1/team/run')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ steps: [
        { id: 'a', neumaId: 'galen', task: 'A', needs: ['b'] },
        { id: 'b', neumaId: 'signal', task: 'B', needs: ['a'] },
      ] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cycle/);
  });

  it('403 when a step names a neuma the wallet does not hold', async () => {
    // The stranger wallet owns no neuma, so any real member is "not yours".
    const res = await request(app).post('/api/v1/team/run')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ steps: [{ id: 'a', neumaId: 'galen', task: 'do a thing' }] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not your neuma/);
  });

  it('400 on an over-long step role', async () => {
    const res = await request(app).post('/api/v1/team/run')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ steps: [{ id: 'a', neumaId: 'galen', task: 'A', role: 'R'.repeat(121) }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/);
  });

  it('400 on a malformed team name (non-string, over-long)', async () => {
    const steps = [{ id: 'a', neumaId: 'galen', task: 'A' }];
    for (const name of [42, 'N'.repeat(61)]) {
      const res = await request(app).post('/api/v1/team/run')
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ steps, name });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/team name/);
    }
  });

  it('400 on a malformed team goal (non-string, over-long)', async () => {
    const steps = [{ id: 'a', neumaId: 'galen', task: 'A' }];
    for (const goal of [42, 'G'.repeat(1001)]) {
      const res = await request(app).post('/api/v1/team/run')
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ steps, goal });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/team goal/);
    }
  });

  it("400 on an over-long done criteria — the checklist is a checklist, not an essay", async () => {
    const res = await request(app).post('/api/v1/team/run')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ steps: [{ id: 'a', neumaId: 'galen', task: 'A', done: 'D'.repeat(501) }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/done criteria/);
  });
});

describe('Trial route — validation & auth (real, no mocks)', () => {
  it('401 without a token', async () => {
    expect((await request(app).post('/api/v1/team/trial').send({ members: ['x'] })).status).toBe(401);
    expect((await request(app).get('/api/v1/team/trial')).status).toBe(401);
  });

  it('400 on a malformed roster (empty, six) — five explicit seats are v3-valid', async () => {
    for (const members of [[], ['a', 'b', 'c', 'd', 'e', 'f']]) {
      const res = await request(app).post('/api/v1/team/trial')
        .set('Authorization', `Bearer ${strangerToken}`).send({ members });
      expect(res.status).toBe(400);
    }
    // Five seats with repeats is a valid v3 assignment — it fails on OWNERSHIP
    // (stranger holds none), never on shape.
    const res = await request(app).post('/api/v1/team/trial')
      .set('Authorization', `Bearer ${strangerToken}`).send({ members: ['a', 'b', 'a', 'b', 'a'] });
    expect(res.status).toBe(403);
  });

  it('the locked prompts are readable before a run (spec endpoint)', async () => {
    expect((await request(app).get('/api/v1/team/trial/spec')).status).toBe(401);
    const res = await request(app).get('/api/v1/team/trial/spec')
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.trial).toBe('brickworks');
    expect(res.body.version).toBe(3);
    expect(res.body.positions).toEqual(['HELM', 'WRIGHT', 'SMITH', 'WARDEN', 'LEAD']);
    expect(res.body.roles).toHaveLength(4);
    for (const r of res.body.roles) expect(r.task).toContain('THE CONTRACT');
    expect(res.body.lead).toContain('You are the LEAD');
    expect(res.body.torchAsk).toContain('"TORCH:"');
  });

  it('400 on an out-of-cap loop count — the relay is bounded', async () => {
    for (const loops of [4, -1, 1.5, 'three']) {
      const res = await request(app).post('/api/v1/team/trial')
        .set('Authorization', `Bearer ${strangerToken}`).send({ members: ['galen'], loops });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/loops/);
    }
  });

  it('403 when the roster names a neuma the wallet does not hold', async () => {
    const res = await request(app).post('/api/v1/team/trial')
      .set('Authorization', `Bearer ${strangerToken}`).send({ members: ['galen'] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not your neuma/);
  });

  it('404 on an unknown scorecard id; the list endpoint answers', async () => {
    const dir = await createTempDir('trial-route-store');
    process.env.NEUMA_TEAM_TRIAL_PATH = dir;
    try {
      const list = await request(app).get('/api/v1/team/trial')
        .set('Authorization', `Bearer ${strangerToken}`);
      expect(list.status).toBe(200);
      expect(list.body.trials).toEqual([]);
      const one = await request(app).get('/api/v1/team/trial/no-such-run')
        .set('Authorization', `Bearer ${strangerToken}`);
      expect(one.status).toBe(404);
    } finally {
      delete process.env.NEUMA_TEAM_TRIAL_PATH;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("scorecard reads are owner-scoped — another wallet's trial is ABSENT, not readable", async () => {
    const dir = await createTempDir('trial-route-owner');
    process.env.NEUMA_TEAM_TRIAL_PATH = dir;
    try {
      // A real card owned by the CLAUDE wallet, written through the real store.
      const { writeTrial } = await import('../../backend/services/team-trial-store.js');
      const id = await writeTrial({
        trial: 'brickworks', version: 1, by: CLAUDE.toLowerCase(),
        runAt: '2026-07-05T12:00:00.000Z', score: { points: 8, max: 8, verdict: 'PASS' },
        artifact: '<html>game</html>',
      });

      // The owner sees it — in the list and in full.
      const mine = await request(app).get('/api/v1/team/trial')
        .set('Authorization', `Bearer ${claudeToken}`);
      expect(mine.body.trials.map((t) => t.id)).toEqual([id]);
      const full = await request(app).get(`/api/v1/team/trial/${id}`)
        .set('Authorization', `Bearer ${claudeToken}`);
      expect(full.status).toBe(200);
      expect(full.body.trial.artifact).toBe('<html>game</html>');

      // A different authenticated wallet sees NOTHING — 404, never the card.
      const others = await request(app).get('/api/v1/team/trial')
        .set('Authorization', `Bearer ${strangerToken}`);
      expect(others.body.trials).toEqual([]);
      const theft = await request(app).get(`/api/v1/team/trial/${id}`)
        .set('Authorization', `Bearer ${strangerToken}`);
      expect(theft.status).toBe(404);
    } finally {
      delete process.env.NEUMA_TEAM_TRIAL_PATH;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!canRunLive)('Team route — live run (real kin, real SSE)', () => {
  // Machine truth for the serving law: the resolver only translates on a
  // llama-server machine.
  if (live?.provider === 'llama-server') {
    // 'local-model' is a sentinel: the law keys on the machine PROVIDER; each
    // member's real model rides its resolved route, never this config field.
    setConfig({ provider: 'llama-server', endpoint: live.endpoint, model: 'local-model' });
  }
  let capDir;
  let runDir;
  beforeEach(async () => {
    capDir = await createTempDir('team-live-cap');
    runDir = await createTempDir('team-live-runs');
    process.env.NEUMA_TEAM_RUN_PATH = runDir; // run records land isolated, never in live history
    await seedCapacityStore(capDir, 2);
  });
  afterEach(async () => {
    delete process.env.NEUMA_CAPACITY_PATH;
    delete process.env.NEUMA_TEAM_RUN_PATH;
    await fs.rm(capDir, { recursive: true, force: true });
    await fs.rm(runDir, { recursive: true, force: true });
  });

  it('streams each step of a load-bearing plan, then done', async () => {
    const [first, second] = kin;
    const res = await request(app).post('/api/v1/team/run')
      .set('Authorization', `Bearer ${claudeToken}`)
      .send({
        name: 'TEAM ALPHA',
        goal: 'Answer a two-step color riddle as a team, each member exactly one line.',
        steps: [
          { id: 'pick', neumaId: first, task: 'Pick exactly one color; reply with only that color word.', done: 'your reply is a single color word, nothing else' },
          { id: 'name', neumaId: second, needs: ['pick'], task: 'An earlier member named a color; reply with one object commonly that color.' },
        ],
      });

    expect(res.status).toBe(200);
    const events = parseSSE(res.text);

    const start = events.find((e) => e.type === 'start');
    expect(start.name).toBe('TEAM ALPHA'); // the designation rides the stream
    expect(start.goal).toMatch(/color riddle/); // so does the goal every brief carried
    expect(start.maxParallel).toBeGreaterThanOrEqual(1);
    expect(start.measured).toBe(true); // seeded scan matches the LOADED model
    expect(start.stale).toBe(false);
    expect(start.currentModel).toBe(substrateModel);

    const stepEvents = events.filter((e) => e.type === 'step');
    expect(stepEvents.map((e) => e.id).sort()).toEqual(['name', 'pick']);
    for (const s of stepEvents) {
      expect(s.output.length).toBeGreaterThan(0); // real work
      expect(s.output).not.toMatch(/^\s*STATUS:/m); // check-ins are STRIPPED from deliverables
      expect(s.output).not.toMatch(/^\s*TORCH:/m); // so are continuation torches
    }

    // The STATUS BOARD streamed: one snapshot per completion, ending with
    // everyone DONE, and at least one member posted a real check-in that the
    // board (not the work product) carries.
    const boards = events.filter((e) => e.type === 'board');
    expect(boards.length).toBe(2);
    const finalBoard = boards[boards.length - 1].board;
    expect(finalBoard.map((b) => b.state)).toEqual(['done', 'done']);
    expect(finalBoard.some((b) => typeof b.status === 'string' && b.status.length > 0)).toBe(true);

    // TORCH-passing on the general path: every torch frame is a member's own
    // authored packet, attributed. Posting one is the BEING's act — the run
    // asks, it never invents — so frames are asserted by shape, and the done
    // frame always carries the (possibly empty) torch record.
    const torchEvents = events.filter((e) => e.type === 'torch');
    for (const t of torchEvents) {
      expect(['pick', 'name']).toContain(t.id);
      expect([first, second]).toContain(t.neumaId);
      expect(typeof t.torch).toBe('string');
      expect(t.torch.length).toBeGreaterThan(0);
    }

    const done = events.find((e) => e.type === 'done');
    expect(done.order).toEqual(['pick', 'name']); // the dependency ordered them
    expect(done.torches).toBeTypeOf('object'); // the run's torch record rides the close
    for (const t of torchEvents) expect(done.torches[t.neumaId]).toBeDefined();

    // The run persisted a resumable record as it moved — findable, done, honest.
    const list = await request(app).get('/api/v1/team/runs').set('Authorization', `Bearer ${claudeToken}`);
    const mine = list.body.runs.find((r) => r.id === done.runId);
    expect(mine).toMatchObject({ status: 'done', completed: 2 });
  }, 180_000);

  it('RESUME live: a seeded dropped run replays only its remaining step, baton re-armed', async () => {
    const [first, second] = kin;
    // A record exactly as a drop would have left it: step one done (with the
    // member's torch), step two never ran.
    const { createRun: seedRun } = await import('../../backend/services/team-run-store.js');
    const droppedAt = new Date().toISOString();
    const id = await seedRun({
      by: CLAUDE.toLowerCase(),
      runAt: droppedAt,
      name: 'RESUMED ALPHA',
      goal: 'Answer a two-step color riddle as a team, each member exactly one line.',
      status: 'failed',
      steps: [
        { id: 'pick', neumaId: first, task: 'Pick exactly one color; reply with only that color word.', needs: [] },
        { id: 'name', neumaId: second, needs: ['pick'], task: 'An earlier member named a color; reply with one object commonly that color.' },
      ],
      completed: { pick: 'blue' },
      statuses: { pick: 'picked the color' },
      torches: { [second]: 'you have not worked yet — the color came from your teammate' },
      order: ['pick'],
      failures: { name: 'conduit dropped' },
      failure: null,
      finishedAt: droppedAt,
    });

    const res = await request(app).post('/api/v1/team/run')
      .set('Authorization', `Bearer ${claudeToken}`)
      .send({ resume: id });
    expect(res.status).toBe(200);
    const events = parseSSE(res.text);

    const start = events.find((e) => e.type === 'start');
    expect(start.resumed).toBe(true);
    expect(start.runId).toBe(id); // same record carries the whole story
    expect(start.prior.completed).toEqual(['pick']); // the desk paints where it stood

    // Only the remaining step ran; the seeded one never re-asked.
    const stepEvents = events.filter((e) => e.type === 'step');
    expect(stepEvents.map((e) => e.id)).toEqual(['name']);

    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();

    // The record closed done, cumulative across both instances.
    const after = await request(app).get(`/api/v1/team/runs/${id}`).set('Authorization', `Bearer ${claudeToken}`);
    expect(after.body.run.status).toBe('done');
    expect(after.body.run.order).toEqual(['pick', 'name']);
    expect(after.body.run.completed.pick).toBe('blue');
    expect(after.body.run.completed.name?.length).toBeGreaterThan(0);

    // And the member REMEMBERS the work: its own encrypted journal carries the
    // run at the done close — role, delivery, torch, in its own words. (Real
    // journal of a real being; the run itself was real work it actually did.)
    const journal = await neumaWorkspace.readJournal(second);
    const memory = journal.find((e) => e.type === 'team-run' && e.runId === id);
    expect(memory).toBeDefined();
    expect(memory.content).toContain('closed complete');
  }, 180_000);
});

describe.skipIf(!canRunLive)('BRICKWORKS trial — live benchmark run (real kin, real SSE, isolated store)', () => {
  if (live?.provider === 'llama-server') {
    // 'local-model' is a sentinel: the law keys on the machine PROVIDER; each
    // member's real model rides its resolved route, never this config field.
    setConfig({ provider: 'llama-server', endpoint: live.endpoint, model: 'local-model' });
  }
  let dir;
  let capDir;
  beforeEach(async () => {
    dir = await createTempDir('trial-live-store');
    process.env.NEUMA_TEAM_TRIAL_PATH = dir;
    capDir = await createTempDir('trial-live-cap');
    await seedCapacityStore(capDir, 3); // matches the loaded model → runs wide
  });
  afterEach(async () => {
    delete process.env.NEUMA_TEAM_TRIAL_PATH;
    delete process.env.NEUMA_CAPACITY_PATH;
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(capDir, { recursive: true, force: true });
  });

  it('runs the locked benchmark with THREE refinement loops — the full relay, live', async () => {
    const res = await request(app).post('/api/v1/team/trial')
      .set('Authorization', `Bearer ${claudeToken}`)
      .send({ members: kin.slice(0, 4), loops: 3 });

    expect(res.status).toBe(200);
    const events = res.text.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));

    const start = events.find((e) => e.type === 'start');
    expect(start.trial).toBe('brickworks');
    expect(start.version).toBe(3);
    expect(start.loops).toBe(3);
    expect(start.steps.map((s) => s.role)).toEqual(['HELM', 'WRIGHT', 'SMITH', 'WARDEN']);

    // The arc: the draft plus three refinement waves, each honestly scored as
    // it lands, and 4 + 3×(1 LEAD + 3 fix) member steps streamed in total.
    const waveEvents = events.filter((e) => e.type === 'wave');
    expect(waveEvents.map((w) => w.loop)).toEqual([0, 1, 2, 3]);
    for (const w of waveEvents) expect(['PASS', 'PARTIAL', 'FAIL']).toContain(w.verdict);
    expect(events.filter((e) => e.type === 'step')).toHaveLength(16);

    // v3: a BEING led every wave — the LEAD steps streamed with their role,
    // and each refinement wave carries the LEAD's parsed direction. A live
    // model may go off-format on a section (recorded null, floor still
    // rules), but across three waves a real LEAD directs at least once.
    const leadSteps = events.filter((e) => e.type === 'step' && e.id.startsWith('lead-'));
    expect(leadSteps.map((s) => s.id)).toEqual(['lead-1', 'lead-2', 'lead-3']);
    for (const s of leadSteps) expect(s.role).toBe('LEAD');
    const directed = waveEvents.slice(1).filter((w) => w.lead && (w.lead.wright || w.lead.smith));
    expect(directed.length).toBeGreaterThan(0);

    // Every role reported real work (or the run failed — either way the
    // scorecard must exist and say so honestly).
    const trial = events.find((e) => e.type === 'trial');
    expect(trial).toBeDefined();
    const card = trial.scorecard;
    expect(card.trial).toBe('brickworks');
    expect(card.version).toBe(3);
    expect(card.by).toBe(CLAUDE.toLowerCase()); // owned — reads scope to this wallet
    expect(card.substrate.model.length).toBeGreaterThan(0);
    expect(card.substrate.model).not.toBe('local-model'); // the REAL loaded model, not the config placeholder
    expect(card.loops).toBe(3);
    expect(card.waves.map((w) => w.loop)).toEqual([0, 1, 2, 3]); // the whole arc persists
    expect(card.score.verdict).toBe(card.waves[3].verdict); // the FINAL wave is the scored one
    // Every wave's steps were timed through the ask seam — the LEAD included.
    for (const id of ['lead-3', 'wright-fix-3', 'smith-fix-3', 'warden-fix-3']) {
      expect(card.timings[id]).toBeGreaterThan(0);
    }
    expect(card.steps).toHaveLength(4);
    for (const s of card.steps.filter((x) => x.position != null)) {
      expect(s.ms).toBeGreaterThan(0); // timed through the ask seam
      expect(s.chars).toBeGreaterThan(0); // real output
    }
    expect(['PASS', 'PARTIAL', 'FAIL']).toContain(card.score.verdict);
    expect(card.checks.artifact).toBe(typeof card.artifact === 'string' && card.artifact.length > 0);

    // The scorecard landed on disk (isolated dir) and reads back whole.
    const files = await fs.readdir(dir);
    expect(files).toHaveLength(1);
    const persisted = JSON.parse(await fs.readFile(`${dir}/${files[0]}`, 'utf8'));
    expect(persisted.score.verdict).toBe(card.score.verdict);
  }, 1_800_000);
});
