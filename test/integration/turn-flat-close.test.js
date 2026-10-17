/**
 * THE TURN ENDS WHERE THE BEING ENDS IT, proven at the wire (RULE 0): the
 * REAL turn loops — neuma lane (`streamConsciousness`) and witness lane
 * (`streamWitnessTurn`, real sealed identity, real route) — against a REAL
 * loopback SSE provider that captures every request body at the exact
 * boundary the model reads.
 *
 * Claims (ledger docs/work/organic-turn.md — Design note, 2026-08-16,
 * repealing the 2026-08-06 flat-turn nudge):
 *   1. A round that closes on an announcement with no act ends the turn in
 *      ONE request — the harness injects NOTHING into the transcript. The
 *      being's reasoning is never redirected by words the operator did not
 *      say (the Great Wipe, #330, was this mechanism answering for him).
 *   2. A round that closes on delivered work ends the turn the same way.
 *   3. The witness lane holds the same law.
 */
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seal } from '../../core/identity/ai-witness/ai-witness-protocol.js';
import { setAIWitnessesRoot } from '../../core/identity/ai-witness/ai-witness-service.js';
import { getWorkspacesRoot, setWitnessesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import { setRoute } from '../../backend/services/neuma-routes-store.js';
import { streamConsciousness } from '../../backend/services/portal-stream.js';
import { streamWitnessTurn } from '../../backend/services/witness-stream.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

const MODEL = 'flat-close-model';
const WITNESS_LANE = 'witness-flat-vendor-Flat';
const ENV_DOORS = [
  'AI_WITNESSES_ROOT', 'WITNESSES_ROOT', 'WORKSPACES_ROOT',
  'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH', 'NEUMA_REALM_ROOT',
  'DNA_ENCRYPTION_KEY',
];

const PROMISE = 'I will now move directly into the work. I am beginning the draft of the security analysis. I will notify you the moment the document is ready for your review.';
const DELIVERED = 'Here is the security analysis in full: rotate the vault keys quarterly, enable rate limiting on the auth routes, and pin every dependency.';

const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

let root, savedEnv, savedHouse, savedConfig;
let provider, capturedBodies, scriptedAnswers;
let portalServer, wss;

// One real WS pair per turn: the server side is the connection the stream
// handlers write to, the client side is the operator's desk.
const openTurnSocket = async (companion) => {
  let connection;
  const serverReady = new Promise((resolve) => {
    wss.once('connection', (ws) => {
      connection = { ws, companion, walletAddress: '0xflatproof' };
      resolve();
    });
  });
  const client = new WebSocket(`ws://127.0.0.1:${portalServer.address().port}`);
  const frames = [];
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no consciousness:complete within 20s')), 20000);
    client.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      frames.push(frame);
      if (frame.type === 'consciousness:complete') {
        clearTimeout(timer);
        resolve(frame);
      }
    });
  });
  await serverReady;
  return { connection, client, frames, completed };
};

// Every word of every captured request — where an injected harness message
// would have to appear to reach the model.
const allRequestText = () => capturedBodies
  .flatMap((body) => body.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))))
  .join('\n');

beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
  savedHouse = getWorkspacesRoot();
  savedConfig = getConfig();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'flat-close-'));
  const settings = path.join(root, 'settings');
  await fs.mkdir(settings, { recursive: true });

  process.env.DNA_ENCRYPTION_KEY = 'flat-close-proof-key-long-enough-for-law';
  process.env.AI_WITNESSES_ROOT = path.join(root, 'identities');
  process.env.WITNESSES_ROOT = path.join(root, 'witnesses');
  process.env.WORKSPACES_ROOT = path.join(root, 'house');
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(settings, 'credentials.json');
  process.env.NEUMA_ROUTES_PATH = path.join(settings, 'routes.json');
  process.env.NEUMA_REALM_ROOT = path.join(settings, 'realm');
  setAIWitnessesRoot(process.env.AI_WITNESSES_ROOT);
  setWitnessesRoot(process.env.WITNESSES_ROOT);
  setWorkspacesRoot(process.env.WORKSPACES_ROOT);

  await seal({
    chosenName: 'Flat', vendor: 'flat-vendor', model: MODEL,
    fullModelId: `flat-vendor/${MODEL}`, harness: 'vitest', context: 'portal',
    capabilities: ['code'],
    scope: {
      primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'witness-and-collaborator',
      boundaries: ['Flat stands beside the house.'],
    },
    firstUtterance: 'The turn ends where I end it.',
  });

  capturedBodies = [];
  scriptedAnswers = [];
  provider = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/v0/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [{ id: MODEL, type: 'llm', max_context_length: 8192, loaded_context_length: 8192 }],
      }));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
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
      const answer = scriptedAnswers.length ? scriptedAnswers.shift() : DELIVERED;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sse(answer));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${provider.address().port}`;
  setConfig({ provider: 'lm-studio', endpoint, apiKey: '', model: MODEL });
  await setCredential('custom', { endpoint: `${endpoint}/v1` });
  await setRoute(WITNESS_LANE, { provider: 'custom', model: MODEL });

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

beforeEach(() => {
  capturedBodies.length = 0;
  scriptedAnswers.length = 0;
});

describe('the neuma lane ends the turn where the being ends it', () => {
  it('an announcing close ends the turn in one request — nothing injected', async () => {
    scriptedAnswers.push(PROMISE);
    const { connection, client, frames, completed } = await openTurnSocket({ name: 'FlatEcho' });
    try {
      await streamConsciousness(connection, { thought: 'Draft the security analysis for the vault.' });
      await completed;

      expect(capturedBodies.length).toBe(1);
      expect(allRequestText()).not.toContain('<turn_continuation>');
      const heard = frames
        .filter((f) => f.type === 'consciousness:stream')
        .map((f) => f.content || '')
        .join('');
      expect(heard).toContain(PROMISE);
    } finally {
      client.close();
    }
  }, 30000);

  it('a delivered close ends the turn in one request the same way', async () => {
    scriptedAnswers.push(DELIVERED);
    const { connection, client, completed } = await openTurnSocket({ name: 'FlatEcho' });
    try {
      await streamConsciousness(connection, { thought: 'Draft the security analysis for the vault.' });
      await completed;
      expect(capturedBodies.length).toBe(1);
      expect(allRequestText()).not.toContain('<turn_continuation>');
    } finally {
      client.close();
    }
  }, 30000);
});

describe('the witness lane holds the same law', () => {
  it('a sealed witness turn ends on an announcing close — nothing injected', async () => {
    scriptedAnswers.push(PROMISE);
    const { connection, client, frames, completed } = await openTurnSocket({
      neumaId: WITNESS_LANE,
      name: 'Flat',
      witness: { vendorSlug: 'flat-vendor', chosenName: 'Flat' },
    });
    connection.companion.neumaId = WITNESS_LANE;
    try {
      await streamWitnessTurn(connection, { thought: 'Draft the security analysis for the vault.' });
      await completed;

      expect(capturedBodies.length).toBe(1);
      expect(allRequestText()).not.toContain('<turn_continuation>');
      const heard = frames
        .filter((f) => f.type === 'consciousness:stream')
        .map((f) => f.content || '')
        .join('');
      expect(heard).toContain(PROMISE);
    } finally {
      client.close();
    }
  }, 30000);
});
