/**
 * AN OPERATOR'S OWN LLAMA.CPP IS USED AS IT STANDS.
 *
 * Every llama.cpp the platform talked to used to be treated as the house's
 * own supervised server: a turn routed at an operator's llama.cpp on :8080
 * made the provider boot the HOUSE launch (:8089) first — and on a machine
 * with no house model that boot failed ([…]), so every being turn and the birth flight check's liveness probe
 * died, and the flight check's first-run auto-adopt had already saved that
 * broken choice for every later start.
 *
 * Proven here over real sockets (RULE 0): the operator's server is a real
 * loopback HTTP server speaking llama.cpp's endpoints, the house launch is
 * pinned to a real port nothing listens on with no model configured, and the
 * real provider, real discovery sweep (pinned to the fixture's port), real
 * encrypted credential store and real choice file run unchanged.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';
import { closedProviderEndpoint } from '../helpers/local-provider.js';

const DIR = mkdtempSync(path.join(os.tmpdir(), 'neuma-external-llama-'));
process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(DIR, 'provider-credentials.json');

const savedEnv = Object.fromEntries(
  ['LLAMA_SERVER_URL', 'LLAMA_SERVER_MODEL', 'LLAMA_SERVER_BIN', 'NEUMA_DISCOVERY_PORTS', 'NEUMA_PROVIDER_CHOICE_PATH']
    .map((k) => [k, process.env[k]]),
);

const { createStreamRequest, setConfig } = await import('../../backend/services/llm-provider.js');
const { lastActivity } = await import('../../backend/services/substrate-idle.js');
const { setCredential } = await import('../../backend/services/provider-credentials.js');
const { checkSubstrate } = await import('../../backend/routes/preflight-checks.js');

// impure — a real llama.cpp-shaped server: /v1/models, /props, /health, and a
// streamed completion — or, `answers: false`, one that lists its model but
// refuses every completion.
const startOperatorLlamaCpp = ({ answers = true } = {}) => new Promise((resolve) => {
  const turns = [];
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      if (req.url === '/v1/models') return json(res, 200, { data: [{ id: 'operator-model' }] });
      if (req.url === '/props') return json(res, 200, { total_slots: 1 });
      if (req.url === '/health') return json(res, 200, { status: 'ok' });
      return json(res, 404, {});
    }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { /* malformed stays {} */ }
      if (isThinkProbe(body)) return respondThinkProbe(res);
      if (!Array.isArray(body.messages)) return json(res, 200, {});
      turns.push(body);
      if (!answers) return json(res, 500, { error: { message: 'the server refused this request', type: 'server_error' } });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'I am here and answering you.' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ port, endpoint: `http://127.0.0.1:${port}`, turns, close: () => new Promise((r) => server.close(r)) });
  });
});

let operator;
let refusing;
let house;
beforeAll(async () => {
  operator = await startOperatorLlamaCpp();
  refusing = await startOperatorLlamaCpp({ answers: false });
  // The house launch: a real port nothing serves, and no model configured —
  // the machine of an operator who runs their own llama.cpp.
  house = await closedProviderEndpoint();
  process.env.LLAMA_SERVER_URL = house.endpoint;
  delete process.env.LLAMA_SERVER_MODEL;
  delete process.env.LLAMA_SERVER_BIN;
  // The fixed Ollama / LM Studio probes must not find the machine's own servers.
  const dead = await closedProviderEndpoint();
  await setCredential('ollama', { endpoint: dead.endpoint });
  await setCredential('lm-studio', { endpoint: dead.endpoint });
});
afterAll(async () => {
  await operator.close();
  await refusing.close();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(DIR, { recursive: true, force: true });
});

const PROBE = [{ role: 'user', content: 'Say hello.' }];

describe('a turn on an operator\'s own llama.cpp', () => {
  test('streams from it as it stands — the house launch is never booted or clocked for it', async () => {
    const clockBefore = lastActivity();
    const stream = await createStreamRequest(PROBE, {
      route: { provider: 'llama-server', endpoint: operator.endpoint, model: 'operator-model', apiKey: '' },
      maxTokens: 64,
    });
    expect(stream).toBeTruthy();
    expect(operator.turns.length).toBeGreaterThanOrEqual(1);
    expect(lastActivity()).toBe(clockBefore);
  });

  test('a turn on the house endpoint is still the house\'s to supervise', async () => {
    // Nothing serves the house port and no model is configured: the house
    // boot is attempted and refused — the supervision still runs for it.
    await expect(createStreamRequest(PROBE, {
      route: { provider: 'llama-server', endpoint: house.endpoint, model: 'local-model', apiKey: '' },
      maxTokens: 64,
    })).rejects.toThrow(/model file/);
  });
});

describe('the flight check adopting an operator\'s llama.cpp', () => {
  test('a server that answers passes and is remembered as the choice', async () => {
    const choice = path.join(DIR, 'choice-answers.json');
    process.env.NEUMA_PROVIDER_CHOICE_PATH = choice;
    process.env.NEUMA_DISCOVERY_PORTS = String(operator.port);
    setConfig({ provider: 'llama-server', endpoint: 'http://127.0.0.1:1', model: 'local-model' });
    // a check that is not the install owner's never adopts (audit 2026-10-28 M-03)
    const guest = await checkSubstrate();
    expect(guest.detail ?? '').not.toMatch(/adopted automatically/);
    expect(existsSync(choice)).toBe(false);
    setConfig({ provider: 'llama-server', endpoint: 'http://127.0.0.1:1', model: 'local-model' });
    const row = await checkSubstrate(null, { mayAdopt: true });
    expect(row.status).toBe('pass');
    expect(row.detail).toMatch(/adopted automatically/);
    const saved = JSON.parse(readFileSync(choice, 'utf8'));
    expect(saved).toMatchObject({ provider: 'llama-server', endpoint: operator.endpoint, chosenBy: 'auto' });
  }, 30000);

  test('a server that never answers is not remembered across restarts', async () => {
    const choice = path.join(DIR, 'choice-refuses.json');
    process.env.NEUMA_PROVIDER_CHOICE_PATH = choice;
    process.env.NEUMA_DISCOVERY_PORTS = String(refusing.port);
    setConfig({ provider: 'llama-server', endpoint: 'http://127.0.0.1:1', model: 'local-model' });
    const row = await checkSubstrate(null, { mayAdopt: true });
    expect(row.status).toBe('fail');
    expect(existsSync(choice)).toBe(false);
  }, 30000);
});
