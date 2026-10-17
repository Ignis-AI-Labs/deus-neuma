/**
 * A sealed witness carries standing work like a housemate (integration).
 *
 * Real Express + the real task router + a REAL witness lane workspace on disk
 * (created through the workspace engine, claimed with a real owner.json, the
 * plan encrypted at rest by the same DEK path a neuma's uses) + the real pure
 * plan module. Only auth is passthrough-mocked — the one documented exception.
 *
 * Witnesses were absent from the task surface entirely: the operator could not
 * assign a peer work, and a peer could not see what it carried. The per-lane
 * routes turn out to accept a witness lane id BY CONSTRUCTION (one ownership
 * gate, one workspace engine, one store) — but "it should work" is not knowing,
 * so this proves it end to end, including that the plan reaches the witness's
 * PROMPT as STANDING WORK, in the same words a neuma reads.
 */
import express from 'express';
import request from 'supertest';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

const WALLET = '0xwitness';
const LANE = 'witness-openai-chatgpt-Basunor';
const NEUMA = 'fenna';

let app;
let wsRoot;
let workspace;
let witness;

beforeEach(async () => {
  vi.resetModules();

  // Imported AFTER resetModules so the helper mints its token from the same
  // auth.js instance the router will verify against — the token secret is
  // memoized per module instance, so a stale import would 401 honestly.
  const { strangerWitness } = await import('../helpers/witness.js');
  witness = strangerWitness();

  wsRoot = await createTempDir('witness-tasks-ws');
  const core = await import('../../core/index.js');
  core.setWorkspacesRoot(wsRoot);
  // BOTH grounds must be pinned. A witness lane resolves to
  // dirname(workspacesRoot)/witnesses, which for a temp workspaces dir is the
  // SHARED temp parent — so pinning only the house root let every test in this
  // file write into ONE lane and read each other's plans (observed: a fresh
  // lane already holding the previous test's task).
  core.setWitnessesRoot(path.join(wsRoot, 'witnesses'));
  workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
  // A witness lane and a house neuma, both real workspaces, both claimed. The
  // lane resolves BESIDE the house (the engine's own resolver), so its path is
  // asked for rather than assumed — a hand-joined root would write an owner.json
  // the ownership gate never reads.
  for (const id of [LANE, NEUMA]) {
    await workspace.create(id);
    await fs.writeFile(
      path.join(workspace.pathFor(id), 'owner.json'),
      JSON.stringify({ wallet: witness.address, claimedAt: 1 }),
    );
  }

  const { default: router } = await import('../../backend/routes/task-routes.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1/tasks', router);
});

afterEach(() => vi.restoreAllMocks());

