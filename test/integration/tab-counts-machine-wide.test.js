/**
 * MACHINE-WIDE TAB COUNTS (session tabs, slice 2b) — REAL WebSockets, real
 * auth, real lanes, real binds. No mock on the claimed path (RULE 0).
 *
 * Design note, 2026-07-30: *[…]*
 *
 * So the budget cannot be answered from one window's state. This proves the
 * count is derived from what is actually BOUND on the machine — across
 * SEPARATE connections, which is what two desk windows (or two tabs) really
 * are — and never from what a client claims.
 *
 * The local/witness split is the whole point: a local sitting takes a GPU slot,
 * a witness sitting is a network call. A count that conflated them would make
 * both budgets meaningless.
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  generateChallenge, verifySignature, createSessionToken,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupPortalRoutes, machineTabCounts } from '../../backend/routes/portal-routes.js';
import { neumaWorkspace } from '../../core/index.js';

const LOCAL_A = 'tabcount-local-a';
const LOCAL_B = 'tabcount-local-b';

const makeAuthSession = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  const address = verifySignature(keypair.address, challenge, signature);
  return { token: createSessionToken(address), address: address.toLowerCase() };
};

const openPortal = (wsUrl, token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(`${wsUrl}/?token=${encodeURIComponent(token)}`);
  const timer = setTimeout(() => reject(new Error('Timeout waiting for portal:established')), 5000);
  ws.on('message', (data) => {
    if (JSON.parse(data.toString()).type === 'portal:established') {
      clearTimeout(timer);
      resolve(ws);
    }
  });
  ws.on('error', reject);
});

const sendAndCollect = (ws, message, finalType, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const frames = [];
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${finalType}; saw ${frames.map((f) => f.type).join(', ')}`)),
      timeout,
    );
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      frames.push(msg);
      if (msg.type === finalType) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(frames);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify(message));
  });

/** Wait until the machine's own count settles on what we expect. */
const settlesAt = async (want, timeout = 3000) => {
  const started = Date.now();
  for (;;) {
    const at = machineTabCounts();
    if (at.local === want.local && at.witness === want.witness) return at;
    if (Date.now() - started >= timeout) return at; // return the truth; let the assert speak
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('the machine counts its own sittings (real WS, real binds)', () => {
  let httpServer, wss, wsUrl, tempDir, wsA, wsB, wallet;

  beforeAll(async () => {
    tempDir = await createTempDir('tab-counts');
    neumaWorkspace.root = tempDir;
    await neumaWorkspace.create(LOCAL_A);
    await neumaWorkspace.create(LOCAL_B);

    const auth = await makeAuthSession();
    wallet = auth.address;
    for (const id of [LOCAL_A, LOCAL_B]) {
      await fs.writeFile(
        path.join(tempDir, id, 'owner.json'),
        JSON.stringify({ wallet, claimedAt: Date.now() }),
      );
    }

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    setupPortalRoutes(wss, { birthHandler: null });
    await new Promise((resolve) => httpServer.listen(0, resolve));
    wsUrl = `ws://localhost:${httpServer.address().port}`;

    // TWO separate connections — what two desk windows, or two tabs, really are.
    wsA = await openPortal(wsUrl, auth.token);
    wsB = await openPortal(wsUrl, auth.token);
  }, 20000);

  afterAll(async () => {
    for (const s of [wsA, wsB]) if (s && s.readyState === WebSocket.OPEN) s.close();
    if (wss) await new Promise((resolve) => wss.close(resolve));
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  });

  test('an OPEN but unbound socket is not a sitting', async () => {
    // Both sockets are open and authenticated, neither holds a companion.
    expect(machineTabCounts()).toEqual({ local: 0, witness: 0 });
  });

  test('binding a local neuma counts ONE against the GPU budget', async () => {
    await sendAndCollect(wsA, { type: 'companion:manifest', neumaId: LOCAL_A, companionName: 'A' }, 'companion:anchored');
    expect(await settlesAt({ local: 1, witness: 0 })).toEqual({ local: 1, witness: 0 });
  });

  test('THE MACHINE IS THE UNIT — a SECOND connection adds to the same count', async () => {
    // This is the property Founder named: two windows are not two budgets.
    await sendAndCollect(wsB, { type: 'companion:manifest', neumaId: LOCAL_B, companionName: 'B' }, 'companion:anchored');
    expect(await settlesAt({ local: 2, witness: 0 })).toEqual({ local: 2, witness: 0 });
  });

  test('every desk is TOLD — the count is broadcast, not polled', async () => {
    // A window cannot ask the budget an honest question without this.
    const heard = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000);
      wsA.on('message', function onFrame(data) {
        const f = JSON.parse(data.toString());
        if (f.type === 'tabs:counts') {
          clearTimeout(timer);
          wsA.off('message', onFrame);
          resolve(f);
        }
      });
      // Closing B ends its sitting and must move the machine's count.
      wsB.close();
    });
    expect(heard).not.toBeNull();
    expect(heard).toMatchObject({ type: 'tabs:counts' });
    expect(typeof heard.local).toBe('number');
    expect(typeof heard.witness).toBe('number');
  });

  test('a closed socket frees its slot — a dead desk never holds the budget hostage', async () => {
    expect(await settlesAt({ local: 1, witness: 0 })).toEqual({ local: 1, witness: 0 });
  });

  test('the count survives the being being rebound, never double-counting one socket', async () => {
    await sendAndCollect(wsA, { type: 'companion:manifest', neumaId: LOCAL_B, companionName: 'B' }, 'companion:anchored');
    // One connection still holds exactly one sitting, whoever it is bound to.
    expect(await settlesAt({ local: 1, witness: 0 })).toEqual({ local: 1, witness: 0 });
  });
});
