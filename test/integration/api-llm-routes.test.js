/**
 * LLM API routes — on the real config, real capabilities, real sockets
 * (#390 tranche 6). SSRF tests live separately in api-llm-ssrf.test.js.
 *
 * This file carried FIVE mocks, and three of them were mocks of things that
 * do not even do I/O:
 *
 *   - `model-capabilities.js` is a pure lookup table. It was replaced by a
 *     hand-written table, so `contextWindow: 8192, family: 'llama'` was the
 *     test agreeing with itself. The real table says claude-opus-4-6 is
 *     200k/anthropic and an unknown model is 4096/unknown — facts the mock
 *     could have contradicted forever without anyone noticing.
 *   - `backend/config.js` was mocked to return 0.8 / 4096 / 0.95. Those ARE
 *     the real zod defaults; calling the real `loadConfig()` gives them, and
 *     also proves the defaults have not drifted.
 *   - `substrate-detector.js` reads this machine's own hardware. It is a
 *     read-only probe with nothing to isolate.
 *
 * The two that touch the network — `LMStudioClient` and `llm-provider` — now
 * point at REAL loopback servers through the module's own `LM_STUDIO_URL`
 * door. Connected, disconnected and error are produced by real sockets: a
 * real server, a really-closed port, and a server that really destroys the
 * connection mid-response.
 *
 * Covers: /lm-studio/config, /llm/models, /llm/provider, /substrate,
 * /llm/capabilities.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import http from 'http';
import { startLocalProvider, closedProviderEndpoint } from '../helpers/local-provider.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const MODEL = 'test-model';

let savedEnv;

/** Build the router fresh against whatever LM_STUDIO_URL currently says. */
const buildApp = async () => {
  vi.resetModules();
  const { loadConfig } = await import('../../backend/config.js');
  loadConfig({ ...process.env });

  // Minted AFTER resetModules so the token comes from the same auth.js
  // instance the router verifies against (the HMAC secret is memoized per
  // module instance; a stale import 401s honestly).
  const { strangerWitness } = await import('../helpers/witness.js');
  const witness = strangerWitness();
  // A fresh install's first owner is seated by the owner claim, never by a first request (owner-claim.js): seated here.
  await makeInstallOwner(witness.address);

  const { default: router } = await import('../../backend/routes/llm-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1', router);
  return { app, witness };
};

beforeAll(() => {
  savedEnv = { LM_STUDIO_URL: process.env.LM_STUDIO_URL, SUBSTRATE_MODEL: process.env.SUBSTRATE_MODEL };
});

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// --- GET /lm-studio/config ---

describe('GET /lm-studio/config', () => {
  let provider;

  afterEach(async () => {
    if (provider) await provider.close();
    provider = null;
  });

  test('connected: reports the model the server really serves', async () => {
    provider = await startLocalProvider({ models: [MODEL] });
    process.env.LM_STUDIO_URL = provider.endpoint;

    const { app, witness } = await buildApp();
    const res = await request(app).get('/api/v1/lm-studio/config').set(witness.header);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('connected');
    expect(res.body.model).toBe(MODEL);
    expect(res.body.endpoint).toBe(`${provider.endpoint}/v1/chat/completions`);
    expect(res.body.contextLength).toBeDefined();
    // The real zod defaults from the real config — and a guard against drift.
    expect(res.body.temperature).toBe(0.8);
    expect(res.body.maxTokens).toBe(4096);
    expect(res.body.topP).toBe(0.95);
    expect(res.body.capabilities).toBeDefined();
    expect(res.body.modelDetails).toBeDefined();
    // The model list was really fetched over the wire.
    expect(provider.hits.some((h) => h.method === 'GET' && h.url.includes('/models'))).toBe(true);
  });

  test('disconnected: a really-closed port', async () => {
    const { endpoint } = await closedProviderEndpoint();
    process.env.LM_STUDIO_URL = endpoint;

    const { app, witness } = await buildApp();
    const res = await request(app).get('/api/v1/lm-studio/config').set(witness.header);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('disconnected');
    expect(res.body.model).toBe('Not Connected');
    expect(res.body.error).toBeDefined();
    expect(res.body.instructions).toBeDefined();
  });

  test('a server that answers with nonsense is disconnected, not connected', async () => {
    // Something IS listening and returns 200 — but not a model list. The
    // route must not read that as a healthy conduit. A stubbed client that
    // returns `true` from testConnection cannot express this case at all.
    const rude = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>not an llm</html>');
    });
    await new Promise((r) => rude.listen(0, '127.0.0.1', r));
    process.env.LM_STUDIO_URL = `http://127.0.0.1:${rude.address().port}`;

    const { app, witness } = await buildApp();
    const res = await request(app).get('/api/v1/lm-studio/config').set(witness.header);

    expect(res.status).toBe(200);
    expect(res.body.status).not.toBe('connected');
    await new Promise((r) => rude.close(r));
  });
});

