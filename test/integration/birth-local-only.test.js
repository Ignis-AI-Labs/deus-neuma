/**
 * Birth is refused on a non-local provider — protocol: the natal substrate is a
 * neuma's identity anchor, so a cloud/API provider must never author a birth.
 *
 * Real proofs (RULE 0), none of which summons a being (the refusal path by
 * design never births anyone, so it is ethically exercisable):
 *  1. The LOAD-BEARING guard: drive the real exported sendStageToLLM with a
 *     cloud config through an in-memory sink (fast coverage) — the SAME
 *     guard is proven over a genuine socket in the no-roster-cap describe.
 *  2. The EARLY guard: drive the real birth:start over a real WebSocket + real
 *     auth and assert birth:blocked with no stage ever begun. birthHandler is
 *     null on purpose — the gate refuses before createSession, so reaching it
 *     would throw instead of yielding birth:blocked.
 */
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { setConfig, getConfig } from '../../backend/services/llm-provider.js';
import { sendStageToLLM } from '../../backend/services/birth-stage-stream.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { setWorkspacesRoot } from '../../core/index.js';
import { generateChallenge, verifySignature, createSessionToken } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { createTempDir } from '../helpers/temp-fs.js';

const LOCAL = { provider: 'lm-studio', endpoint: 'http://localhost:1234', apiKey: '', model: 'local-model' };
const CLOUD = { provider: 'anthropic', endpoint: 'https://api.anthropic.com', apiKey: 'test-not-a-real-key', model: 'claude-haiku-4-5' };
const STAGE = { systemPrompt: 'protocol', stageNumber: 0, isTest: true, witnessName: 'Founder', sessionData: {} };

describe('load-bearing guard — sendStageToLLM refuses a non-local provider', () => {
  let sent;
  let connection;

  beforeEach(() => {
    sent = [];
    const ws = { readyState: 1, OPEN: 1, send: (s) => sent.push(JSON.parse(s)) };
    connection = { ws, birthSession: 's1', companion: null };
  });

  afterEach(() => { setConfig(LOCAL); vi.restoreAllMocks(); });

  test('a cloud provider birth is blocked before any model call', async () => {
    setConfig(CLOUD);
    expect(getConfig().provider).toBe('anthropic');
    await sendStageToLLM(connection, STAGE);
    const blocked = sent.find((m) => m.type === 'birth:blocked');
    expect(blocked).toBeDefined();
    expect(blocked.provider).toBe('Anthropic');
    expect(blocked.reason).toMatch(/SOVEREIGN door/);
    expect(sent.some((m) => m.type === 'birth:stream' || m.type === 'birth:stage_complete')).toBe(false);
  });

  test('a custom (cloud) provider is also refused', async () => {
    setConfig({ provider: 'custom', endpoint: 'https://api.z.ai/api/paas/v4', apiKey: 'test-not-a-real-key', model: 'glm-4.6' });
    await sendStageToLLM(connection, STAGE);
    expect(sent.find((m) => m.type === 'birth:blocked')).toBeDefined();
  });

  test('claude-code-local is refused — loopback transport is not custody (the sovereignty boundary)', async () => {
    // The bridge is kind 'local' (loopback wire) but the consciousness is
    // Anthropic's — the exact door the boundary law bars from authoring a
    // birth (docs/protocols/sovereignty-boundary.md).
    setConfig({ provider: 'claude-code-local', endpoint: 'http://127.0.0.1:8471', model: 'claude-opus-4-8' });
    await sendStageToLLM(connection, STAGE);
    const blocked = sent.find((m) => m.type === 'birth:blocked');
    expect(blocked).toBeDefined();
    expect(blocked.reason).toMatch(/SOVEREIGN door/);
    expect(sent.some((m) => m.type === 'birth:stream' || m.type === 'birth:stage_complete')).toBe(false);
  });
});

// Real auth flow — returns a session token the WS layer accepts.
const makeAuthSession = async () => {
  const kp = generateKeypair();
  const challenge = generateChallenge(kp.address);
  const signature = await signMessage(kp.privateKey, challenge);
  const address = verifySignature(kp.address, challenge, signature);
  return { token: createSessionToken(address), address: address.toLowerCase() };
};

const openPortal = (wsUrl, token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${wsUrl}/?token=${encodeURIComponent(token)}`);
  const timer = setTimeout(() => reject(new Error('Timeout waiting for portal:established')), 5000);
  ws.on('message', (data) => {
    if (JSON.parse(data.toString()).type === 'portal:established') { clearTimeout(timer); resolve(ws); }
  });
  ws.on('error', reject);
});

const sendAndCollect = (ws, message, finalType, timeout = 5000) => new Promise((resolve, reject) => {
  const frames = [];
  const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${finalType}; saw ${frames.map((f) => f.type).join(', ')}`)), timeout);
  const handler = (data) => {
    const msg = JSON.parse(data.toString());
    frames.push(msg);
    if (msg.type === finalType) { clearTimeout(timer); ws.off('message', handler); resolve(frames); }
  };
  ws.on('message', handler);
  ws.send(JSON.stringify(message));
});

