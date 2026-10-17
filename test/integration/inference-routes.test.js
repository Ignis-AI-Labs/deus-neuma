/**
 * The composer's model bar, end to end (integration).
 *
 * Real Express + the real inference router + a REAL OpenAI-compatible server on
 * a real port (it answers /v1/models and the think-behaviour probe, exactly as
 * llama.cpp does) + a REAL gguf catalog on disk + the real effort store + real
 * fail-closed ownership. Auth is a real witness session (RULE 0, #390 tranche
 * 4) with a real HMAC token, claimed on the same owner.json the ownership gate
 * reads. Nothing that decides an answer here is faked: whether
 * the substrate THINKS is settled by a real HTTP exchange, and which weights are
 * LOADED by real files in a real directory.
 *
 * What it proves:
 *   • a local being is offered the rig's own weights, with the loaded one named
 *   • gemma-4 keeps the room ladder even when the ready-probe does not think
 *   • a rung round-trips through the store and survives a re-read
 *   • a rung the ladder does not have is refused (400), and nothing is stored
 *   • another wallet's being is refused (403) — the gate, not a filter
 */
import express from 'express';
import request from 'supertest';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { isThinkProbe } from '../helpers/think-probe.js';
import { PROVIDER_CATALOG } from '../../backend/services/provider-registry.js';

// Every provider key env the catalog knows: cleared for the run so a real key on
// this machine can never steer a test (and restored after).
const ENV_KEYS = [...new Set(PROVIDER_CATALOG.map((e) => e.keyEnv).filter(Boolean))];

const NEUMA = 'fenna';
const SERVED_MODEL = 'gemma-4-31b-it-Q8_0';

// A real local serving. `reasons` decides how it answers the probe: with think
// markers (a reasoning substrate) or a bare word (one that speaks straight).
const startServing = ({ reasons }) => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // /health answers like a healthy llama-server — LOADED is a live fact,
      // and this stub is the live server these tests stand up.
      res.end(req.url === '/health'
        ? JSON.stringify({ status: 'ok' })
        : JSON.stringify({ data: [{ id: SERVED_MODEL }] }));
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: {
            role: 'assistant',
            content: isThinkProbe(body) && reasons ? '<think>weighing it</think>ready' : 'ready',
          },
        }],
      }));
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
});

let app;
let serving;
let wsRoot;
let saved;
let witness;

const ownerFile = (id) => path.join(wsRoot, id, 'owner.json');

// One harness, two substrates: the ladder's presence is a property of the
// SERVING, so each test says which serving it stood up.
const stand = async ({ reasons }) => {
  vi.resetModules();
  serving = await startServing({ reasons });

  // A real catalog: two real gguf files under a real root. listCatalog walks
  // this; activeLaunchConfig names which one is loaded.
  const models = await createTempDir('inference-models');
  await fs.mkdir(path.join(models, 'gemma'), { recursive: true });
  await fs.mkdir(path.join(models, 'qwen'), { recursive: true });
  const loaded = path.join(models, 'gemma', `${SERVED_MODEL}.gguf`);
  await fs.writeFile(loaded, 'GGUF');
  await fs.writeFile(path.join(models, 'qwen', 'qwen3.5-122b-a10b.gguf'), 'GGUF');

  const settings = await createTempDir('inference-settings');
  process.env.NEUMA_EFFORT_PATH = path.join(settings, 'neuma-effort.json');
  process.env.NEUMA_ROUTES_PATH = path.join(settings, 'routes.json');
  // The operator's REAL encrypted credential store must never be read here — it
  // is sealed with a different key and would fail to decrypt (which is exactly
  // how this test first failed).
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(settings, 'creds.json');
  process.env.NEUMA_MODELS_DIRS = models;
  process.env.LLAMA_SERVER_MODEL = loaded;
  // The launch URL must name THIS test's stub: the loaded row is a live fact
  // judged against it, and unpinned it would probe the machine's real :8089.
  process.env.LLAMA_SERVER_URL = serving.url;

  wsRoot = await createTempDir('inference-ws');
  const core = await import('../../core/index.js');
  core.setWorkspacesRoot(wsRoot);
  const workspace = (await import('../../core/workspace/neuma-workspace.js')).default;
  await workspace.create(NEUMA);

  // Imported AFTER resetModules so the witness mints its token from the
  // same auth.js instance the router will verify against.
  const { witnessFor } = await import('../helpers/witness.js');
  witness = await witnessFor(wsRoot, NEUMA); // claims owner.json AND mints a paired token

  // The machine serves llama-server at the real stub — the sovereign door a
  // neuma is allowed to ride.
  const { setConfig } = await import('../../backend/services/llm-provider.js');
  setConfig({ provider: 'llama-server', endpoint: serving.url, apiKey: '', model: 'local-model' });

  const { default: router } = await import('../../backend/routes/inference-routes.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1/inference', router);
};