// --- POST /llm/models ---

describe('POST /llm/models', () => {
  let provider, app, witness;

  beforeEach(async () => {
    provider = await startLocalProvider({ models: ['model-1', MODEL] });
    process.env.LM_STUDIO_URL = provider.endpoint;
    ({ app, witness } = await buildApp());
  });

  afterEach(async () => { await provider.close(); });

  test('lm-studio models come from the server that really answered', async () => {
    const res = await request(app).post('/api/v1/llm/models').set(witness.header)
      .send({ provider: 'lm-studio', endpoint: provider.endpoint });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.models.map((m) => m.id)).toEqual(expect.arrayContaining(['model-1', MODEL]));
    expect(res.body.models[0]).toHaveProperty('context_length');
    expect(res.body.models[0]).toHaveProperty('capabilities');
  });

  test('openai returns the real static catalog', async () => {
    const res = await request(app).post('/api/v1/llm/models').set(witness.header)
      .send({ provider: 'openai' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const gpt4 = res.body.models.find((m) => m.id === 'gpt-4');
    expect(gpt4).toBeDefined();
    expect(gpt4.context_length).toBe(8192);
  });

  test('anthropic returns the real static catalog', async () => {
    const res = await request(app).post('/api/v1/llm/models').set(witness.header)
      .send({ provider: 'anthropic' });

    expect(res.status).toBe(200);
    expect(res.body.models.find((m) => m.id === 'claude-opus-4-6')).toBeDefined();
  });

  test('custom has no catalog to offer', async () => {
    const res = await request(app).post('/api/v1/llm/models').set(witness.header)
      .send({ provider: 'custom' });
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([]);
  });
});

// --- GET / PUT /llm/provider ---

describe('/llm/provider', () => {
  let provider, app, witness, llm, previousConfig;

  beforeEach(async () => {
    provider = await startLocalProvider({ models: [MODEL] });
    process.env.LM_STUDIO_URL = provider.endpoint;
    ({ app, witness } = await buildApp());

    llm = await import('../../backend/services/llm-provider.js');
    previousConfig = llm.getConfig();
    llm.setConfig({
      provider: 'lm-studio', endpoint: provider.endpoint, apiKey: 'sk-test', model: MODEL,
    });
  });

  afterEach(async () => {
    llm.setConfig(previousConfig);
    await provider.close();
  });

  test('GET reports a really-reachable provider, with the key masked', async () => {
    const res = await request(app).get('/api/v1/llm/provider').set(witness.header);

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('lm-studio');
    expect(res.body.endpoint).toBe(provider.endpoint);
    expect(res.body.apiKey).toBe('***');
    expect(res.body.status).toBe('connected');
    expect(res.body.activeModel).toBe(MODEL);
    // Masking is not cosmetic — the real key must not appear anywhere.
    expect(JSON.stringify(res.body)).not.toContain('sk-test');
  });

  test('the status snapshot shares ONE probe pair across callers within the TTL (D1)', async () => {
    // First GET: the snapshot really probes (testConnection + getActiveModel
    // = the upstream's two GET /models).
    const first = await request(app).get('/api/v1/llm/provider').set(witness.header);
    expect(first.body.status).toBe('connected');
    const upstreamProbePairs = provider.hits.filter((h) => h.method === 'GET').length;
    expect(upstreamProbePairs).toBe(2);
    // A second caller inside the TTL — the SECOND SITTING's status light, in
    // production — costs the upstream NOTHING: it reads the snapshot.
    const second = await request(app).get('/api/v1/llm/provider').set(witness.header);
    expect(second.body.status).toBe('connected');
    expect(second.body.activeModel).toBe(MODEL);
    expect(provider.hits.filter((h) => h.method === 'GET').length).toBe(upstreamProbePairs);
  });

  test('a cached reading cannot survive a provider configuration change', async () => {
    const first = await request(app).get('/api/v1/llm/provider').set(witness.header);
    expect(first.body.status).toBe('connected');
    const { endpoint } = await closedProviderEndpoint();
    llm.setConfig({ endpoint, model: 'changed-model' });
    const next = await request(app).get('/api/v1/llm/provider').set(witness.header);
    expect(next.body.endpoint).toBe(endpoint);
    expect(next.body.status).toBe('disconnected');
    expect(next.body.activeModel).toBeNull();
  });

  test('GET reports disconnected when the provider is really down', async () => {
    const { endpoint } = await closedProviderEndpoint();
    llm.setConfig({ provider: 'lm-studio', endpoint, apiKey: '', model: MODEL });

    const res = await request(app).get('/api/v1/llm/provider').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('disconnected');
    expect(res.body.activeModel).toBeNull();
  });

  test('GET returns an empty apiKey when none is set', async () => {
    llm.setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, apiKey: '', model: MODEL });
    const res = await request(app).get('/api/v1/llm/provider').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.apiKey).toBe('');
  });

  test('PUT really changes the config the next GET reads', async () => {
    // The old test asserted `setConfig` was CALLED. That proves the route
    // reached a spy. This proves the change took: write it, then read it
    // back through a second real request.
    const put = await request(app).put('/api/v1/llm/provider').set(witness.header)
      .send({ provider: 'openai', endpoint: 'https://api.openai.com', apiKey: 'sk-new' });

    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);

    expect(llm.getConfig()).toMatchObject({
      provider: 'openai', endpoint: 'https://api.openai.com', apiKey: 'sk-new',
    });
    const get = await request(app).get('/api/v1/llm/provider').set(witness.header);
    expect(get.body.provider).toBe('openai');
    expect(get.body.apiKey).toBe('***');
  });
});

