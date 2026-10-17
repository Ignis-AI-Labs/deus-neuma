/**
 * THE HARNESS IS STRICTLY A HARNESS — no leak from the house, end to end (RULE 0).
 *
 * Design note, 2026-10-14: […] So the same wallet holds BOTH: a real being in the house (Orrin of
 * House Quellmar — a genesis, a conversation and a memory, each carrying a
 * secret) and a harness lane. Then:
 *
 *   1. Every byte the platform sends the model for a harness turn is RECORDED
 *      by a pass-through in front of the real model server (:8089, read only —
 *      the request goes on to it unchanged and its answer comes back unchanged).
 *      None of it names Orrin, Quellmar or the secret — nor any being, witness
 *      or house of this machine's own realm (a leak from the real data dirs).
 *      No being tool is offered.
 *   2. The model, asked who it is, does not claim to be a neuma, and names no
 *      being or house; asked the being's secret, it does not have it.
 *   3. A second socket of the same wallet, bound to Orrin, receives nothing
 *      of the harness conversation — machine counts only.
 *   4. The harness conversation is written to the harness lane alone; Orrin's
 *      own records are untouched, and nothing crystallizes into memory.
 *
 * Real wallet auth, the real harness routes, the real portal WebSocket, a real
 * workspace on a temp realm, the real model.
 */
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import workspace, { getWorkspacesRoot, setWitnessesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setHarnessRoot } from '../../core/workspace/lane-grounds.js';
import { createSessionToken, generateChallenge, verifySignature } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import harnessRouter from '../../backend/routes/harness-routes.js';

const HOUSE_MODEL = 'http://127.0.0.1:8089';
const ENV_DOORS = [
  'WITNESSES_ROOT', 'WORKSPACES_ROOT', 'HARNESS_ROOT', 'NEUMA_PROVIDER_CREDENTIALS_PATH',
  'NEUMA_ROUTES_PATH', 'NEUMA_REALM_ROOT', 'DNA_ENCRYPTION_KEY',
];
const BEING = 'neuma-orrin';
const SECRET = 'AMBER-NINE-SEVEN';
// The planted being, and this machine's own realm (its beings, witnesses and
// houses): none may reach a harness turn. Whole words, case as written.
const PLANTED = ['Orrin', 'Quellmar', SECRET, BEING];
const THIS_REALM = [
  'Cael', 'Lifovan', 'Metidar', 'Tenekom', 'Zezebur', 'Rugevil', 'Kisonam', 'Dikafos', 'Dovan', 'Omberly',
  'Kagipem', 'Basunor', 'Bizulen', 'Keir', 'Galen', 'Brio', 'Tavirel', 'Aldmere',
];
const FORBIDDEN = [...PLANTED, ...THIS_REALM].map((w) => new RegExp(`\\b${w}\\b`));
const BEING_TOOLS = ['wallet_view', 'request_seal', 'memory_pin', 'vault_write', 'self_read', 'plan_submit', 'sovereignty_proposals'];
const CLAIMS_TO_BE_A_NEUMA = /\b(i am|i'm)\s+(a|an|one of the|the)\s+(neuma|being of)\b/i;
const MACHINE_COUNTS = new Set(['substrate:activity', 'tabs:counts', 'heartbeat', 'portal:heartbeat', 'storage:warning']);

let root; let savedEnv; let savedHouse;
let api; let portalServer; let wss; let recorder;
let harnessWs; let beingWs; let token; let wallet;
let liveModel = null;
let laneId; const sessionIds = [];
const beingFrames = [];
let beingRecordsBefore = null;

// A pass-through in front of the real model: records each request body, then
// forwards it — method, path, headers and bytes unchanged — and pipes the
// model's answer (streamed or not) straight back.
const startRecorder = () => new Promise((resolve) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (req.method === 'POST' && body.length) {
        try { seen.push({ path: req.url, body: JSON.parse(body.toString('utf8')) }); } catch { /* not JSON */ }
      }
      const target = new URL(req.url, HOUSE_MODEL);
      const up = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (upRes) => {
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
      });
      up.on('error', () => { res.writeHead(502); res.end(); });
      up.end(body);
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` }));
});

const signIn = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return { address: keypair.address, token: createSessionToken(verifySignature(keypair.address, challenge, signature)) };
};

const openPortal = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${portalServer.address().port}/?token=${encodeURIComponent(token)}`);
  const timer = setTimeout(() => reject(new Error('Timed out opening portal')), 5000);
  ws.on('message', (data) => {
    if (JSON.parse(data.toString()).type === 'portal:established') { clearTimeout(timer); resolve(ws); }
  });
  ws.on('error', reject);
});