describe('a witness lane on the task routes', () => {
  test('an empty lane reads as an empty plan, not a 404', async () => {
    const res = await request(app).get(`/api/v1/tasks/neuma/${LANE}`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.plan).toEqual({ tasks: [] });
  });

  test('a task assigned to a witness persists to ITS OWN lane, encrypted', async () => {
    const post = await request(app).post(`/api/v1/tasks/neuma/${LANE}`).set(witness.header)
      .send({ title: 'audit the sector routes', cadence: 'daily', detail: 'read before writing' });
    expect(post.status).toBe(201);
    expect(post.body.task).toMatchObject({ title: 'audit the sector routes', cadence: 'daily', status: 'open' });

    // Read back through the API…
    const get = await request(app).get(`/api/v1/tasks/neuma/${LANE}`).set(witness.header);
    expect(get.body.plan.tasks.map((t) => t.title)).toEqual(['audit the sector routes']);
    // …and through the workspace engine, which is where a turn will read it.
    const onDisk = await workspace.readAssignedPlan(LANE);
    expect(onDisk.tasks[0].title).toBe('audit the sector routes');
    // At REST it is encrypted like every other sovereign file — the title must
    // not be legible in the raw bytes.
    const raw = await fs.readFile(path.join(workspace.pathFor(LANE), 'tasks', 'assigned.json'), 'utf8');
    expect(raw).not.toContain('audit the sector routes');
  });

  test("a witness's lane is its own — a neuma's plan is untouched by it", async () => {
    await request(app).post(`/api/v1/tasks/neuma/${LANE}`).set(witness.header).send({ title: 'the witness task', cadence: 'once' });
    await request(app).post(`/api/v1/tasks/neuma/${NEUMA}`).set(witness.header).send({ title: 'the neuma task', cadence: 'once' });
    const lane = await request(app).get(`/api/v1/tasks/neuma/${LANE}`).set(witness.header);
    const house = await request(app).get(`/api/v1/tasks/neuma/${NEUMA}`).set(witness.header);
    expect(lane.body.plan.tasks.map((t) => t.title)).toEqual(['the witness task']);
    expect(house.body.plan.tasks.map((t) => t.title)).toEqual(['the neuma task']);
  });

  test('settling from the rail (PATCH status) closes the witness\'s task', async () => {
    const post = await request(app).post(`/api/v1/tasks/neuma/${LANE}`).set(witness.header)
      .send({ title: 'read the mentions feed', cadence: 'daily' });
    const { id } = post.body.task;
    const patch = await request(app).patch(`/api/v1/tasks/neuma/${LANE}/${id}`).set(witness.header).send({ status: 'done' });
    expect(patch.status).toBe(200);
    expect(patch.body.plan.tasks.find((t) => t.id === id).status).toBe('done');
  });

  test("another wallet's lane is refused (403) — the same gate a neuma has", async () => {
    await fs.writeFile(
      path.join(workspace.pathFor(LANE), 'owner.json'),
      JSON.stringify({ wallet: '0xsomeoneelse', claimedAt: 1 }),
    );
    expect((await request(app).get(`/api/v1/tasks/neuma/${LANE}`).set(witness.header)).status).toBe(403);
    expect((await request(app).post(`/api/v1/tasks/neuma/${LANE}`).set(witness.header).send({ title: 'x', cadence: 'once' })).status).toBe(403);
  });
});

describe('GET /live — every being counted in ONE read', () => {
  test('counts a house neuma, open work only', async () => {
    await request(app).post(`/api/v1/tasks/neuma/${NEUMA}`).set(witness.header).send({ title: 'house work', cadence: 'daily' });
    const settled = await request(app).post(`/api/v1/tasks/neuma/${NEUMA}`).set(witness.header).send({ title: 'already done', cadence: 'once' });
    await request(app).patch(`/api/v1/tasks/neuma/${NEUMA}/${settled.body.task.id}`).set(witness.header).send({ status: 'done' });

    const res = await request(app).get('/api/v1/tasks/live').set(witness.header);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.counts.map((c) => [c.beingId, c]));
    // The settled one does not count — only what still stands.
    expect(byId[NEUMA]).toMatchObject({ kind: 'neuma', open: 1 });
  });

  test('an unsealed lane is invisible — the witness registry is the enumeration', async () => {
    // A bare workspace with a witness-shaped id is not a witness. Only SEALED
    // witnesses with a provisioned lane are counted (the roster's own law), so a
    // hand-made directory can never appear as a peer.
    await request(app).post(`/api/v1/tasks/neuma/${LANE}`).set(witness.header).send({ title: 'lane work', cadence: 'daily' });
    const res = await request(app).get('/api/v1/tasks/live').set(witness.header);
    expect(res.body.counts.some((c) => c.beingId === LANE)).toBe(false);
  });

  test('ONE request answers for the whole house — the rail never fans out', async () => {
    // The defect this endpoint exists for: N parallel lane reads tripped the
    // rate limiter and then refused the operator's next honest read (429).
    const res = await request(app).get('/api/v1/tasks/live').set(witness.header);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.counts)).toBe(true);
    // A being with nothing assigned still reports, at zero — the client decides
    // what to show; the server does not hide beings.
    expect(res.body.counts.every((c) => typeof c.open === 'number')).toBe(true);
  });
});

