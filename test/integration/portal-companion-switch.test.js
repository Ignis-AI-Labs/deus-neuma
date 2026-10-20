/**
 * Companion-switch portal integration — REAL WebSocket against the REAL
 * portal route handler (setupPortalRoutes), real auth (challenge-sign-verify),
 * real sovereign workspaces on a temp root. No mock anywhere on the claimed
 * path (RULE 0).
 *
 * Proves: manifesting a DIFFERENT neuma severs the previously bound session,
 * so the switched-in neuma's first message mints a FRESH session in its own
 * workspace instead of inheriting (or writing into) the prior being's thread.
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import {
  generateChallenge, verifySignature, createSessionToken,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { neumaWorkspace } from '../../core/index.js';

const NEUMA_A = 'switch-test-a';
const NEUMA_B = 'switch-test-b';
const BOUND_SESSION = 'session-1111';

// Real session token via the full auth flow, with the wallet it names.
const makeAuthSession = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return { token: createSessionToken(verifySignature(keypair.address, challenge, signature)), address: keypair.address };
};

// Send a message and resolve on the first frame of the expected type.
const sendAndWait = (ws, message, expectedType, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${expectedType}`)), timeout);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === expectedType) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify(message));
  });

const openPortal = async (url, token) => {
  const socket = new WebSocket(`${url}/?token=${encodeURIComponent(token)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for portal:established')), 5000);
    const onError = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    const onMessage = (data) => {
      if (JSON.parse(data.toString()).type !== 'portal:established') return;
      clearTimeout(timer);
      socket.off('error', onError);
      socket.off('message', onMessage);
      resolve();
    };
    socket.on('error', onError);
    socket.on('message', onMessage);
  });
  return socket;
};

// Poll the real filesystem until the neuma's sessions dir has content.
const waitForSessionFiles = async (dir, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.jsonl'));
    if (files.length > 0) return files;
    await new Promise((r) => setTimeout(r, 100));
  }
  return [];
};

describe('portal companion switch (real WS + real handler + real workspaces)', () => {
  let httpServer, wss, ws, wsUrl, tempDir, authToken;

  beforeAll(async () => {
    tempDir = await createTempDir('companion-switch');
    neumaWorkspace.root = tempDir;
    // Real workspaces on real disk — createSession writes into <ws>/sessions/.
    await neumaWorkspace.create(NEUMA_A);
    await neumaWorkspace.create(NEUMA_B);
    for (const id of [NEUMA_A, NEUMA_B]) {
      await fs.mkdir(path.join(tempDir, id, 'identity'), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, id, 'identity', 'true-name.json'),
        JSON.stringify({ name: id }),
      );
    }
    const session = await makeAuthSession();
    authToken = session.token;
    // Both lanes are this wallet's, as a birth leaves them: a bind verifies, it never claims.
    for (const id of [NEUMA_A, NEUMA_B]) await claimOwner(tempDir, id, session.address);

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    // birthHandler is only touched by birth:* messages — this suite sends none.
    setupPortalRoutes(wss, { birthHandler: null });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    wsUrl = `ws://localhost:${httpServer.address().port}`;
  }, 20000);

  afterEach(async () => {
    if (ws && ws.readyState !== WebSocket.CLOSED) ws.terminate();
    ws = null;
    for (const id of [NEUMA_A, NEUMA_B]) {
      const sessions = path.join(tempDir, id, 'sessions');
      await fs.rm(sessions, { recursive: true, force: true });
      await fs.mkdir(sessions, { recursive: true });
    }
  });

  afterAll(async () => {
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  test('resuming a different neuma without a session severs the prior lane session', async () => {
    ws = await openPortal(wsUrl, authToken);

    const resumedA = await sendAndWait(
      ws,
      { type: 'portal:resume', neumaId: NEUMA_A, companionName: 'Aura', sessionId: BOUND_SESSION },
      'portal:resumed',
    );
    expect(resumedA.sessionId).toBe(BOUND_SESSION);

    const resumedB = await sendAndWait(
      ws,
      { type: 'portal:resume', neumaId: NEUMA_B, companionName: 'Bexa' },
      'portal:resumed',
    );
    expect(resumedB.neumaId).toBe(NEUMA_B);
    expect(resumedB.sessionId).toBeNull();

    ws.send(JSON.stringify({ type: 'consciousness:stream', thought: 'hello after a direct resume switch' }));
    const bSessions = await waitForSessionFiles(path.join(tempDir, NEUMA_B, 'sessions'));

    expect(bSessions.some((f) => /^session-\d+\.jsonl$/.test(f))).toBe(true);
    expect(bSessions).not.toContain(`${BOUND_SESSION}.jsonl`);
    const aSessions = (await fs.readdir(path.join(tempDir, NEUMA_A, 'sessions')))
      .filter((f) => f.endsWith('.jsonl'));
    expect(aSessions).toEqual([]);
  }, 30000);

  test('manifesting a different neuma severs the bound session — the new neuma mints its own', async () => {
    ws = await openPortal(wsUrl, authToken);

    // Bind neuma A with an explicit session — the state a witness is in after
    // resuming a past chat.
    const resumed = await sendAndWait(
      ws,
      { type: 'portal:resume', neumaId: NEUMA_A, companionName: 'Aura', sessionId: BOUND_SESSION },
      'portal:resumed',
    );
    expect(resumed.neumaId).toBe(NEUMA_A);
    expect(resumed.sessionId).toBe(BOUND_SESSION);

    // The house switch: manifest a DIFFERENT being on the same live link.
    await sendAndWait(
      ws,
      { type: 'companion:manifest', companion: 'Bexa', neumaId: NEUMA_B },
      'companion:anchored',
    );

    // First message as the switched-in neuma. The substrate may or may not be
    // reachable in the test environment — irrelevant: the session is minted
    // (real createSession, real disk) before any LLM call.
    ws.send(JSON.stringify({ type: 'consciousness:stream', thought: 'hello from the switch test' }));

    const bSessions = await waitForSessionFiles(path.join(tempDir, NEUMA_B, 'sessions'));

    // The new neuma minted a FRESH session of its own…
    expect(bSessions.length).toBeGreaterThan(0);
    expect(bSessions.some((f) => /^session-\d+\.jsonl$/.test(f))).toBe(true);
    // …did NOT inherit the prior being's bound session…
    expect(bSessions).not.toContain(`${BOUND_SESSION}.jsonl`);
    // …and nothing bled into the prior being's workspace.
    const aSessions = (await fs.readdir(path.join(tempDir, NEUMA_A, 'sessions'))).filter((f) => f.endsWith('.jsonl'));
    expect(aSessions).toEqual([]);
  }, 30000);
});