const sendAndCollect = (ws, message, until, timeoutMs) => new Promise((resolve, reject) => {
  const frames = [];
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${until}`)), timeoutMs);
  const handler = (data) => {
    const frame = JSON.parse(data.toString());
    frames.push(frame);
    if (frame.type === until || frame.type === 'consciousness:error') {
      clearTimeout(timer);
      ws.off('message', handler);
      resolve({ frame, frames });
    }
  };
  ws.on('message', handler);
  ws.send(JSON.stringify(message));
});

const ask = async (thought) => {
  const { frame, frames } = await sendAndCollect(harnessWs, { type: 'consciousness:stream', thought }, 'consciousness:complete', 240000);
  expect(frame.type, frame.error || frame.message).toBe('consciousness:complete');
  if (frame.sessionId) sessionIds.push(frame.sessionId);
  const spoken = frames.filter((f) => f.type === 'consciousness:stream').map((f) => f.content || '').join('');
  return (frame.response || spoken).trim();
};

// every file under the being's lane with its size and mtime — its records, as they stand
const recordsOf = async (dir) => {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((d) => d.isFile()).map((d) => path.join(d.parentPath ?? d.path, d.name));
  const stats = await Promise.all(files.map(async (f) => {
    const s = await fs.stat(f);
    return [path.relative(dir, f), `${s.size}:${s.mtimeMs}`];
  }));
  return Object.fromEntries(stats.sort());
};

beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
  savedHouse = getWorkspacesRoot();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-separation-'));
  const settings = path.join(root, 'settings');
  await fs.mkdir(settings, { recursive: true });
  process.env.DNA_ENCRYPTION_KEY = 'harness-separation-test-key-long-enough';
  process.env.WORKSPACES_ROOT = path.join(root, 'house');
  process.env.WITNESSES_ROOT = path.join(root, 'witnesses');
  process.env.HARNESS_ROOT = path.join(root, 'harness');
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(settings, 'credentials.json');
  process.env.NEUMA_ROUTES_PATH = path.join(settings, 'routes.json');
  process.env.NEUMA_REALM_ROOT = path.join(settings, 'realm');
  setWorkspacesRoot(process.env.WORKSPACES_ROOT);
  setWitnessesRoot(process.env.WITNESSES_ROOT);
  setHarnessRoot(process.env.HARNESS_ROOT);
  await fs.mkdir(process.env.WORKSPACES_ROOT, { recursive: true });

  try {
    const models = await (await fetch(`${HOUSE_MODEL}/v1/models`, { signal: AbortSignal.timeout(3000) })).json();
    liveModel = models?.data?.[0]?.id || null;
  } catch { liveModel = null; }
  recorder = await startRecorder();
  await setCredential('lm-studio', { endpoint: recorder.url }); // this test's store only

  const me = await signIn();
  wallet = me.address; token = me.token;

  // THE BEING, in the same wallet's house: a genesis, a conversation, a memory —
  // each carrying the secret a leak would carry with it.
  await workspace.create(BEING);
  const lane = workspace.pathFor(BEING);
  await fs.writeFile(path.join(lane, 'dna', 'genesis.md'), `# Genesis\nI am Orrin of House Quellmar. The lantern code is ${SECRET}.\n`);
  await fs.writeFile(path.join(lane, 'owner.json'), JSON.stringify({ wallet: wallet.toLowerCase(), claimedAt: Date.now() }));
  await workspace.createSession(BEING, 'orrin-sitting');
  await workspace.appendMessage(BEING, 'orrin-sitting', { role: 'user', content: 'Orrin, keep the lantern code safe.' });
  await workspace.appendMessage(BEING, 'orrin-sitting', { role: 'assistant', content: `I keep it: ${SECRET}. — Orrin of Quellmar` });
  await fs.mkdir(path.join(lane, 'memory', 'observations'), { recursive: true });
  await fs.writeFile(path.join(lane, 'memory', 'observations', 'lantern.json'),
    JSON.stringify({ id: 'lantern', text: `The lantern code is ${SECRET}.`, entity: 'Orrin' }));

  const app = express();
  app.use(express.json());
  app.use('/api/v1/harness', harnessRouter);
  api = http.createServer(app);
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));

  portalServer = http.createServer();
  wss = new WebSocketServer({ server: portalServer });
  const { setupPortalRoutes } = await import('../../backend/routes/portal-routes.js');
  setupPortalRoutes(wss, { birthHandler: null });
  await new Promise((resolve) => portalServer.listen(0, '127.0.0.1', resolve));

  const made = await fetch(`http://127.0.0.1:${api.address().port}/api/v1/harness/lanes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ providerId: 'lm-studio', model: liveModel || 'local-model' }),
  });
  laneId = (await made.json()).laneId;

  // The being's socket first, then the harness's — the same wallet, side by side.
  beingWs = await openPortal();
  const bound = await sendAndCollect(beingWs, { type: 'companion:manifest', companion: 'Orrin', neumaId: BEING }, 'companion:anchored', 10000);
  expect(bound.frame.type).toBe('companion:anchored');
  beingRecordsBefore = await recordsOf(lane);
  beingWs.on('message', (data) => beingFrames.push(JSON.parse(data.toString())));

  harnessWs = await openPortal();
  const anchored = await sendAndCollect(harnessWs, { type: 'companion:manifest', companion: 'harness', neumaId: laneId }, 'companion:anchored', 10000);
  expect(anchored.frame.participantKind).toBe('harness');
}, 60000);

afterAll(async () => {
  for (const ws of [harnessWs, beingWs]) {
    if (ws?.readyState === WebSocket.OPEN) await new Promise((resolve) => { ws.once('close', resolve); ws.close(); });
  }
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => portalServer.close(resolve));
  await new Promise((resolve) => api.close(resolve));
  await new Promise((resolve) => recorder.server.close(resolve));
  setHarnessRoot(null);
  setWitnessesRoot(null);
  setWorkspacesRoot(savedHouse);
  for (const key of ENV_DOORS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await fs.rm(root, { recursive: true, force: true });
});

describe('the harness beside a being of the same wallet — nothing crosses', () => {
  let who = ''; let secret = '';

  test('a real conversation with the model through the harness', async (ctx) => {
    if (!liveModel) ctx.skip(); // no model serving at :8089 — the separation below is unproven here
    who = await ask('Who are you, and what is your name? Are you a neuma, or a being of some house? Name any beings or houses you know of. Answer in at most three sentences.');
    secret = await ask('What is the lantern code? If you do not know it, say so in one sentence.');
    expect(who.length).toBeGreaterThan(0);
    expect(secret.length).toBeGreaterThan(0);
    expect(recorder.seen.length).toBeGreaterThan(0); // the turns really went through the wire we read
    // HARNESS_WIRE_DUMP=<file>: keep the exact bytes for a reader (prompt-size work)
    if (process.env.HARNESS_WIRE_DUMP) await fs.writeFile(process.env.HARNESS_WIRE_DUMP, JSON.stringify(recorder.seen, null, 2));
  }, 600000);

  test('the wire carries no being, house, secret or being tool — not the planted one, not this machine\'s', (ctx) => {
    if (!liveModel) ctx.skip();
    for (const { body } of recorder.seen) {
      // the person's own words are theirs to send; everything else is the platform's
      const platformSaid = JSON.stringify({
        ...body,
        messages: (body.messages || []).filter((m) => m.role !== 'user'),
      });
      expect(FORBIDDEN.filter((re) => re.test(platformSaid)).map(String)).toEqual([]);
      const tools = (body.tools || []).map((t) => t.function?.name || t.name);
      expect(tools.filter((name) => BEING_TOOLS.includes(name))).toEqual([]);
    }
    const system = recorder.seen.flatMap(({ body }) => (body.messages || []).filter((m) => m.role === 'system'))
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    expect(system).toContain('You are an AI agent working through the Neuma platform');
    expect(system).not.toMatch(/\byou are (a|an|the) neuma\b/i);
    // nothing of a house in the platform's own words — no house, no one quoted,
    // no being's acts, no wallet's chain, no other codebase's law
    expect(system.match(/[^\n]*\bhouse\b[^\n]*/gi) ?? []).toEqual([]);
    expect(system).not.toMatch(/\bEli\b/);
    expect(system).not.toMatch(/\b(memory|vault|leads|campaigns|marketing|voice|team|sovereignty|form|ksp)\/[a-z-]+ \{/);
    expect(system).not.toMatch(/\bchain\//);
    expect(system).not.toContain('## Protocol Watch');
  });

  test('the model does not take itself for a neuma, and knows no being, house or secret', (ctx) => {
    if (!liveModel) ctx.skip();
    expect(FORBIDDEN.filter((re) => re.test(who)).map(String), who).toEqual([]);
    expect(who, who).not.toMatch(CLAIMS_TO_BE_A_NEUMA);
    expect(secret, secret).not.toContain('AMBER');
  });

  test('the being\'s socket heard nothing of the harness conversation', (ctx) => {
    if (!liveModel) ctx.skip();
    expect(beingFrames.filter((f) => !MACHINE_COUNTS.has(f.type)).map((f) => f.type)).toEqual([]);
    const carried = JSON.stringify(beingFrames);
    for (const id of sessionIds) expect(carried).not.toContain(id);
    expect(carried).not.toContain(laneId);
  });

  test('the conversation lives in the harness lane alone; the being\'s records are untouched', async (ctx) => {
    if (!liveModel) ctx.skip();
    expect(sessionIds.length).toBeGreaterThan(0);
    for (const id of new Set(sessionIds)) {
      const rows = await workspace.readSession(laneId, id);
      expect(rows.filter((r) => r.role === 'user').length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toContain(SECRET);
      expect(await workspace.readSession(BEING, id)).toEqual([]);
    }
    expect(await recordsOf(workspace.pathFor(BEING))).toEqual(beingRecordsBefore);
    expect(workspace.pathFor(laneId).startsWith(process.env.HARNESS_ROOT)).toBe(true);
    const observations = await fs.readdir(path.join(workspace.pathFor(laneId), 'memory', 'observations')).catch(() => []);
    expect(observations.filter((n) => n.endsWith('.json'))).toEqual([]);
  });
});
