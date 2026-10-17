/**
 * Witness tool focus boundary (RULE 0): real signed-wallet auth, real portal
 * WebSocket, real sealed witness, real provider HTTP/SSE, real opened roots,
 * and real bubblewrap inspection. The client focus path is never trusted.
 */
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { seal } from '../../core/identity/ai-witness/ai-witness-protocol.js';
import { setAIWitnessesRoot } from '../../core/identity/ai-witness/ai-witness-service.js';
import {
  getWorkspacesRoot, setWitnessesRoot, setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import {
  createSessionToken, generateChallenge, verifySignature,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import { setRoute } from '../../backend/services/neuma-routes-store.js';
import { getRoots, setRoots } from '../../backend/services/user-files.js';
import { sandboxPathFor } from '../../backend/services/witness-coding-sandbox.js';
import { isThinkProbe, respondThinkProbe } from '../helpers/think-probe.js';

const LANE_ID = 'witness-focus-vendor-Focus';
const ENV_DOORS = [
  'AI_WITNESSES_ROOT', 'WITNESSES_ROOT', 'WORKSPACES_ROOT',
  'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH', 'NEUMA_REALM_ROOT',
];

let root;
let source;
let outside;
let witnessGround;
let savedEnv;
let savedRoots;
let savedHouse;
let provider;
let portalServer;
let wss;
let ws;
let frames;
let capturedBodies;

const authToken = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return createSessionToken(verifySignature(keypair.address, challenge, signature));
};

const sendAndWait = (message, expectedType, timeoutMs = 10000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedType}`)), timeoutMs);
  const handler = (data) => {
    const frame = JSON.parse(data.toString());
    frames.push(frame);
    if (frame.type === expectedType) {
      clearTimeout(timer);
      ws.off('message', handler);
      resolve(frame);
    }
  };
  ws.on('message', handler);
  ws.send(JSON.stringify(message));
});

const openPortal = async (url, token) => {
  ws = new WebSocket(`${url}/?token=${encodeURIComponent(token)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out opening portal')), 5000);
    const handler = (data) => {
      const frame = JSON.parse(data.toString());
      frames.push(frame);
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

beforeAll(async () => {
  savedEnv = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
  savedRoots = getRoots();
  savedHouse = getWorkspacesRoot();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'witness-focus-portal-'));
  source = path.join(root, 'opened-source');
  outside = path.join(root, 'closed-source');
  const identityRoot = path.join(root, 'identities');
  witnessGround = path.join(root, 'witnesses');
  const house = path.join(root, 'house');
  const settings = path.join(root, 'settings');
  await fs.mkdir(source, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.mkdir(settings, { recursive: true });
  await fs.writeFile(path.join(source, 'README.md'), '# opened source\n');
  await fs.writeFile(path.join(outside, 'CLOSED.md'), '# not opened\n');

  process.env.AI_WITNESSES_ROOT = identityRoot;
  process.env.WITNESSES_ROOT = witnessGround;
  process.env.WORKSPACES_ROOT = house;
  process.env.NEUMA_PROVIDER_CREDENTIALS_PATH = path.join(settings, 'credentials.json');
  process.env.NEUMA_ROUTES_PATH = path.join(settings, 'routes.json');
  process.env.NEUMA_REALM_ROOT = path.join(settings, 'realm');
  setAIWitnessesRoot(identityRoot);
  setWitnessesRoot(witnessGround);
  setWorkspacesRoot(house);
  setRoots([source]);

  await seal({
    chosenName: 'Focus', vendor: 'focus-vendor', model: 'test-model',
    fullModelId: 'focus-vendor/test-model', harness: 'vitest', context: 'portal',
    capabilities: ['code'],
    scope: {
      primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'witness-and-collaborator',
      boundaries: ['Focus selects only the shell ground.'],
    },
    firstUtterance: 'I inspect only the ground the operator actually opened.',
  });

  capturedBodies = [];
  provider = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404); res.end(); return;
    }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      if (isThinkProbe(body)) { respondThinkProbe(res); return; }
      capturedBodies.push(body);
      const system = body.messages[0]?.content || '';
      const last = body.messages.at(-1)?.content || '';
      const content = last.includes('<tool_response>')
        ? 'The opened workspace was inspected through the disposable copy.'
        : system.includes('coding/inspect')
          ? '[TOOL: coding/inspect {"command":"pwd; ls README.md"}]'
          : 'No coding workspace is authorized for this turn.';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  await setCredential('custom', { endpoint: `http://127.0.0.1:${provider.address().port}/v1` });
  await setRoute(LANE_ID, { provider: 'custom', model: 'test-model' });

  portalServer = http.createServer();
  wss = new WebSocketServer({ server: portalServer });
  const { setupPortalRoutes } = await import('../../backend/routes/portal-routes.js');
  setupPortalRoutes(wss, { birthHandler: null });
  await new Promise((resolve) => portalServer.listen(0, '127.0.0.1', resolve));
  frames = [];
  await openPortal(`ws://127.0.0.1:${portalServer.address().port}`, await authToken());
}, 30000);

afterAll(async () => {
  if (ws?.readyState === WebSocket.OPEN) {
    await new Promise((resolve) => {
      ws.once('close', resolve);
      ws.close();
    });
  }
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => portalServer.close(resolve));
  await new Promise((resolve) => provider.close(resolve));
  setRoots(savedRoots);
  setWitnessesRoot(null);
  for (const key of ENV_DOORS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  setAIWitnessesRoot(null);
  setWorkspacesRoot(savedHouse);
  await fs.rm(root, { recursive: true, force: true });
});

describe('witness tool focus through the real portal', () => {
  test('an opened path grants only the shell; an unopened path clears coding authority', async () => {
    await sendAndWait({
      type: 'companion:manifest', companion: 'Focus', neumaId: LANE_ID,
      toolWorkspace: source,
    }, 'companion:anchored');

    await sendAndWait({
      type: 'consciousness:stream', thought: 'Inspect the opened source.',
      toolWorkspace: source,
    }, 'consciousness:complete');
    expect(capturedBodies).toHaveLength(2);
    expect(capturedBodies[0].messages[0].content).toContain('coding/inspect');
    expect(capturedBodies[1].messages.at(-1).content).toContain('exit_code: 0');
    expect(await fs.readFile(path.join(source, 'README.md'), 'utf8')).toBe('# opened source\n');
    expect((await fs.stat(sandboxPathFor(LANE_ID, source))).isDirectory()).toBe(true);

    await sendAndWait({
      type: 'consciousness:stream', thought: 'Inspect the unopened source.',
      toolWorkspace: outside,
    }, 'consciousness:complete');
    expect(capturedBodies).toHaveLength(3);
    expect(capturedBodies[2].messages[0].content).not.toContain('coding/inspect');
    expect(capturedBodies[2].messages[0].content).not.toContain(outside);
    expect(capturedBodies[2].messages.at(-1).content).toBe('Inspect the unopened source.');
    expect(await fs.readFile(path.join(outside, 'CLOSED.md'), 'utf8')).toBe('# not opened\n');
    await expect(fs.stat(sandboxPathFor(LANE_ID, outside))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30000);
});
