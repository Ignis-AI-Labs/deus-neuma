import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { startLocalProvider } from '../helpers/local-provider.js';

/**
 * Integration test for POST /api/v1/workspace/:id/sessions/autotitle.
 *
 * NOTHING IS MOCKED (#390 tranche 6). The express app, the workspace router
 * including its ownership guard, NeumaWorkspace on a temp root (real
 * AES-256-GCM session writes and reads), the witness's real label store in a
 * temp realm, a real HMAC session through the real requireAuth — and now the
 * conduit too: a REAL loopback OpenAI-compatible server that the real
 * llm-provider really connects to over a real socket, reached through the
 * lane's own real route and credential stores.
 *
 * What that buys over the old createStreamRequest/consumeStream stubs: the
 * request is really built, really serialised, really sent, and the SSE
 * response is really parsed back into a title. The old version asserted the
 * titler CALLED something; a broken body, a broken header, or broken stream
 * assembly all passed. The prompt assertion below now reads the body the
 * server actually received.
 *
 * Still not claimed here, and still true: no weights run. Real generation is
 * proven in the substrate-live lane, never inside the parallel suite.
 */

const N = 'titlertestneuma';
const TITLE = 'Ledger Reconciliation';

describe('Auto-title API (workspace routes)', () => {
  let app, workspace, labels, provider, witness, previousLlmConfig;

  const own = async (id, wallet = witness.address) => {
    await workspace.create(id);
    await fs.writeFile(
      path.join(workspace.root, id, 'owner.json'),
      JSON.stringify({ wallet, claimedAt: Date.now() }),
    );
  };

  const seedChat = async (sessionId, turns) => {
    await workspace.createSession(N, sessionId);
    for (const content of turns) {
      await workspace.appendMessage(N, sessionId, { role: 'user', content });
      await workspace.appendMessage(N, sessionId, { role: 'assistant', content: `About: ${content}` });
    }
  };

  const post = (id, body) => request(app).post(`/api/v1/workspace/${id}/sessions/autotitle`).set(witness.header).send(body);

  beforeEach(async () => {
    vi.resetModules();

    const core = await import('../../core/index.js');
    core.setWorkspacesRoot(await createTempDir(`ws-${Math.random().toString(36).slice(2)}`));
    workspace = core.neumaWorkspace;

    // The titler now resolves each lane's OWN route before naming (Part 3,
    // two-lights-two-routes) — that resolution reads the credential + route
    // stores. Isolate both behind their env doors so the test never touches
    // the operator's real files (an unreadable real store reads as
    // "route unavailable" and every chat skips).
    const storeDir = await createTempDir(`stores-${Math.random().toString(36).slice(2)}`);
    process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = `${storeDir}/provider-credentials.json`;
    process.env.NEUMA_ROUTES_PATH = `${storeDir}/neuma-routes.json`;

    const realm = await import('../../backend/services/user-realm.js');
    realm.setRealmRoot(await createTempDir(`realm-${Math.random().toString(36).slice(2)}`));
    labels = await import('../../backend/services/user-chat-labels.js');

    // A REAL provider on loopback, reached the way a neuma really reaches
    // one: the house's SOVEREIGN machine route. A neuma may not be routed
    // through a custom/third-party door at all — neuma-routes-store refuses
    // it at the write seam and neuma-route-resolver drops it at call time
    // (docs/protocols/sovereignty-boundary.md). The old llm-provider mock hid
    // that law completely; reaching for `custom` here is what surfaced it.
    provider = await startLocalProvider({ reply: TITLE });
    const llm = await import('../../backend/services/llm-provider.js');
    previousLlmConfig = llm.getConfig();
    llm.setConfig({
      provider: 'lm-studio', endpoint: provider.endpoint, model: 'test-model', apiKey: '',
    });

    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against.
    const { strangerWitness } = await import('../helpers/witness.js');
    // Ownership here is claimed explicitly per-test via own(id, wallet) —
    // the witness itself claims nothing until a test calls it.
    witness = strangerWitness();

    const { default: router } = await import('../../backend/routes/workspace-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/workspace', router);
  });

  afterEach(async () => {
    delete process.env.NEUMA_PROVIDER_CREDENTIALS_PATH;
    delete process.env.NEUMA_ROUTES_PATH;
    if (provider) await provider.close();
    provider = null;
    if (previousLlmConfig) {
      const llm = await import('../../backend/services/llm-provider.js');
      llm.setConfig(previousLlmConfig);
    }
    vi.restoreAllMocks();
  });

  test('batch names untitled one-on-one chats; council and already-named chats are left alone', async () => {
    await own(N);
    await seedChat('session-1000000000001', ['reconciling the ledger']);
    await seedChat('session-1000000000002', ['already named chat']);
    await seedChat('council-1000000000003', ['the room deliberates']);
    await labels.setChatLabel(witness.address, N, 'session-1000000000002', 'Kept Name');

    const res = await post(N, {});
    expect(res.status).toBe(200);

    const byId = Object.fromEntries(res.body.results.map((r) => [r.sessionId, r]));
    expect(byId['session-1000000000001']).toMatchObject({ status: 'titled', label: TITLE });
    expect(byId['session-1000000000002']).toBeUndefined();
    expect(byId['council-1000000000003']).toBeUndefined();

    expect(res.body.labels[`${N}:session-1000000000001`]).toBe(TITLE);
    expect(res.body.labels[`${N}:session-1000000000002`]).toBe('Kept Name');
    expect(res.body.labels[`${N}:council-1000000000003`]).toBeUndefined();
  });

  test('the conduit really RECEIVES the chat’s decrypted speech over the wire', async () => {
    await own(N);
    await seedChat('session-1000000000011', ['reconciling the ledger']);
    const res = await post(N, {});
    expect(res.status).toBe(200);

    // Read off the body the server actually got — not off a spy's argument
    // list. A request that never serialised, or never left, fails here.
    expect(provider.turns).toHaveLength(1);
    const sent = provider.turns[0].messages;
    expect(sent[0].role).toBe('system');
    expect(sent[1].content).toContain('reconciling the ledger');
  });

  test('force retitles chats that already carry a name', async () => {
    await own(N);
    await seedChat('session-1000000000021', ['renamed by force']);
    await labels.setChatLabel(witness.address, N, 'session-1000000000021', 'Old Name');

    const res = await post(N, { force: true });
    expect(res.status).toBe(200);
    expect(res.body.labels[`${N}:session-1000000000021`]).toBe(TITLE);
  });

  test('explicit sessionIds name exactly those chats', async () => {
    await own(N);
    await seedChat('session-1000000000031', ['first chat']);
    await seedChat('session-1000000000032', ['second chat']);

    const res = await post(N, { sessionIds: ['session-1000000000032'], force: true });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ sessionId: 'session-1000000000032', status: 'titled' });
    expect(res.body.labels[`${N}:session-1000000000031`]).toBeUndefined();
  });

  test('a chat with no speech is skipped, not failed', async () => {
    await own(N);
    await workspace.createSession(N, 'session-1000000000041');

    const res = await post(N, {});
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ sessionId: 'session-1000000000041', status: 'skipped' });
    expect(res.body.labels[`${N}:session-1000000000041`]).toBeUndefined();
  });

  test('a malformed sessionId is refused (400)', async () => {
    await own(N);
    const res = await post(N, { sessionIds: ['../evil'] });
    expect(res.status).toBe(400);
  });

  test('a non-array sessionIds is refused (400)', async () => {
    await own(N);
    const res = await post(N, { sessionIds: 'session-1000000000041' });
    expect(res.status).toBe(400);
  });

  test('another wallet’s workspace is refused (403)', async () => {
    await own(N, '0x9999999999999999999999999999999999999999');
    const res = await post(N, {});
    expect(res.status).toBe(403);
  });
});
