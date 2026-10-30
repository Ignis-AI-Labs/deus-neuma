/**
 * The real portal a turn-pipeline suite drives (RULE 0): signed-wallet auth,
 * the REAL portal WebSocket (setupPortalRoutes), REAL NeumaWorkspaces on real
 * encrypted temp disk, beings with readable DNA, an optional REAL sealed
 * witness with its own lane, and ONE real loopback OpenAI-wire provider
 * (local-provider.js) that both lanes ride and that records every request.
 * The kit owns the plumbing only — every assertion lives in the suite.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { startLocalProvider } from './local-provider.js';
import { claimOwner } from './claim-owner.js';
import { makeInstallOwner } from './install-owner-kit.js';

const ENV_DOORS = [
  'AI_WITNESSES_ROOT', 'WITNESSES_ROOT', 'WORKSPACES_ROOT', 'NEUMA_PROVIDER_CREDENTIALS_PATH',
  'NEUMA_ROUTES_PATH', 'NEUMA_REALM_ROOT', 'DNA_ENCRYPTION_KEY', 'NEUMA_CMO_PATH', 'NEUMA_DATA_ROOT',
];
const MODEL = 'test-model';

/**
 * impure — one real portal socket under `token`, returned once the portal has
 * said it is established, with its frame log and the two waits a suite drives.
 */
const connectSocket = async (port, token) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
  const frames = [];
  ws.on('message', (data) => frames.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('portal never established')), 5000);
    const handler = (data) => {
      if (JSON.parse(data.toString()).type !== 'portal:established') return;
      clearTimeout(timer);
      ws.off('message', handler);
      resolve();
    };
    ws.on('message', handler);
    ws.on('error', reject);
  });

  /** impure — the first frame at or after `from` matching `pred`. */
  const untilFrame = (pred, { from = 0, ms = 15000 } = {}) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = frames.slice(from).find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('expected frame never arrived'));
      setTimeout(tick, 10);
    };
    tick();
  });
  /** impure — send one frame and wait for the first `type` frame it causes. */
  const sendAndWait = (message, type, ms) => {
    const from = frames.length;
    ws.send(JSON.stringify(message));
    return untilFrame((f) => f.type === type, { from, ms });
  };
  return { ws, frames, untilFrame, sendAndWait };
};

/**
 * impure — stand the portal up.
 * @param {{label: string, beings: Array<{id: string, name: string}>, witness?: boolean, contextLength?: number, respond?: Function}} spec
 *   `contextLength`: the window the provider reports (absent: assumed caps);
 *   `respond`: answer a completion from its own request body (local-provider.js)
 */