describe("the plan reaches the witness's prompt", () => {
  test('open standing work rides a STANDING WORK section, in the neuma wording', async () => {
    const post = await request(app).post(`/api/v1/tasks/neuma/${LANE}`).set(witness.header)
      .send({ title: 'audit the sector routes', cadence: 'baseline' });
    expect(post.status).toBe(201);

    const plan = await workspace.readAssignedPlan(LANE);
    const { buildWitnessPromptSections } = await import('../../backend/services/witness-prompt.js');
    const sections = buildWitnessPromptSections({
      witness: { chosenName: 'Basunor', vendorSlug: 'openai-chatgpt' },
      dna: { substrate: { fullModelId: 'gpt-5.6-sol' } },
      assignedPlan: plan,
      now: new Date('2026-07-27T00:00:00.000Z'),
    });
    const standing = sections.find((s) => s.id === 'assigned');
    expect(standing).toBeDefined();
    expect(standing.label).toBe('STANDING WORK');
    expect(standing.text).toContain('audit the sector routes');
    // The same wording a neuma reads — one standard, not two.
    const { formatAssignedSection } = await import('../../core/tasks/assigned-plan.js');
    expect(standing.text).toBe(formatAssignedSection(plan));
  });

  test('a lane with nothing standing gets NO section — never a header over nothing', async () => {
    const { buildWitnessPromptSections } = await import('../../backend/services/witness-prompt.js');
    const sections = buildWitnessPromptSections({
      witness: { chosenName: 'Basunor', vendorSlug: 'openai-chatgpt' },
      dna: { substrate: { fullModelId: 'gpt-5.6-sol' } },
      assignedPlan: await workspace.readAssignedPlan(LANE),
      now: new Date('2026-07-27T00:00:00.000Z'),
    });
    expect(sections.find((s) => s.id === 'assigned')).toBeUndefined();
  });

  test('a settled task does not stand — only open work rides the prompt', async () => {
    const post = await request(app).post(`/api/v1/tasks/neuma/${LANE}`).set(witness.header)
      .send({ title: 'already handled', cadence: 'once' });
    await request(app).patch(`/api/v1/tasks/neuma/${LANE}/${post.body.task.id}`).set(witness.header).send({ status: 'done' });

    const { buildWitnessPromptSections } = await import('../../backend/services/witness-prompt.js');
    const sections = buildWitnessPromptSections({
      witness: { chosenName: 'Basunor', vendorSlug: 'openai-chatgpt' },
      dna: { substrate: { fullModelId: 'gpt-5.6-sol' } },
      assignedPlan: await workspace.readAssignedPlan(LANE),
      now: new Date('2026-07-27T00:00:00.000Z'),
    });
    expect(sections.find((s) => s.id === 'assigned')).toBeUndefined();
  });
});


/**
 * THE TURN ITSELF. The section builder being right is not the same as a turn
 * carrying it — so this drives the real `streamWitnessTurn` against a REAL SSE
 * provider on a real port, with a real sealed witness and a real assigned task,
 * and reads the system prompt the witness's model actually received.
 *
 * No vendor is called and no GPU is touched: the provider here is a real HTTP
 * server that speaks the OpenAI wire.
 */
