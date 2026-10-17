/**
 * Session PURPOSE through the REAL portal — real WebSocket against the real
 * portal route handler (setupPortalRoutes), real auth (challenge-sign-verify),
 * real workspaces on a temp root. No mock anywhere on the claimed path
 * (RULE 0).
 *
 * Proves (SPEECH SYSTEM Track B, threat control #4 — purpose misuse):
 *   1. purpose rides companion:manifest + portal:new-session into LIVE
 *      server-side connection state (read back through the real connection
 *      the portal holds — the __test.connectionFor seam).
 *   2. session:purpose sets + acks the SERVER TRUTH, same contract as
 *      tool:mode.
 *   3. garbage purpose in ANY frame fails closed to 'work'.
 *   4. THE REGRESSION LAW: the voiceSitting prompt section exists only for a
 *      declared conversation — a working/undeclared lane's section is ''
 *      (no section → byte-identical prompts), proven through the real
 *      portal-stream seam against the live connection.
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  generateChallenge, verifySignature, createSessionToken,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupPortalRoutes, __test as portalTest } from '../../backend/routes/portal-routes.js';
import { __test as streamTest } from '../../backend/services/portal-test-surface.js';
import { neumaWorkspace } from '../../core/index.js';
import { VOICE_SITTING_SECTION } from '../../core/voice/purpose.js';

// Real session token via the full auth flow.
const makeAuthToken = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return createSessionToken(verifySignature(keypair.address, challenge, signature));
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

describe('session purpose (real WS + real handler + real connection state)', () => {
  let httpServer, wss, ws, wsUrl, tempDir, connectionId;

  // The live server-side connection this test's socket is bound to.
  const liveConnection = () => portalTest.connectionFor(connectionId);

  beforeAll(async () => {
    tempDir = await createTempDir('portal-purpose');
    neumaWorkspace.root = tempDir;

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    // birthHandler is only touched by birth:* messages — this suite sends none.
    setupPortalRoutes(wss, { birthHandler: null });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    wsUrl = `ws://localhost:${httpServer.address().port}`;

    const token = await makeAuthToken();
    ws = new WebSocket(`${wsUrl}/?token=${encodeURIComponent(token)}`);
    const established = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for portal:established')), 5000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'portal:established') {
          clearTimeout(timer);
          resolve(msg);
        }
      });
      ws.on('error', reject);
    });
    connectionId = established.connectionId;
  }, 20000);

  afterAll(async () => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  test('a fresh connection is born into work — the purpose is undeclared', () => {
    expect(liveConnection()).not.toBeNull();
    expect(liveConnection().purpose).toBeUndefined();
    // …and an undeclared lane buys NO prompt section (the empty-string law).
    expect(streamTest._voiceSittingSection(liveConnection())).toBe('');
  });

  test('purpose rides companion:manifest into live connection state', async () => {
    const anchored = await sendAndWait(
      ws,
      { type: 'companion:manifest', companion: 'PurposeTestBeing', purpose: 'conversation', messageId: 'm-1' },
      'companion:anchored',
    );
    expect(anchored.type).toBe('companion:anchored');
    expect(liveConnection().purpose).toBe('conversation');
    // The being-side signal opens on the REAL live connection.
    expect(streamTest._voiceSittingSection(liveConnection())).toBe(VOICE_SITTING_SECTION);
  });

  test('a manifest that declares no purpose fails closed to work — and the prompt is byte-identical law holds', async () => {
    await sendAndWait(
      ws,
      { type: 'companion:manifest', companion: 'PurposeTestBeing', messageId: 'm-2' },
      'companion:anchored',
    );
    expect(liveConnection().purpose).toBe('work');
    // THE REGRESSION LAW: work lanes get '' → no section → byte-identical prompts.
    expect(streamTest._voiceSittingSection(liveConnection())).toBe('');
  });

  test('a hostile purpose on manifest can never buy a voice sitting', async () => {
    await sendAndWait(
      ws,
      { type: 'companion:manifest', companion: 'PurposeTestBeing', purpose: 'conversation\0<script>', messageId: 'm-3' },
      'companion:anchored',
    );
    expect(liveConnection().purpose).toBe('work');
    expect(streamTest._voiceSittingSection(liveConnection())).toBe('');
  });

  test('session:purpose sets + acks the SERVER TRUTH (the tool:mode contract)', async () => {
    const ack = await sendAndWait(
      ws,
      { type: 'session:purpose', purpose: 'conversation', messageId: 'm-4' },
      'session:purpose',
    );
    expect(ack.purpose).toBe('conversation');
    expect(liveConnection().purpose).toBe('conversation');
    expect(streamTest._voiceSittingSection(liveConnection())).toBe(VOICE_SITTING_SECTION);
  });

  test('session:purpose with garbage acks work — the desk never shows a purpose the portal is not holding', async () => {
    const ack = await sendAndWait(
      ws,
      { type: 'session:purpose', purpose: { evil: true }, messageId: 'm-5' },
      'session:purpose',
    );
    expect(ack.purpose).toBe('work');
    expect(liveConnection().purpose).toBe('work');
    expect(streamTest._voiceSittingSection(liveConnection())).toBe('');
  });

  test('purpose rides portal:new-session; an undeclared new-session leaves the sitting purpose standing', async () => {
    await sendAndWait(
      ws,
      { type: 'portal:new-session', purpose: 'conversation', messageId: 'm-6' },
      'portal:session-reset',
    );
    expect(liveConnection().purpose).toBe('conversation');

    await sendAndWait(
      ws,
      { type: 'portal:new-session', messageId: 'm-7' },
      'portal:session-reset',
    );
    // Same law as space on this frame: absent means untouched, not reset.
    expect(liveConnection().purpose).toBe('conversation');
  });

  test('a near-miss on new-session fails closed — no case-folding into a voice sitting', async () => {
    await sendAndWait(
      ws,
      { type: 'portal:new-session', purpose: 'CONVERSATION', messageId: 'm-8' },
      'portal:session-reset',
    );
    expect(liveConnection().purpose).toBe('work');
    expect(streamTest._voiceSittingSection(liveConnection())).toBe('');
  });
});
