/**
 * THE HARNESS ROUTE, IN THE PERSON'S HANDS (RULE 0) — Design note, 2026-10-14: […]
 * and […].
 *
 * Real signed-wallet auth, the REAL harness routes on a real express app, a
 * temp realm and credential store; the model servers are real http servers
 * speaking LM Studio's and Ollama's own REST shapes (with state: an unload
 * really unloads), and a real llama.cpp-shaped server this platform did not
 * start. Nothing on this machine's own servers is touched.
 *
 * Claims:
 *   1. GET /route says what the turn will ride — the route store the turn
 *      resolves from, the provider's stored address, the model — and no key.
 *   2. Re-pointing (the door's CONNECT & SWITCH, or any writer of the route
 *      store) moves the line with it: it can never say one server while the
 *      turn goes to another.
 *   3. FREE: LM Studio unloads every loaded model; Ollama sends each running
 *      model away; a llama.cpp the platform did not start is refused with
 *      where to stop it; a server off this machine is refused.
 */
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { setHarnessRoot } from '../../core/workspace/lane-grounds.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSessionToken, generateChallenge, verifySignature } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import { setRoute } from '../../backend/services/neuma-routes-store.js';
import harnessRouter from '../../backend/routes/harness-routes.js';
import { harnessLaneId } from '../../backend/services/harness-lane.js';
import { serverLine } from '../../frontend/app/RelinkShell/harness-route-line.js';
import { beingModelOptions } from '../../backend/services/being-inference.js';

const ENV_DOORS = ['WORKSPACES_ROOT', 'HARNESS_ROOT', 'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH', 'NEUMA_REALM_ROOT', 'DNA_ENCRYPTION_KEY'];

let root; let saved; let api; let token; let wallet;
const servers = [];

const serve = (handler) => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      handler(req, chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null, res);
    });
  });
  servers.push(server);
  server.listen(0, '127.0.0.1', () => resolve(server));
});
const at = (server) => `http://127.0.0.1:${server.address().port}`;