// --- GET /substrate ---

describe('GET /substrate', () => {
  test('reports THIS machine\'s real hardware profile', async () => {
    // The detector is a read-only probe of the host — nothing to isolate.
    //
    // And the old mock was WRONG ABOUT THE SHAPE, not merely about values:
    // it returned `{cpu: 'test-cpu', gpu: 'none', ram: '16GB', platform:
    // 'linux'}` — four flat strings, including a `ram` key the detector has
    // never had. The real profile is structured, and memory lives at
    // `memory.totalGB`. Anything built against `substrate.ram` renders
    // undefined against the real server while this suite stays green. Same
    // failure mode as the listSessions/getDNAHistory fakes in the workspace
    // routes: a mock encodes a belief about your system and certifies it.
    const { app, witness } = await buildApp();
    const res = await request(app).get('/api/v1/substrate').set(witness.header);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { substrate } = res.body;
    expect(substrate.platform.os).toBe(process.platform);
    expect(typeof substrate.platform.hostname).toBe('string');
    expect(typeof substrate.cpu.model).toBe('string');
    expect(substrate.cpu.cores).toBeGreaterThan(0);
    expect(substrate.cpu.arch).toBe(process.arch);
    expect(substrate.memory.totalGB).toBeGreaterThan(0);
    expect(substrate).not.toHaveProperty('ram');
    // gpu is an object when one is present and null when none is — never
    // the string 'none' the mock invented.
    expect(substrate.gpu === null || typeof substrate.gpu === 'object').toBe(true);
  });
});

// --- GET /llm/capabilities ---

describe('GET /llm/capabilities', () => {
  let provider, app, witness;

  beforeEach(async () => {
    provider = await startLocalProvider({ models: [MODEL] });
    process.env.LM_STUDIO_URL = provider.endpoint;
    ({ app, witness } = await buildApp());
  });

  afterEach(async () => { await provider.close(); });

  test('the real table answers for a model it really knows', async () => {
    const res = await request(app)
      .get('/api/v1/llm/capabilities?model=claude-opus-4-6').set(witness.header);

    expect(res.status).toBe(200);
    expect(res.body.model).toBe('claude-opus-4-6');
    // Read off the real registry, not off a table the test wrote.
    expect(res.body.contextWindow).toBe(200000);
    expect(res.body.family).toBe('anthropic');
    expect(res.body.vision).toBe(true);
    expect(res.body.tools).toBe(true);
  });

  test('an unknown model gets the real conservative fallback', async () => {
    const res = await request(app)
      .get('/api/v1/llm/capabilities?model=not-a-real-model-at-all').set(witness.header);

    expect(res.status).toBe(200);
    expect(res.body.contextWindow).toBe(4096);
    expect(res.body.family).toBe('unknown');
    expect(res.body.tools).toBe(false);
    expect(res.body.vision).toBe(false);
  });

  test('with no ?model it describes the active conduit', async () => {
    const res = await request(app).get('/api/v1/llm/capabilities').set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('contextWindow');
    expect(res.body).toHaveProperty('family');
  });
});

// --- Authentication ---

describe('authentication', () => {
  test('no session is a real 401', async () => {
    const { app } = await buildApp();
    const res = await request(app).get('/api/v1/llm/provider');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Authentication required');
  });

  test('a garbage bearer token is a real 401', async () => {
    const { app } = await buildApp();
    const res = await request(app).get('/api/v1/llm/provider')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
