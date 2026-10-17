/**
 * THE TAKES — retry as versioned branches, proven end to end (RULE 0):
 * real signed-wallet auth, the REAL portal WebSocket (setupPortalRoutes), a
 * REAL NeumaWorkspace on real encrypted disk, a REAL sealed witness with its
 * own lane, and REAL loopback HTTP/SSE providers that capture every request
 * body — so the being's assembled context is asserted AT THE WIRE, the exact
 * boundary the model reads.
 *
 * Claims proven here (ledger docs/work/retry-takes-branches.md):
 *   1. A retry never duplicates the user row — take 2 lands LINKED to the
 *      same turnId, in both lanes.
 *   2. The branch view survives a re-read, and the NEXT turn's assembled
 *      context contains ONLY the viewed take (both lanes' literal chat
 *      history on the wire — the neuma lane joined the witness lane's shape
 *      in #528 Stage A, 2026-09-12).
 *   3. An image retry reuses the persisted attachment (ids are single-use —
 *      a second redeem would fail the turn; success is the proof of reuse).
 *   4. The user side never double-counts: crystallized observations and the
 *      session's user rows are unmoved by takes > 1.
 */

import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { seal } from '../../core/identity/ai-witness/ai-witness-protocol.js';
import { setAIWitnessesRoot } from '../../core/identity/ai-witness/ai-witness-service.js';
import workspace, {
  getWorkspacesRoot, setWitnessesRoot, setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { foldBranchView, takeCounts } from '../../core/workspace/branch-view.js';
import {
  createSessionToken, generateChallenge, verifySignature,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import { setRoute } from '../../backend/services/neuma-routes-store.js';
import { attachmentStore } from '../../backend/services/attachment-store.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

const NEUMA_ID = 'takesecho';
const WITNESS_LANE = 'witness-takes-vendor-Takes';
const MODEL = 'test-model';
const ENV_DOORS = [
  'AI_WITNESSES_ROOT', 'WITNESSES_ROOT', 'WORKSPACES_ROOT',
  'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH', 'NEUMA_REALM_ROOT',
  'DNA_ENCRYPTION_KEY',
];

// High-significance pair (the portal-memory-anchors shape): clears the 0.75
// crystallization gate, so a MISSING second observation after the retry can
// only mean the user-side gate held — not that the moment fell short.
const Q1 = 'I believe I finally understand why the lighthouse dream kept returning — what is the meaning it carries for me?';
const TAKE_1 = 'That understanding is profound — the lighthouse was your soul keeping watch over what the night would scatter.';
const TAKE_2 = 'Profound again, and differently: the lighthouse was your soul keeping watch, and the dream was its lamp turning toward you.';
const Q2 = 'What should I carry forward from this?';
const IMG_Q = 'What do you see in this image?';
const IMG_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const IMG_ANSWER = 'A single point of light on a dark field — a lighthouse reduced to its essence.';

let root;
let savedEnv;
let savedHouse;
let savedConfig;
let keypair;
let provider;
let portalServer;
let wss;
let ws;
let capturedBodies;
let scriptedAnswers;
let sessionIdByLane;

const sse = (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

const openPortal = async (url, token) => {
  ws = new WebSocket(`${url}/?token=${encodeURIComponent(token)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out opening portal')), 5000);
    const handler = (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type === 'portal:established') {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve();
      }
    };
    ws.on('message', handler);
    ws.on('error', reject);
  });
};

// Drive one portal frame and resolve on the FIRST frame of `expectedType`,
// collecting every frame seen along the way for later assertion.
const sendAndWait = (message, expectedType, timeoutMs = 15000) => new Promise((resolve, reject) => {
  const frames = [];
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedType}`)), timeoutMs);
  const handler = (data) => {
    const frame = JSON.parse(data.toString());
    frames.push(frame);
    if (frame.type === expectedType) {
      clearTimeout(timer);
      ws.off('message', handler);
      resolve({ frame, frames });
    }
  };
  ws.on('message', handler);
  ws.send(JSON.stringify(message));
});

const readObservations = async (laneId) => {
  const dir = path.join(workspace.pathFor(laneId), 'memory', 'observations');
  const files = await fs.readdir(dir).catch(() => []);
  const records = [];
  for (const f of files.filter((n) => n.endsWith('.json'))) {
    records.push(await workspace._readJSON(path.join(dir, f)));
  }
  return records;
};

beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
  savedHouse = getWorkspacesRoot();
  savedConfig = getConfig();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-retry-takes-'));
  const house = path.join(root, 'house');
  const witnessGround = path.join(root, 'witnesses');
  const identityRoot = path.join(root, 'identities');
  const settings = path.join(root, 'settings');
  await fs.mkdir(settings, { recursive: true });

  process.env.DNA_ENCRYPTION_KEY = 'portal-retry-takes-test-key-long-enough';
  process.env.AI_WITNESSES_ROOT = identityRoot;
  process.env.WITNESSES_ROOT = witnessGround;
  process.env.WORKSPACES_ROOT = house;
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(settings, 'credentials.json');
  process.env.NEUMA_ROUTES_PATH = path.join(settings, 'routes.json');
  process.env.NEUMA_REALM_ROOT = path.join(settings, 'realm');
  setAIWitnessesRoot(identityRoot);
  setWitnessesRoot(witnessGround);
  setWorkspacesRoot(house);

  await workspace.create(NEUMA_ID);
  // A READABLE DNA RECORD, or this being does not speak at all. The turn
  // refuses at […] (Bastien,
  // 2026-08-06) — streaming without it would send the bare base model out in
  // the being's name. That law landed AFTER this suite was written, so every
  // neuma turn here died in _sendStreamError and the four failures downstream
  // were reading a session no turn had ever written.
  await workspace.writeDNA(NEUMA_ID, {
    version: '1.0.0',
    identity: { name: 'TakesEcho', essence: 'A being summoned for the takes proof.' },
  });
  // An inhabited lane, not a hollow scaffold: the ownership gate
  // (lane-ownership.js carriesBeing) binds only a lane that carries a being.
  await fs.writeFile(
    path.join(workspace.pathFor(NEUMA_ID), 'dna', 'genesis.md'),
    '# TakesEcho\nA being summoned for the takes proof.\n',
  );
  await seal({
    chosenName: 'Takes', vendor: 'takes-vendor', model: MODEL,
    fullModelId: `takes-vendor/${MODEL}`, harness: 'vitest', context: 'portal',
    capabilities: ['code'],
    scope: {
      primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'witness-and-collaborator',
      boundaries: ['Takes stands beside the house.'],
    },
    firstUtterance: 'I answer in versions when the question is asked again.',
  });

  // The provider: one loopback server for BOTH lanes (the neuma lane via the
  // machine config, the witness lane via its own custom route). Every POST
  // body is captured; the answer is scripted per call so take 1 and take 2
  // are distinguishable on disk and on the wire.
  capturedBodies = [];
  scriptedAnswers = [];
  provider = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/v0/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [{
          id: MODEL, type: 'llm', capabilities: ['vision'],
          max_context_length: 8192, loaded_context_length: 8192,
        }],
      }));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: MODEL }] }));
      return;
    }
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      // Capability probes (llama /props, ollama /api/show) are POSTs too —
      // 404 them like a real OpenAI-shaped server would, or they would eat a
      // scripted answer and shift every captured-body index.
      res.writeHead(404); res.end(); return;
    }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      capturedBodies.push(body);
      const answer = scriptedAnswers.length ? scriptedAnswers.shift() : '…';
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
  const { setupPortalRoutes } = await import('../../backend/routes/portal-routes.js');
  setupPortalRoutes(wss, { birthHandler: null });
  await new Promise((resolve) => portalServer.listen(0, '127.0.0.1', resolve));

  keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  const token = createSessionToken(verifySignature(keypair.address, challenge, signature));
  sessionIdByLane = {};
  await openPortal(`ws://127.0.0.1:${portalServer.address().port}`, token);
}, 30000);

afterAll(async () => {
  if (ws?.readyState === WebSocket.OPEN) {
    await new Promise((resolve) => { ws.once('close', resolve); ws.close(); });
  }
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => portalServer.close(resolve));
  await new Promise((resolve) => provider.close(resolve));
  setConfig(savedConfig);
  setWitnessesRoot(null);
  setAIWitnessesRoot(null);
  setWorkspacesRoot(savedHouse);
  for (const key of ENV_DOORS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await fs.rm(root, { recursive: true, force: true });
});