const call = async (method, url, body, bearer = token) => {
  const res = await fetch(`${at(api)}${url}`, {
    method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

beforeAll(async () => {
  saved = Object.fromEntries(ENV_DOORS.map((k) => [k, process.env[k]]));
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-route-control-'));
  Object.assign(process.env, {
    DNA_ENCRYPTION_KEY: 'harness-route-control-key-long-enough',
    WORKSPACES_ROOT: path.join(root, 'house'), HARNESS_ROOT: path.join(root, 'harness'),
    NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(root, 'credentials.json'),
    NEUMA_ROUTES_PATH: path.join(root, 'routes.json'), NEUMA_REALM_ROOT: path.join(root, 'realm'),
  });
  await fs.mkdir(process.env.WORKSPACES_ROOT, { recursive: true });
  setWorkspacesRoot(process.env.WORKSPACES_ROOT);
  setHarnessRoot(process.env.HARNESS_ROOT);
  const app = express();
  app.use(express.json());
  app.use('/api/v1/harness', harnessRouter);
  api = await new Promise((resolve) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => resolve(s)); });
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  wallet = keypair.address;
  token = createSessionToken(verifySignature(keypair.address, challenge, await signMessage(keypair.privateKey, challenge)));
});

afterAll(async () => {
  await Promise.all([api, ...servers].map((s) => new Promise((r) => s.close(r))));
  setHarnessRoot(null);
  for (const k of ENV_DOORS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await fs.rm(root, { recursive: true, force: true });
});

describe('the route a person can check', () => {
  test('GET /route says what the turn rides — server, address, model — and never a key', async () => {
    await setCredential('lm-studio', { endpoint: 'http://localhost:1234', apiKey: 'lm-secret-key' });
    expect((await call('POST', '/api/v1/harness/lanes', { providerId: 'lm-studio', model: 'qwen/qwen3-32b' })).status).toBe(201);
    const { status, body } = await call('GET', '/api/v1/harness/route');
    expect(status).toBe(200);
    expect(body).toMatchObject({ providerId: 'lm-studio', providerName: 'LM Studio', model: 'qwen/qwen3-32b', endpoint: 'http://localhost:1234', error: null });
    expect(JSON.stringify(body)).not.toContain('lm-secret-key');
    expect(serverLine(body.providerId ? { ...body, kind: 'local' } : null)).toBe('LM Studio · localhost:1234');
  });

  test('re-pointed by the door, or by any writer of the route store, the line moves with the turn', async () => {
    await setCredential('llama-server', { endpoint: 'http://127.0.0.1:8089' });
    await call('POST', '/api/v1/harness/lanes', { providerId: 'llama-server', model: 'qwen3.8-27b-q8' });
    expect((await call('GET', '/api/v1/harness/route')).body).toMatchObject({ providerId: 'llama-server', endpoint: 'http://127.0.0.1:8089', model: 'qwen3.8-27b-q8' });
    await setRoute(harnessLaneId(wallet), { provider: 'lm-studio', model: 'google/gemma-3-12b' });
    expect((await call('GET', '/api/v1/harness/route')).body).toMatchObject({ providerId: 'lm-studio', model: 'google/gemma-3-12b' });
  });

  test('the bar names a server the way a person knows it', () => {
    expect(serverLine({ providerId: 'llama-server', endpoint: 'http://localhost:8089', kind: 'local' })).toBe('llama.cpp · localhost:8089');
    expect(serverLine({ providerId: 'openai', name: 'OpenAI', endpoint: 'https://api.openai.com', kind: 'cloud' })).toBe('OpenAI');
    expect(serverLine(null)).toBe('NO SERVER');
  });

  test('only the signed-in wallet reads its route', async () => {
    expect((await call('GET', '/api/v1/harness/route', null, null)).status).toBe(401);
  });
});

describe('FREE — one server gives its memory back, so another can have it', () => {
  test('LM Studio: every loaded model is unloaded', async () => {
    const loaded = new Set(['qwen/qwen3-32b', 'google/gemma-3-12b']);
    const lm = await serve((req, body, res) => {
      if (req.method === 'GET' && req.url === '/api/v1/models') {
        res.end(JSON.stringify({ models: ['qwen/qwen3-32b', 'google/gemma-3-12b', 'mistral-7b'].map((key) => ({
          type: 'llm', key, loaded_instances: loaded.has(key) ? [{ id: key }] : [] })) }));
      } else if (req.method === 'POST' && req.url === '/api/v1/models/unload' && loaded.delete(body?.instance_id)) {
        res.end(JSON.stringify({ instance_id: body.instance_id }));
      } else { res.writeHead(404); res.end('{}'); }
    });
    const { body } = await call('POST', '/api/v1/harness/servers/release', { providerId: 'lm-studio', endpoint: at(lm) });
    expect(body).toMatchObject({ ok: true, freed: ['qwen/qwen3-32b', 'google/gemma-3-12b'] });
    expect(loaded.size).toBe(0);
    expect((await call('POST', '/api/v1/harness/servers/release', { providerId: 'lm-studio', endpoint: at(lm) })).body)
      .toMatchObject({ ok: true, freed: [], line: 'LM Studio had nothing loaded.' });
  });

  test('Ollama: each running model is sent away now (keep_alive 0)', async () => {
    const running = new Set(['llama3.2:3b', 'qwen3:8b']);
    const ol = await serve((req, body, res) => {
      if (req.method === 'GET' && req.url === '/api/ps') res.end(JSON.stringify({ models: [...running].map((name) => ({ name })) }));
      else if (req.method === 'POST' && req.url === '/api/generate' && body?.keep_alive === 0) { running.delete(body.model); res.end('{}'); }
      else { res.writeHead(404); res.end('{}'); }
    });
    const { body } = await call('POST', '/api/v1/harness/servers/release', { providerId: 'ollama', endpoint: at(ol) });
    expect(body).toMatchObject({ ok: true, freed: ['llama3.2:3b', 'qwen3:8b'] });
    expect(running.size).toBe(0);
  });

  test('a llama.cpp the platform did not start is not ours to stop — the reply says where', async () => {
    let touched = false;
    const foreign = await serve((req, body, res) => { touched = touched || req.method === 'POST'; res.end(JSON.stringify({ model_path: '/m/q.gguf' })); });
    const { body } = await call('POST', '/api/v1/harness/servers/release', { providerId: 'llama-server', endpoint: at(foreign) });
    expect(body).toMatchObject({ ok: false, code: 'not-ours' });
    expect(body.line).toMatch(/started outside Deus Neuma/);
    expect(touched).toBe(false);
  });

  test('a server off this machine is never reached from here', async () => {
    const { body } = await call('POST', '/api/v1/harness/servers/release', { providerId: 'lm-studio', endpoint: 'http://192.168.1.50:1234' });
    expect(body).toMatchObject({ ok: false, code: 'not-local' });
  });
});

describe('SWITCH — one server at a time, moved from the composer bar', () => {
  test('the bar\'s view of a harness: its server and that server\'s models, moved by route — never by ignition', async () => {
    const lm = await serve((req, body, res) => {
      if (req.url === '/api/v1/models') res.end(JSON.stringify({ models: [{ type: 'llm', key: 'a/one', loaded_instances: [] }, { type: 'llm', key: 'b/two', loaded_instances: [] }] }));
      else { res.writeHead(404); res.end('{}'); }
    });
    await call('POST', '/api/v1/harness/switch', { providerId: 'lm-studio', endpoint: at(lm), model: 'b/two' });
    const view = await beingModelOptions(harnessLaneId(wallet));
    expect(view.switchBy).toBe('harness');
    expect(view.server).toMatchObject({ providerId: 'lm-studio', endpoint: at(lm) });
    expect(view.models.map((m) => m.id)).toEqual(['a/one', 'b/two']);
    expect(view.route.model).toBe('b/two');
  });

  test('LM Studio → llama.cpp: the model it holds is taken, and the server left behind is named with what it still holds', async () => {
    const lm = await serve((req, body, res) => {
      if (req.url === '/api/v1/models') res.end(JSON.stringify({ models: [{ type: 'llm', key: 'qwen/q4b', loaded_instances: [{ id: 'qwen/q4b' }] }] }));
      else { res.writeHead(404); res.end('{}'); }
    });
    const llama = await serve((req, body, res) => {
      if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: '/m/qwen3.8-27b-q8.gguf' }] }));
      else { res.writeHead(404); res.end('{}'); }
    });
    await call('POST', '/api/v1/harness/switch', { providerId: 'lm-studio', endpoint: at(lm), model: 'qwen/q4b' });
    const moved = await call('POST', '/api/v1/harness/switch', { providerId: 'llama-server', endpoint: at(llama) });
    expect(moved.status).toBe(200);
    expect(moved.body.route).toMatchObject({ providerId: 'llama-server', endpoint: at(llama), model: '/m/qwen3.8-27b-q8.gguf' });
    expect(moved.body.previous).toEqual({ providerId: 'lm-studio', endpoint: at(lm), holds: ['qwen/q4b'] });
    // the turn rides what the bar says
    expect((await call('GET', '/api/v1/harness/route')).body).toMatchObject({ providerId: 'llama-server', endpoint: at(llama) });
  });

  test('a server holding nothing and listing nothing is refused in words; one off this machine is refused', async () => {
    const empty = await serve((req, body, res) => { res.end(JSON.stringify({ data: [] })); });
    const r = await call('POST', '/api/v1/harness/switch', { providerId: 'llama-server', endpoint: at(empty) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/no model to use/);
    expect((await call('POST', '/api/v1/harness/switch', { providerId: 'lm-studio', endpoint: 'http://10.0.0.5:1234' })).status).toBe(400);
  });
});
