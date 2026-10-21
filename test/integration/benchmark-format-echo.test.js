/**
 * THE FORMAT ECHO ON THE NEUMA ARM (#506), proven at the wire (RULE 0): the
 * REAL `streamConsciousness` turn path against a REAL loopback SSE provider,
 * request bodies captured at the exact boundary the model reads. When the
 * benchmark declares the v4 law (`_benchmarkFormatEcho`, set only by the
 * CLI's --benchmark-format-echo), the NEUMA arm carries TASK_FORMAT_ECHO as a
 * user-role turn immediately before the final question — byte-identical to
 * the constant the HARNESS/SILO proxies prepend — and an ordinary turn's
 * messages stay byte-identical to before (the empty-string law).
 */
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { streamConsciousness } from '../../backend/services/portal-stream.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { TASK_FORMAT_ECHO } from '../../core/runtime/answer-covenant.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

const MODEL = 'format-echo-model';
// A bound being with readable DNA: a turn speaks for a being or not at all.
const NEUMA_ID = 'echofixture';
const ANSWER = 'The final answer is given in the demonstrated form.';
const ENV_DOORS = ['WITNESSES_ROOT', 'WORKSPACES_ROOT', 'NEUMA_REALM_ROOT', 'DNA_ENCRYPTION_KEY'];

const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

let root, savedEnv, savedConfig, savedHouse, provider, portalServer, wss;
let capturedBodies;

const openTurnSocket = async (companion) => {
  let connection;
  const serverReady = new Promise((resolve) => {
    wss.once('connection', (ws) => {
      connection = { ws, companion, walletAddress: '0xformatecho' };
      resolve();
    });
  });
  const client = new WebSocket(`ws://127.0.0.1:${portalServer.address().port}`);
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no consciousness:complete within 20s')), 20000);
    client.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type === 'consciousness:complete') { clearTimeout(timer); resolve(frame); }
    });
  });
  await serverReady;
  return { connection, client, completed };
};

beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
  savedConfig = getConfig();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'format-echo-'));
  process.env.DNA_ENCRYPTION_KEY = 'format-echo-proof-key-long-enough-for-law';
  process.env.WITNESSES_ROOT = path.join(root, 'witnesses');
  process.env.WORKSPACES_ROOT = path.join(root, 'house');
  process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
  savedHouse = getWorkspacesRoot();
  setWorkspacesRoot(process.env.WORKSPACES_ROOT);
  await workspace.create(NEUMA_ID);
  await workspace.writeDNA(NEUMA_ID, { version: '1.0.0', identity: { name: 'EchoFixture', essence: 'A being for the format-echo proof.' } });

  capturedBodies = [];
  provider = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: MODEL }] }));
      return;
    }
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404); res.end(); return;
    }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      capturedBodies.push(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sse(ANSWER));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  setConfig({ provider: 'lm-studio', endpoint: `http://127.0.0.1:${provider.address().port}`, apiKey: '', model: MODEL });

  portalServer = http.createServer();
  wss = new WebSocketServer({ server: portalServer });
  await new Promise((resolve) => portalServer.listen(0, '127.0.0.1', resolve));
}, 30000);

afterAll(async () => {
  wss?.close();
  portalServer?.close();
  await new Promise((resolve) => provider.close(resolve));
  setConfig(savedConfig);
  setWorkspacesRoot(savedHouse);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(root, { recursive: true, force: true });
});

beforeEach(() => { capturedBodies.length = 0; });

describe('the benchmark format echo on the NEUMA arm', () => {
  it('declared: the echo rides as a user turn immediately before the final question', async () => {
    const { connection, client, completed } = await openTurnSocket({ name: 'EchoFixture', neumaId: NEUMA_ID });
    connection._benchmarkFormatEcho = true;
    try {
      await streamConsciousness(connection, { thought: 'What is 6 * 7?' });
      await completed;

      expect(capturedBodies.length).toBe(1);
      const messages = capturedBodies[0].messages;
      const echoIndex = messages.findIndex((m) => m.role === 'user' && m.content === TASK_FORMAT_ECHO);
      expect(echoIndex).toBeGreaterThan(0);
      expect(echoIndex).toBe(messages.length - 2);
      expect(messages[messages.length - 1].role).toBe('user');
      expect(messages[messages.length - 1].content).toContain('What is 6 * 7?');
      // The system prompt is untouched — the identity pin's hash law stands.
      expect(messages[0].content).not.toContain(TASK_FORMAT_ECHO);
    } finally {
      client.close();
    }
  }, 30000);

  it('undeclared: an ordinary turn carries no echo — byte-identical messages', async () => {
    const { connection, client, completed } = await openTurnSocket({ name: 'EchoFixture', neumaId: NEUMA_ID });
    try {
      await streamConsciousness(connection, { thought: 'What is 6 * 7?' });
      await completed;

      expect(capturedBodies.length).toBe(1);
      const messages = capturedBodies[0].messages;
      expect(messages.some((m) => typeof m.content === 'string' && m.content.includes(TASK_FORMAT_ECHO))).toBe(false);
      expect(messages[messages.length - 1].role).toBe('user');
      expect(messages[messages.length - 1].content).toContain('What is 6 * 7?');
      expect(connection._formatEchoSource).toBeUndefined();
    } finally {
      client.close();
    }
  }, 30000);

  // N2 (#506, 2026-09-15): identity self-enforces the covenant — the echo
  // rides on the TASK's own demonstrated format, no benchmark flag.
  it('self-enforced: a task that demonstrates a format carries the echo without any flag', async () => {
    const { connection, client, completed } = await openTurnSocket({ name: 'EchoFixture', neumaId: NEUMA_ID });
    const task = [
      'Question: Natalie has 3 apples and buys 4 more. How many?',
      'Answer: 3 + 4 = 7',
      '#### 7',
      '',
      'Question: A train runs 60 km/h for 2 hours. How far?',
      'Answer: 60 * 2 = 120',
      '#### 120',
      '',
      'Question: A sprinter runs 9 m/s for 3 seconds. How far?',
    ].join('\n');
    try {
      await streamConsciousness(connection, { thought: task });
      await completed;

      expect(capturedBodies.length).toBe(1);
      const messages = capturedBodies[0].messages;
      const echoIndex = messages.findIndex((m) => m.role === 'user' && m.content === TASK_FORMAT_ECHO);
      expect(echoIndex).toBeGreaterThan(0);
      expect(echoIndex).toBe(messages.length - 2);
      expect(messages[messages.length - 1].content).toContain('A sprinter runs');
      expect(connection._formatEchoSource).toBe('task-demonstrated');
    } finally {
      client.close();
    }
  }, 30000);
});