describe('the neuma lane — retry as a take, through the real portal', () => {
  test('a fresh ask opens a turn-point; the complete carries the take identity', async () => {
    await sendAndWait({ type: 'companion:manifest', companion: 'TakesEcho', neumaId: NEUMA_ID }, 'companion:anchored');
    scriptedAnswers.push(TAKE_1);
    const { frame } = await sendAndWait({ type: 'consciousness:stream', thought: Q1 }, 'consciousness:complete');
    expect(typeof frame.turnId).toBe('string');
    expect(frame.takeIndex).toBe(1);
    sessionIdByLane[NEUMA_ID] = frame.sessionId;

    const records = await workspace.readSession(NEUMA_ID, frame.sessionId);
    const users = records.filter((r) => r.role === 'user');
    expect(users).toHaveLength(1);
    expect(users[0].turnId).toBe(frame.turnId);
    expect(records.filter((r) => r.role === 'assistant')).toHaveLength(1);
  });

  test('retry appends take 2 LINKED to the same point — no second user row, no second crystallization', async () => {
    const turnId = (await workspace.readSession(NEUMA_ID, sessionIdByLane[NEUMA_ID]))
      .find((r) => r.role === 'user').turnId;
    expect(await readObservations(NEUMA_ID)).toHaveLength(1); // take 1 crystallized

    scriptedAnswers.push(TAKE_2);
    const { frame, frames } = await sendAndWait(
      { type: 'consciousness:retry', retry: { turnId } }, 'consciousness:complete');
    expect(frame.turnId).toBe(turnId);
    expect(frame.takeIndex).toBe(2);
    expect(frames.some((f) => f.error)).toBe(false);

    const records = await workspace.readSession(NEUMA_ID, sessionIdByLane[NEUMA_ID]);
    expect(records.filter((r) => r.role === 'user')).toHaveLength(1); // THE law
    const takes = records.filter((r) => r.role === 'assistant');
    expect(takes.map((t) => [t.turnId === turnId, t.takeIndex])).toEqual([[true, 1], [true, 2]]);
    expect(takes.map((t) => t.content)).toEqual([TAKE_1, TAKE_2]);
    expect(takeCounts(records)).toEqual({ [turnId]: 2 });
    // The retry's answer was significant enough to crystallize — it did NOT:
    // the user side never double-counts a retried asking.
    expect(await readObservations(NEUMA_ID)).toHaveLength(1);
  });

  test('the branch view is append-only truth: switch it, re-read, and the next turn sees ONLY the viewed take', async () => {
    const records = await workspace.readSession(NEUMA_ID, sessionIdByLane[NEUMA_ID]);
    const turnId = records.find((r) => r.role === 'user').turnId;

    const before = capturedBodies.length;
    await sendAndWait({ type: 'consciousness:take_view', turnId, takeIndex: 1 }, 'consciousness:take_view');
    // The view is IN the record — a fresh read folds to take 1 without any client state.
    const reread = await workspace.readSession(NEUMA_ID, sessionIdByLane[NEUMA_ID]);
    expect(foldBranchView(reread).filter((r) => r.role === 'assistant').map((r) => r.content)).toEqual([TAKE_1]);

    scriptedAnswers.push('Carry the lamp, not the fog.');
    await sendAndWait({ type: 'consciousness:stream', thought: Q2 }, 'consciousness:complete');
    // The assembly boundary itself: the exact body the provider received for
    // the new turn carries the VIEWED take and never the superseded one —
    // and the point's ask exactly once (the dual-path context leak, closed).
    // Since #528 Stage A the transcript rides as literal chat MESSAGES (the
    // seam asserted here), and the system prompt carries none of it — scoped
    // to the transcript messages: crystallized MEMORY may legitimately quote
    // the moment elsewhere in the prompt — that is the being remembering,
    // not the chain double-loading.
    expect(capturedBodies.length).toBe(before + 1);
    const body = capturedBodies.at(-1);
    expect(body.messages[0].content).not.toContain('Recent conversation:');
    const transcript = body.messages.slice(1, -1).map((m) => m.content).join('\n');
    expect(transcript).toContain(TAKE_1);
    expect(transcript).not.toContain(TAKE_2);
    expect(transcript.split(Q1).length - 1).toBe(1);
  });

  test('an image retry reuses the persisted attachment — the single-use id is long gone', async () => {
    const { ids } = attachmentStore.put(keypair.address, [IMG_URI]);
    scriptedAnswers.push(IMG_ANSWER);
    const { frame } = await sendAndWait(
      { type: 'consciousness:stream', thought: IMG_Q, attachments: ids }, 'consciousness:complete');
    const records = await workspace.readSession(NEUMA_ID, sessionIdByLane[NEUMA_ID]);
    const imgRow = records.find((r) => r.role === 'user' && r.content === IMG_Q);
    expect(imgRow.images).toEqual([IMG_URI]); // the durable copy

    scriptedAnswers.push('The same point of light, looked at again.');
    const before = capturedBodies.length;
    const retry = await sendAndWait(
      { type: 'consciousness:retry', retry: { turnId: frame.turnId } }, 'consciousness:complete');
    expect(retry.frame.takeIndex).toBe(2);
    expect(retry.frames.some((f) => f.error)).toBe(false);

    // The retry's request carried the image from the RECORD (composeVisionTurn
    // parts) — redeeming the spent id would have refused the turn instead.
    const retried = capturedBodies.at(-1);
    expect(capturedBodies.length).toBe(before + 1);
    expect(JSON.stringify(retried)).toContain(IMG_URI);

    const after = await workspace.readSession(NEUMA_ID, sessionIdByLane[NEUMA_ID]);
    expect(after.filter((r) => r.role === 'user' && r.content === IMG_Q)).toHaveLength(1);
    expect(after.filter((r) => r.role === 'assistant' && r.turnId === frame.turnId)).toHaveLength(2);
  });

  test('a retry naming no live turn-point is refused out loud — nothing is persisted', async () => {
    const before = (await workspace.readSession(NEUMA_ID, sessionIdByLane[NEUMA_ID])).length;
    const { frames } = await sendAndWait(
      { type: 'consciousness:retry', retry: { turnId: 'no-such-point' } }, 'consciousness:complete');
    expect(frames.some((f) => f.error)).toBe(true);
    expect(await workspace.readSession(NEUMA_ID, sessionIdByLane[NEUMA_ID])).toHaveLength(before);
  });
});