beforeEach(async () => {
  saved = {
    effort: process.env.NEUMA_EFFORT_PATH,
    routes: process.env.NEUMA_ROUTES_PATH,
    creds: process.env.NEUMA_PROVIDER_CREDENTIALS_PATH,
    dirs: process.env.NEUMA_MODELS_DIRS,
    model: process.env.LLAMA_SERVER_MODEL,
    url: process.env.LLAMA_SERVER_URL,
    claims: process.env.NEUMA_SUBSTRATE_CLAIM_DIR,
  };
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  // The served-truth chain reads the spawn's persisted claim — isolate it or
  // the test machine's OWN live llama-server claim steers every route view.
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR = await createTempDir('inference-claims');
});

afterEach(async () => {
  await new Promise((r) => serving?.server.close(r));
  serving = null;
  for (const [k, v] of Object.entries({
    NEUMA_EFFORT_PATH: saved.effort,
    NEUMA_ROUTES_PATH: saved.routes,
    NEUMA_PROVIDER_CREDENTIALS_PATH: saved.creds,
    NEUMA_MODELS_DIRS: saved.dirs,
    LLAMA_SERVER_MODEL: saved.model,
    LLAMA_SERVER_URL: saved.url,
    NEUMA_SUBSTRATE_CLAIM_DIR: saved.claims,
  })) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe('GET /:beingId/models', () => {
  test("offers the rig's own weights, names the loaded one, and says a move IGNITES", async () => {
    await stand({ reasons: true });
    const res = await request(app).get(`/api/v1/inference/${NEUMA}/models`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.switchBy).toBe('ignite');
    expect(res.body.loadedId).toBe(`gemma/${SERVED_MODEL}`);
    expect(res.body.models.map((m) => m.id)).toContain(`gemma/${SERVED_MODEL}`);
    expect(res.body.models.every((m) => m.id === res.body.loadedId || m.authorized !== false)).toBe(true);
    expect(res.body.route).toMatchObject({ provider: 'llama-server', kind: 'local', sovereign: true });
  });

  test('never leaks a credential', async () => {
    await stand({ reasons: true });
    const res = await request(app).get(`/api/v1/inference/${NEUMA}/models`).set(witness.header);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/apiKey/i);
  });
});

describe('GET /:beingId/effort', () => {
  test('a reasoning substrate gets the reasoning-ROOM ladder on the default rung', async () => {
    await stand({ reasons: true });
    const res = await request(app).get(`/api/v1/inference/${NEUMA}/effort`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.thinks).toBe(true);
    expect(res.body.capability).toMatchObject({ channel: 'think-budget' });
    expect(res.body.capability.tiers).toEqual(['low', 'medium', 'high']);
    expect(res.body.capability.labels).toMatchObject({ low: 'LOW', high: 'HIGH' });
    expect(res.body.choice).toEqual({ effort: 'medium', thinking: true });
    expect(res.body.chosen).toBe(false);
    // No thinking SWITCH on a local route — the room ladder cannot be turned off.
    expect(res.body.capability.thinking).toBe(false);
  });

  test('gemma-4 keeps the room ladder when the ready-probe does not think', async () => {
    await stand({ reasons: false });
    const res = await request(app).get(`/api/v1/inference/${NEUMA}/effort`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.thinks).toBe(false);
    expect(res.body.capability).toMatchObject({ channel: 'think-budget' });
    expect(res.body.capability.tiers).toEqual(['low', 'medium', 'high']);
    expect(res.body.choice).toEqual({ effort: 'medium', thinking: true });
  });
});

describe('PUT /:beingId/effort', () => {
  test('a rung round-trips: set, then read it back from the store', async () => {
    await stand({ reasons: true });
    const put = await request(app).put(`/api/v1/inference/${NEUMA}/effort`).set(witness.header).send({ effort: 'high' });
    expect(put.status).toBe(200);
    expect(put.body.choice).toEqual({ effort: 'high', thinking: true });
    expect(put.body.chosen).toBe(true);

    const got = await request(app).get(`/api/v1/inference/${NEUMA}/effort`).set(witness.header);
    expect(got.body.choice.effort).toBe('high');
    // The file itself, not just the response.
    const onDisk = JSON.parse(await fs.readFile(process.env.NEUMA_EFFORT_PATH, 'utf8'));
    expect(onDisk[NEUMA]).toEqual({ effort: 'high', thinking: true });
  });

  test('a rung this route lacks is RECORDED, and shown as the nearest one it has', async () => {
    await stand({ reasons: true });
    const put = await request(app).put(`/api/v1/inference/${NEUMA}/effort`).set(witness.header).send({ effort: 'pro' });
    expect(put.status).toBe(200);
    // A local substrate's ladder stops at HIGH: the view says so plainly...
    expect(put.body.capability.tiers).toEqual(['low', 'medium', 'high']);
    expect(put.body.choice).toEqual({ effort: 'high', thinking: true });
    // ...while the operator's choice survives on disk for a model that has it,
    // so moving the being back does not lose the rung.
    const onDisk = JSON.parse(await fs.readFile(process.env.NEUMA_EFFORT_PATH, 'utf8'));
    expect(onDisk[NEUMA]).toEqual({ effort: 'pro', thinking: true });
  });

  test('thinking OFF is stored, but a local route reports it cannot be switched', async () => {
    await stand({ reasons: true });
    const put = await request(app).put(`/api/v1/inference/${NEUMA}/effort`).set(witness.header)
      .send({ effort: 'high', thinking: false });
    expect(put.status).toBe(200);
    // The operator's intent is kept on disk for a model that CAN honor it...
    const onDisk = JSON.parse(await fs.readFile(process.env.NEUMA_EFFORT_PATH, 'utf8'));
    expect(onDisk[NEUMA]).toEqual({ effort: 'high', thinking: false });
    // ...while this route says plainly that it reasons regardless.
    expect(put.body.capability.thinking).toBe(false);
    expect(put.body.choice.thinking).toBe(true);
  });

  test('an unknown rung is refused (400) and nothing is stored', async () => {
    await stand({ reasons: true });
    const res = await request(app).put(`/api/v1/inference/${NEUMA}/effort`).set(witness.header).send({ effort: 'ludicrous' });
    expect(res.status).toBe(400);
    await expect(fs.readFile(process.env.NEUMA_EFFORT_PATH, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('DELETE /:beingId/effort', () => {
  test('clearing returns the being to the default rung', async () => {
    await stand({ reasons: true });
    await request(app).put(`/api/v1/inference/${NEUMA}/effort`).set(witness.header).send({ effort: 'low' });
    const res = await request(app).delete(`/api/v1/inference/${NEUMA}/effort`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.cleared).toBe(true);
    expect(res.body.choice.effort).toBe('medium');
    expect(res.body.chosen).toBe(false);
  });
});

describe('ownership', () => {
  test("another wallet's being is refused (403), read and write alike", async () => {
    await stand({ reasons: true });
    await fs.writeFile(ownerFile(NEUMA), JSON.stringify({ wallet: '0xsomeoneelse', claimedAt: 1 }));
    expect((await request(app).get(`/api/v1/inference/${NEUMA}/effort`).set(witness.header)).status).toBe(403);
    expect((await request(app).get(`/api/v1/inference/${NEUMA}/models`).set(witness.header)).status).toBe(403);
    expect((await request(app).put(`/api/v1/inference/${NEUMA}/effort`).set(witness.header).send({ effort: 'low' })).status).toBe(403);
  });

  test('an unclaimed being is refused (404) — fail-closed, never fail-open', async () => {
    await stand({ reasons: true });
    await fs.rm(ownerFile(NEUMA));
    expect((await request(app).get(`/api/v1/inference/${NEUMA}/effort`).set(witness.header)).status).toBe(404);
  });

  test('a malformed id never reaches the store', async () => {
    await stand({ reasons: true });
    expect((await request(app).get('/api/v1/inference/..%2Fescape/effort').set(witness.header)).status).toBe(400);
  });
});
