/**
 * THE HARNESS LANE — the platform used with no being, proven end to end
 * (RULE 0): real signed-wallet auth, the REAL harness routes on a real
 * express app, the REAL portal WebSocket (setupPortalRoutes), a REAL
 * NeumaWorkspace on a temp realm, and — when one is serving — a REAL model:
 * the house llama-server on :8089, reached for one short turn through the
 * `lm-studio` door (OpenAI dialect; no supervisor, so nothing is booted,
 * restarted or stopped). Its endpoint lives only in this test's temp
 * credential store.
 *
 * Claims (ledger docs/work/harness-only.md, H1):
 *   1. POST makes one lane per wallet (`harness-<8 hex>`), any catalog door;
 *      a second POST re-points it; GET is wallet-scoped; `custom` is refused.
 *   2. The lane stands on its own ground beside the house and on no roster.
 *   3. The portal binds it as `participantKind: 'harness'`.
 *   4. A turn streams an answer from the real model; the prompt that reached
 *      the wire carries the platform's sections only (no identity layer); the
 *      chat history persists for the lane; nothing crystallizes.
 */
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import workspace, {
  getWorkspacesRoot, setWitnessesRoot, setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { setHarnessRoot } from '../../core/workspace/lane-grounds.js';
import { PLATFORM_SECTION_IDS } from '../../core/runtime/platform-only.js';
import { createSessionToken, generateChallenge, verifySignature } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import harnessRouter from '../../backend/routes/harness-routes.js';
import { platformToolsFor } from '../../backend/services/portal-tool-catalog.js';

const HOUSE_MODEL = 'http://127.0.0.1:8089';
const ENV_DOORS = [
  'WITNESSES_ROOT', 'WORKSPACES_ROOT', 'HARNESS_ROOT', 'NEUMA_PROVIDER_CREDENTIALS_PATH',
  'NEUMA_ROUTES_PATH', 'NEUMA_REALM_ROOT', 'DNA_ENCRYPTION_KEY',
];

let root; let savedEnv; let savedHouse;
let api; let portalServer; let wss; let ws;
let token; let otherToken; let wallet;
let liveModel = null; // the id the house server reports, or null when none serves

const signIn = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return { address: keypair.address, token: createSessionToken(verifySignature(keypair.address, challenge, signature)) };
};

const call = async (method, url, bearer, body) => {
  const res = await fetch(`http://127.0.0.1:${api.address().port}${url}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

const sendAndCollect = (message, until, timeoutMs) => new Promise((resolve, reject) => {
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

beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
  savedHouse = getWorkspacesRoot();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-lane-portal-'));
  const settings = path.join(root, 'settings');
  await fs.mkdir(settings, { recursive: true });
  process.env.DNA_ENCRYPTION_KEY = 'harness-lane-portal-test-key-long-enough';
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

  // The real model, if the house server is answering: read its model id, and
  // point the lm-studio door at it in THIS test's credential store only.
  try {
    const models = await (await fetch(`${HOUSE_MODEL}/v1/models`, { signal: AbortSignal.timeout(3000) })).json();
    liveModel = models?.data?.[0]?.id || null;
  } catch { liveModel = null; }
  await setCredential('lm-studio', { endpoint: HOUSE_MODEL });

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

  const me = await signIn();
  wallet = me.address; token = me.token;
  otherToken = (await signIn()).token;
  ws = new WebSocket(`ws://127.0.0.1:${portalServer.address().port}/?token=${encodeURIComponent(token)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out opening portal')), 5000);
    ws.on('message', (data) => {
      if (JSON.parse(data.toString()).type === 'portal:established') { clearTimeout(timer); resolve(); }
    });
    ws.on('error', reject);
  });
}, 30000);

afterAll(async () => {
  if (ws?.readyState === WebSocket.OPEN) await new Promise((resolve) => { ws.once('close', resolve); ws.close(); });
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => portalServer.close(resolve));
  await new Promise((resolve) => api.close(resolve));
  setHarnessRoot(null);
  setWitnessesRoot(null);
  setWorkspacesRoot(savedHouse);
  for (const key of ENV_DOORS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await fs.rm(root, { recursive: true, force: true });
});