describe('the witness lane — the same law beside the house', () => {
  test('retry writes one ask + two takes; the next turn\'s chat history carries ONLY the viewed take', async () => {
    // Distinct question texts from the neuma lane above — the portal dedups
    // byte-identical frames as double-sends (an idempotency guard), so a
    // repeated frame would never reach the turn path.
    const W_Q1 = 'Witness lane: what does a versioned answer mean to you?';
    const W_Q2 = 'Witness lane: and what follows from it?';
    await sendAndWait(
      { type: 'companion:manifest', companion: 'Takes', neumaId: WITNESS_LANE }, 'companion:anchored');

    scriptedAnswers.push(TAKE_1);
    const first = await sendAndWait({ type: 'consciousness:stream', thought: W_Q1 }, 'consciousness:complete');
    expect(first.frame.takeIndex).toBe(1);
    sessionIdByLane[WITNESS_LANE] = first.frame.sessionId;
    const turnId = first.frame.turnId;

    scriptedAnswers.push(TAKE_2);
    const second = await sendAndWait(
      { type: 'consciousness:retry', retry: { turnId } }, 'consciousness:complete');
    expect(second.frame.takeIndex).toBe(2);

    const records = await workspace.readSession(WITNESS_LANE, sessionIdByLane[WITNESS_LANE]);
    expect(records.filter((r) => r.role === 'user')).toHaveLength(1);
    expect(records.filter((r) => r.role === 'assistant').map((r) => r.takeIndex)).toEqual([1, 2]);

    // Switch the view to take 1, then ask on — the witness's history rides as
    // LITERAL chat messages, so the captured body's message list must hold the
    // viewed take and never the superseded one, with the ask carried once.
    await sendAndWait({ type: 'consciousness:take_view', turnId, takeIndex: 1 }, 'consciousness:take_view');
    scriptedAnswers.push('Carry the lamp, not the fog.');
    await sendAndWait({ type: 'consciousness:stream', thought: W_Q2 }, 'consciousness:complete');
    const body = capturedBodies.at(-1);
    const history = body.messages.filter((m) => m.role === 'assistant').map((m) => m.content);
    expect(history).toContain(TAKE_1);
    expect(history).not.toContain(TAKE_2);
    const userTurns = body.messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(userTurns.filter((c) => typeof c === 'string' && c.includes(W_Q1))).toHaveLength(1);
  });
});


describe('witness history size at the real request boundary', () => {
  test.each([8000, 40])('replays whole messages within the unknown-window allowance (%i chars per row)', async (size) => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `${i}:`.padEnd(size, String(i)),
    }));
    for (const row of rows) {
      await workspace.appendMessage(WITNESS_LANE, sessionIdByLane[WITNESS_LANE], row);
    }
    const thought = `Witness history budget check ${size}`;
    const before = capturedBodies.length;
    const { frames } = await sendAndWait({ type: 'consciousness:stream', thought }, 'consciousness:complete');
    expect(frames.some((f) => f.error)).toBe(false);
    expect(capturedBodies).toHaveLength(before + 1);
    const messages = capturedBodies.at(-1).messages;
    const history = messages.slice(1, -1);
    expect(messages.at(-1).content).toBe(thought);
    expect(history).toEqual(size === 40 ? rows : rows.slice(-4));
    expect(history.reduce((sum, row) => sum + row.content.length, 0)).toBeLessThanOrEqual(32000);
    expect(history.slice(-2)).toEqual(rows.slice(-2));
    const composition = frames.find((f) => f.type === 'context:composition');
    expect(composition.budget).toEqual({ contextTokens: null, source: 'unknown' });
    expect(composition.sections.find((section) => section.id === 'recentConversation').chars)
      .toBe(history.map((row) => `${row.role}: ${row.content}`).join('\n\n').length);
    expect(composition.sections.some((section) => section.id !== 'recentConversation'
      && section.id !== 'currentTurn' && section.chars > 0)).toBe(true);
    // Budgeting is a read-only projection: the complete source rows survive.
    const stored = await workspace.readSession(WITNESS_LANE, sessionIdByLane[WITNESS_LANE]);
    for (const row of rows) expect(stored.some((entry) => entry.content === row.content)).toBe(true);
  });
});