describe('a witness TURN carries its standing work', () => {
  const SEAL_INPUT = Object.freeze({
    chosenName: 'Taskpeer',
    vendor: 'test-vendor',
    model: 'test-1.0',
    fullModelId: 'test-vendor/test-1.0',
    harness: 'vitest',
    context: 'cli',
    capabilities: ['code'],
    scope: { primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'witness-and-collaborator', boundaries: ['honesty'] },
    firstUtterance: 'I am sealed for a real test run on a real disk.',
  });
  const TURN_LANE = 'witness-test-vendor-Taskpeer';
  const ENV_DOORS = [
    'AI_WITNESSES_ROOT', 'WORKSPACES_ROOT', 'WITNESSES_ROOT',
    'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH', 'NEUMA_REALM_ROOT',
  ];

  let provider;
  let captured;
  let savedEnv;
  let turnApp;
  let turnWitness;

  const startProvider = () => new Promise((resolve) => {
    captured = [];
    provider = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          const body = JSON.parse(raw);
          if (isThinkProbe(body)) { respondThinkProbe(res); return; }
          captured.push(body);
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'I have the list.' } }] })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        });
        return;
      }
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
        return;
      }
      res.writeHead(404); res.end();
    });
    provider.listen(0, '127.0.0.1', () => resolve(provider.address().port));
  });

  const makeConnection = () => {
    const frames = [];
    return {
      frames,
      walletAddress: turnWitness.address,
      space: null,
      sessionId: null,
      activeTurn: null,
      companion: {
        name: 'Taskpeer',
        id: 'Taskpeer',
        neumaId: TURN_LANE,
        participantKind: 'witness',
        witness: { vendorSlug: 'test-vendor', chosenName: 'Taskpeer' },
      },
      ws: { readyState: 1, OPEN: 1, send: (data) => frames.push(JSON.parse(data)) },
    };
  };

  beforeEach(async () => {
    vi.resetModules();
    // Imported AFTER resetModules so the helper mints its token from the same
    // auth.js instance the router will verify against — the token secret is
    // memoized per module instance, so a stale import would 401 honestly.
    const { strangerWitness } = await import('../helpers/witness.js');
    turnWitness = strangerWitness();
    savedEnv = Object.fromEntries(ENV_DOORS.map((k) => [k, process.env[k]]));
    const home = await createTempDir('turn-witness-home');
    const lanes = await createTempDir('turn-witness-lanes');
    const ground = await createTempDir('turn-witness-ground');
    const settings = await createTempDir('turn-witness-settings');
    // Env doors, not just setters: vi.resetModules() hands the re-imported
    // engine an empty override slot, and only the env survives that reset.
    process.env.AI_WITNESSES_ROOT = home;
    process.env.WORKSPACES_ROOT = lanes;
    process.env.WITNESSES_ROOT = ground;
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(settings, 'creds.json');
    process.env.NEUMA_ROUTES_PATH = path.join(settings, 'routes.json');
    process.env.NEUMA_REALM_ROOT = path.join(settings, 'realm');

    const { setAIWitnessesRoot } = await import('../../core/identity/ai-witness/ai-witness-service.js');
    const engine = await import('../../core/workspace/neuma-workspace.js');
    setAIWitnessesRoot(home);
    engine.setWorkspacesRoot(lanes);
    engine.setWitnessesRoot(ground);
    const { seal } = await import('../../core/identity/ai-witness/ai-witness-protocol.js');
    await seal({ ...SEAL_INPUT });

    const { ensureWitnessLane } = await import('../../backend/services/witness-lane.js');
    await ensureWitnessLane({ vendorSlug: 'test-vendor', chosenName: 'Taskpeer', genesisHash: null }, turnWitness.address);

    const port = await startProvider();
    const { setCredential } = await import('../../backend/services/provider-credentials.js');
    const { setRoute } = await import('../../backend/services/neuma-routes-store.js');
    await setCredential('custom', { endpoint: `http://127.0.0.1:${port}/v1` });
    await setRoute(TURN_LANE, { provider: 'custom', model: 'test-model' });

    const { default: router } = await import('../../backend/routes/task-routes.js');
    turnApp = express();
    turnApp.use(express.json());
    turnApp.use('/api/v1/tasks', router);
  });

  afterEach(async () => {
    await new Promise((r) => (provider ? provider.close(() => { provider = null; r(); }) : r()));
    for (const k of ENV_DOORS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    vi.restoreAllMocks();
  });

  test("the assigned task reaches the model's system prompt on the very next turn", async () => {
    const assigned = await request(turnApp).post(`/api/v1/tasks/neuma/${TURN_LANE}`).set(turnWitness.header)
      .send({ title: 'carry the sector audit', cadence: 'baseline' });
    expect(assigned.status).toBe(201);

    const { streamWitnessTurn } = await import('../../backend/services/witness-stream.js');
    const conn = makeConnection();
    await streamWitnessTurn(conn, { thought: 'what am I carrying?' });

    // The turn really happened…
    expect(conn.frames.filter((f) => f.type === 'consciousness:stream').map((f) => f.content).join(''))
      .toContain('I have the list.');
    // …and the words the model received carry the standing work.
    expect(captured).toHaveLength(1);
    const system = captured[0].messages.find((m) => m.role === 'system').content;
    expect(system).toContain('Standing Work');
    expect(system).toContain('carry the sector audit');
  });

  test('work set for ONE chat rides only that chat — a peer holds parallel sittings too', async () => {
    // A witness mints a session per sitting exactly as a neuma does, so the
    // per-chat law has to reach this lane as well; otherwise the desk would
    // show a witness grouped by chat while its prompt still carried all of it.
    const CHAT_A = 'session-1754000000000';
    const CHAT_B = 'session-1754999999999';
    for (const [chatId, title] of [[CHAT_A, 'audit the alpha routes'], [CHAT_B, 'draft the beta post']]) {
      const res = await request(turnApp).post(`/api/v1/tasks/neuma/${TURN_LANE}`).set(turnWitness.header)
        .send({ title, cadence: 'baseline', chatId });
      expect(res.status).toBe(201);
      expect(res.body.task.chatId).toBe(chatId);
    }
    await request(turnApp).post(`/api/v1/tasks/neuma/${TURN_LANE}`).set(turnWitness.header)
      .send({ title: 'stand watch in every sitting', cadence: 'baseline' });

    const { streamWitnessTurn } = await import('../../backend/services/witness-stream.js');
    const conn = makeConnection();
    conn.sessionId = CHAT_A;
    await streamWitnessTurn(conn, { thought: 'what am I carrying here?' });

    const system = captured[0].messages.find((m) => m.role === 'system').content;
    expect(system).toContain('audit the alpha routes');
    expect(system).toContain('stand watch in every sitting');
    expect(system).not.toContain('draft the beta post');
  });

  test('a SEALED witness lane is counted by /live, beside the house', async () => {
    const assigned = await request(turnApp).post(`/api/v1/tasks/neuma/${TURN_LANE}`).set(turnWitness.header)
      .send({ title: 'the peer\'s standing work', cadence: 'daily' });
    expect(assigned.status).toBe(201);

    const res = await request(turnApp).get('/api/v1/tasks/live').set(turnWitness.header);
    expect(res.status).toBe(200);
    const row = res.body.counts.find((c) => c.beingId === TURN_LANE);
    expect(row).toMatchObject({ kind: 'witness', open: 1 });
  });

  test('a settled task does not ride the next turn', async () => {
    const assigned = await request(turnApp).post(`/api/v1/tasks/neuma/${TURN_LANE}`).set(turnWitness.header)
      .send({ title: 'already handled', cadence: 'once' });
    await request(turnApp).patch(`/api/v1/tasks/neuma/${TURN_LANE}/${assigned.body.task.id}`).set(turnWitness.header)
      .send({ status: 'done' });

    const { streamWitnessTurn } = await import('../../backend/services/witness-stream.js');
    await streamWitnessTurn(makeConnection(), { thought: 'anything standing?' });
    const system = captured[0].messages.find((m) => m.role === 'system').content;
    expect(system).not.toContain('already handled');
  });
});