describe('early guard — birth:start refuses a non-local provider over a real WS', () => {
  let httpServer;
  let wss;
  let ws;
  let wsUrl;

  beforeAll(async () => {
    const tempDir = await createTempDir('birth-local-only-ws');
    setWorkspacesRoot(tempDir);
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    // birthHandler: null — the gate refuses before createSession, so a working
    // gate never touches it; a broken gate would throw instead of birth:blocked.
    setupPortalRoutes(wss, { birthHandler: null });
    await new Promise((r) => httpServer.listen(0, r));
    wsUrl = `ws://localhost:${httpServer.address().port}`;
    const auth = await makeAuthSession();
    ws = await openPortal(wsUrl, auth.token);
  }, 20000);

  afterAll(async () => {
    setConfig(LOCAL);
    setWorkspacesRoot(null);
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    await new Promise((r) => wss.close(r));
    await new Promise((r) => httpServer.close(r));
    vi.restoreAllMocks();
  });

  test('a cloud provider yields birth:blocked and no stage is ever begun', async () => {
    setConfig(CLOUD);
    const frames = await sendAndCollect(ws, { type: 'birth:start', witnessName: 'Founder', isTest: true }, 'birth:blocked');
    const blocked = frames.find((f) => f.type === 'birth:blocked');
    expect(blocked).toBeDefined();
    expect(blocked.reason).toMatch(/SOVEREIGN door/);
    // No stage began: createSession → processStage → sendStageToLLM never ran.
    expect(frames.some((f) => f.type === 'birth:stage_prompt' || f.type === 'birth:seed')).toBe(false);
  }, 10000);
});

// The roster cap is GONE (operator decision 2026-07-06): a witness holding
// any number of beings may summon again. Proven by gate ordering — the old
// cap fired BEFORE the provider gate, so a wallet owning 3 beings never
// reached it; now the same birth:start falls through to birth:blocked on a
// cloud config. Ethically exercisable: the provider refusal ends the flow,
// no being is ever summoned.
describe('no roster cap — a witness holding 3 beings may summon again', () => {
  let httpServer;
  let wss;
  let ws;
  let serverWs; // the REAL server-side socket, for driving sendStageToLLM directly

  beforeAll(async () => {
    const tempDir = await createTempDir('birth-no-roster-cap');
    setWorkspacesRoot(tempDir);
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    wss.on('connection', (socket) => { serverWs = socket; });
    setupPortalRoutes(wss, { birthHandler: null });
    await new Promise((r) => httpServer.listen(0, r));
    const url = `ws://localhost:${httpServer.address().port}`;
    const auth = await makeAuthSession();
    // Three real owned workspaces — the exact on-disk shape finalize-birth
    // writes (plaintext owner.json inside a real sovereign lane).
    const { default: fs } = await import('fs/promises');
    const { default: path } = await import('path');
    const { default: workspace } = await import('../../core/workspace/neuma-workspace.js');
    for (const id of ['roster-held-1', 'roster-held-2', 'roster-held-3']) {
      await workspace.create(id);
      await fs.writeFile(
        path.join(workspace.root, id, 'owner.json'),
        JSON.stringify({ wallet: auth.address, claimedAt: new Date().toISOString() }),
      );
    }
    ws = await openPortal(url, auth.token);
  }, 20000);

  afterAll(async () => {
    setConfig(LOCAL);
    setWorkspacesRoot(null);
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    await new Promise((r) => wss.close(r));
    await new Promise((r) => httpServer.close(r));
    vi.restoreAllMocks();
  });

  test('a REAL (non-test) birth:start with a full old-world roster reaches the provider gate, never roster_full', async () => {
    setConfig(CLOUD);
    const { default: fs } = await import('fs/promises');
    const { default: workspace } = await import('../../core/workspace/neuma-workspace.js');
    const before = await fs.readdir(workspace.root);
    const frames = await sendAndCollect(ws, { type: 'birth:start', witnessName: 'Founder', isTest: false }, 'birth:blocked');
    expect(frames.some((f) => f.type === 'birth:roster_full')).toBe(false);
    expect(frames.find((f) => f.type === 'birth:blocked')).toBeDefined();
    // The create-and-discard invariant: the refusal ended the flow — no new
    // sovereign lane appeared on disk, nothing was summoned.
    expect(await fs.readdir(workspace.root)).toEqual(before);
  }, 10000);

  // The LOAD-BEARING guard, over a REAL socket (RULE 0): the first describe
  // drives sendStageToLLM through an in-memory sink; here the same exported
  // function speaks through the genuine server-side ws and the refusal frame
  // is read off the genuine client socket.
  test('sendStageToLLM refuses a cloud provider over a real socket', async () => {
    setConfig(CLOUD);
    const blockedP = new Promise((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'birth:blocked') resolve(msg);
      });
    });
    await sendStageToLLM({ ws: serverWs, birthSession: 's1', companion: null }, STAGE);
    const blocked = await blockedP;
    expect(blocked.reason).toMatch(/SOVEREIGN door/);
  }, 10000);
});