export const openPortalTurnKit = async ({ label, beings, witness = false, contextLength = null, respond = null }) => {
  const saved = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `${label}-`));
  const settings = path.join(root, 'settings');
  await fs.mkdir(settings, { recursive: true });
  Object.assign(process.env, {
    DNA_ENCRYPTION_KEY: `${label}-test-key-long-enough-for-aes`,
    AI_WITNESSES_ROOT: path.join(root, 'identities'),
    WITNESSES_ROOT: path.join(root, 'witnesses'),
    WORKSPACES_ROOT: path.join(root, 'house'),
    NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(settings, 'credentials.json'),
    NEUMA_ROUTES_PATH: path.join(settings, 'routes.json'),
    NEUMA_REALM_ROOT: path.join(settings, 'realm'),
    NEUMA_CMO_PATH: path.join(settings, 'cmo.json'),
    NEUMA_DATA_ROOT: path.join(root, 'data'),
  });
  const { setAIWitnessesRoot } = await import('../../core/identity/ai-witness/ai-witness-service.js');
  const { default: workspace, getWorkspacesRoot, setWitnessesRoot, setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
  const { getConfig, setConfig } = await import('../../backend/services/llm-provider.js');
  const savedHouse = getWorkspacesRoot();
  const savedConfig = getConfig();
  setAIWitnessesRoot(process.env.AI_WITNESSES_ROOT);
  setWitnessesRoot(process.env.WITNESSES_ROOT);
  setWorkspacesRoot(process.env.WORKSPACES_ROOT);

  for (const { id, name } of beings) {
    await workspace.create(id);
    await workspace.writeDNA(id, { version: '1.0.0', identity: { name, essence: `${name}, summoned for a turn proof.` } });
    // An inhabited lane: the ownership gate binds only a lane that carries a being.
    await fs.writeFile(path.join(workspace.pathFor(id), 'dna', 'genesis.md'), `# ${name}\n${name}, summoned for a turn proof.\n`);
  }

  const provider = await startLocalProvider({ reply: 'An answer.', contextLength, respond });
  setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, apiKey: '', model: MODEL });
  let witnessLane = null;
  if (witness) {
    const { seal } = await import('../../core/identity/ai-witness/ai-witness-protocol.js');
    const { witnessLaneId } = await import('../../backend/services/witness-lane.js');
    const { setCredential } = await import('../../backend/services/provider-credentials.js');
    const { setRoute } = await import('../../backend/services/neuma-routes-store.js');
    const { vendorSlug } = await seal({
      chosenName: 'Kit', vendor: 'kit-vendor', model: MODEL, fullModelId: `kit-vendor/${MODEL}`,
      harness: 'vitest', context: 'portal', capabilities: ['code'],
      scope: { primaryRepo: 'Ignis-AI-Labs/deus-neuma', role: 'witness-and-collaborator', boundaries: ['honesty'] },
      firstUtterance: 'I am sealed for a turn proof on a temp disk.',
    });
    witnessLane = witnessLaneId(vendorSlug, 'Kit');
    await setCredential('custom', { endpoint: `${provider.endpoint}/v1` });
    await setRoute(witnessLane, { provider: 'custom', model: MODEL });
  }

  const portalServer = http.createServer();
  const wss = new WebSocketServer({ server: portalServer });
  const { setupPortalRoutes } = await import('../../backend/routes/portal-routes.js');
  setupPortalRoutes(wss, { birthHandler: null });
  await new Promise((resolve) => portalServer.listen(0, '127.0.0.1', resolve));

  const { createSessionToken, generateChallenge, verifySignature } = await import('../../backend/services/auth.js');
  const { generateKeypair, signMessage } = await import('../../core/weave/keypair.js');
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const token = createSessionToken(verifySignature(keypair.address, challenge, await signMessage(keypair.privateKey, challenge)));
  // The beings are this wallet's, as a birth leaves them (a bind verifies, it
  // never claims), and the wallet owns the install, so the witness it sealed
  // outside the desk's summon is its to take (lane-ownership.js, witness-lane.js).
  for (const { id } of beings) await claimOwner(process.env.WORKSPACES_ROOT, id, keypair.address);
  await makeInstallOwner(keypair.address);
  const port = portalServer.address().port;
  const { ws, frames, untilFrame, sendAndWait } = await connectSocket(port, token);
  // More open chats on the same portal — this wallet's by default, or another's token.
  const extraSockets = [];
  const openChat = async (asToken = token) => {
    const chat = await connectSocket(port, asToken);
    extraSockets.push(chat.ws);
    return chat;
  };
  /** impure — bounded wait for a condition on real state. */
  const until = async (check, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      const value = await check();
      if (value) return value;
      if (Date.now() > end) throw new Error('condition never held');
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  const close = async () => {
    for (const socket of [ws, ...extraSockets]) {
      if (socket.readyState === WebSocket.OPEN) await new Promise((resolve) => { socket.once('close', resolve); socket.close(); });
    }
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => portalServer.close(resolve));
    await provider.close();
    setConfig(savedConfig);
    setWitnessesRoot(null);
    setAIWitnessesRoot(null);
    setWorkspacesRoot(savedHouse);
    for (const key of ENV_DOORS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await fs.rm(root, { recursive: true, force: true });
  };

  // The wallet's own session rides out too, so a suite can reach the same
  // lanes through their REST routes under the real ownership gate.
  return { root, workspace, provider, ws, frames, witnessLane, token, untilFrame, sendAndWait, until, openChat, close };
};

/** Pure — the last user message's text in a captured completion body. */
export const lastUserText = (body) => {
  const last = (body?.messages || []).filter((m) => m.role === 'user').at(-1);
  return typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
};