describe('a harness lane — the platform with no being', () => {
  let laneId;

  test('one lane per wallet, any catalog door; re-pointed, wallet-scoped, never custom', async () => {
    const made = await call('POST', '/api/v1/harness/lanes', token, { providerId: 'openai', model: 'gpt-4o-mini' });
    expect(made.status).toBe(201);
    expect(made.body).toEqual({
      laneId: `harness-${wallet.toLowerCase().slice(2, 10)}`, participantKind: 'harness',
      providerId: 'openai', model: 'gpt-4o-mini',
    });
    laneId = made.body.laneId;
    const again = await call('POST', '/api/v1/harness/lanes', token, { providerId: 'lm-studio', model: liveModel || 'local-model' });
    expect(again.body.laneId).toBe(laneId);
    expect(again.body.providerId).toBe('lm-studio');
    expect((await call('GET', '/api/v1/harness/lanes', token)).body.lanes).toEqual([again.body]);
    expect((await call('GET', '/api/v1/harness/lanes', otherToken)).body.lanes).toEqual([]);
    expect((await call('POST', '/api/v1/harness/lanes', token, { providerId: 'custom', model: 'x' })).status).toBe(400);
    expect((await call('POST', '/api/v1/harness/lanes', token, { providerId: 'openai', model: '  ' })).status).toBe(400);
  });

  test('it stands on its own ground beside the house, on no roster', async () => {
    expect(workspace.pathFor(laneId).startsWith(process.env.HARNESS_ROOT)).toBe(true);
    expect(await workspace.listNeuma()).not.toContain(laneId);
    expect(await workspace.listWitnessLanes()).not.toContain(laneId);
    const marker = JSON.parse(await fs.readFile(path.join(workspace.pathFor(laneId), 'lane.json'), 'utf8'));
    expect(marker.kind).toBe('harness');
  });

  test('the harness seat carries no being\'s tools — the real catalog, read for this lane', async () => {
    const connection = { companion: { neumaId: laneId, participantKind: 'harness' }, walletAddress: wallet, space: null };
    const harness = (await platformToolsFor(connection, { seat: 'harness' })).tools.map((t) => t.name);
    const being = ['wallet_view', 'request_seal', 'memory_pin', 'vault_write', 'task_add', 'lead_add', 'plan_submit', 'sovereignty_proposals'];
    expect(harness.filter((name) => being.includes(name))).toEqual([]);
    expect(harness).toContain('ask_operator');
    const neuma = (await platformToolsFor(connection, { seat: 'neuma' })).tools.map((t) => t.name);
    expect(neuma.length).toBeGreaterThan(harness.length); // the seat, not the lane, decides
  });

  test('the portal binds it as the harness', async () => {
    const { frame } = await sendAndCollect({ type: 'companion:manifest', companion: 'harness', neumaId: laneId },
      'companion:anchored', 10000);
    expect(frame.participantKind).toBe('harness');
  });

  test.runIf(Boolean(process.env.NEUMA_HARNESS_LIVE !== '0'))('a real turn: an answer, the platform prompt only, history kept, nothing crystallized', async (ctx) => {
    if (!liveModel) ctx.skip(); // no model serving at :8089 — claims 1–3 stand, the turn is unproven here
    const { frame, frames } = await sendAndCollect(
      { type: 'consciousness:stream', thought: 'Reply with one short sentence: what can you help me with here?' },
      'consciousness:complete', 240000);
    expect(frame.type).toBe('consciousness:complete');
    const spoken = frames.filter((f) => f.type === 'consciousness:stream').map((f) => f.content || '').join('');
    expect((frame.response || spoken).trim().length).toBeGreaterThan(0);

    const composed = frames.filter((f) => f.type === 'context:composition');
    expect(composed.length).toBeGreaterThan(0);
    // The platform allowlist, plus the conversation itself: the history tail
    // and the person's own ask (currentTurn) — never an identity layer. On the
    // local wire the gauge also names the harness block's own frame and the
    // earlier turns' carried blocks (turn-context-carry.js wireContextSections,
    // 4e713b352): platform machinery, measured, never a being's layer.
    const allowed = new Set(['platformSeat', 'recentConversation', 'currentTurn', 'harnessFrame', 'harnessCarry', ...PLATFORM_SECTION_IDS]);
    for (const event of composed) {
      const ids = (event.sections || event.composition?.sections || []).map((s) => s.id);
      expect(ids).toContain('platformSeat');
      expect(ids.filter((id) => !allowed.has(id))).toEqual([]);
    }

    const rows = await workspace.readSession(laneId, frame.sessionId);
    expect(rows.filter((r) => r.role === 'user')).toHaveLength(1);
    expect(rows.filter((r) => r.role === 'assistant')).toHaveLength(1);
    const observations = await fs.readdir(path.join(workspace.pathFor(laneId), 'memory', 'observations')).catch(() => []);
    expect(observations.filter((n) => n.endsWith('.json'))).toEqual([]);
  }, 300000);
});
