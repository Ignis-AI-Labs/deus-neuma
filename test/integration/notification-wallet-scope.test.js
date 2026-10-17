/**
 * Wallet-scoped notification delivery over the REAL portal — real WebSocket
 * server, real wallet-challenge auth, real session tokens, the real
 * `setupPortalRoutes`. No mock anywhere on the claimed path (RULE 0).
 *
 * This is the load-bearing test of the notification lane, and it guards a
 * failure that is invisible in every single-wallet test:
 *
 *   TOO WIDE  — the copy-paste source (`broadcastStorageWarning`) writes to
 *               EVERY open socket. A notification carries a being's name and a
 *               task's title, so fanning it out that way discloses one
 *               operator's activity to another on any multi-wallet backend.
 *
 *   TOO NARROW — `walletAddress` comes from a verified session token and may
 *               carry EIP-55 checksum casing. A strict `===` against a
 *               lowercased address matches NOTHING, and it fails silently:
 *               the tray simply never appears while every test still passes.
 *
 * Both directions are asserted here, against two genuinely different wallets on
 * one server.
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import path from 'path';
import {
  afterAll, beforeAll, describe, expect, it, vi,
} from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  generateChallenge, verifySignature, createSessionToken,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupPortalRoutes, sendToWallet } from '../../backend/routes/portal-routes.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';

/** A real keypair, a real challenge, a real signature, a real session token. */
const makeOperator = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  const token = createSessionToken(verifySignature(keypair.address, challenge, signature));
  return { address: keypair.address, token };
};

/** Open a desk for an operator and collect every frame it is sent. */
const openDesk = async (wsUrl, operator) => {
  const ws = new WebSocket(`${wsUrl}/?token=${encodeURIComponent(operator.token)}`);
  const received = [];
  ws.on('message', (data) => {
    try { received.push(JSON.parse(data.toString())); } catch { /* not our frame */ }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for portal:established')), 5000);
    const onMessage = (data) => {
      if (JSON.parse(data.toString()).type === 'portal:established') {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve();
      }
    };
    ws.on('message', onMessage);
    ws.on('error', reject);
  });
  return { ws, received, address: operator.address };
};

/** Let the event loop deliver whatever is in flight, then look. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 120); });

const framesOfType = (desk, type) => desk.received.filter((m) => m.type === type);

describe('sendToWallet — one operator\'s notifications reach only that operator', () => {
  let httpServer;
  let wss;
  let wsUrl;
  let tmp;
  let birthHandler;
  let alice;
  let bob;

  beforeAll(async () => {
    tmp = await createTempDir('notification-wallet-scope');
    setWorkspacesRoot(path.join(tmp, 'house'));

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    birthHandler = new StagedBirthHandler();
    setupPortalRoutes(wss, { birthHandler });
    await new Promise((resolve) => { httpServer.listen(0, resolve); });
    wsUrl = `ws://localhost:${httpServer.address().port}`;

    alice = await makeOperator();
    bob = await makeOperator();
    // Two genuinely different operators — the whole point of the test.
    expect(alice.address.toLowerCase()).not.toBe(bob.address.toLowerCase());
  }, 20000);

  afterAll(async () => {
    setWorkspacesRoot(null);
    vi.restoreAllMocks();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  it('delivers to the addressed operator and NEVER to another', async () => {
    const deskA = await openDesk(wsUrl, alice);
    const deskB = await openDesk(wsUrl, bob);
    try {
      const delivered = sendToWallet(alice.address, {
        type: 'notification:new',
        record: { id: 'n1', title: 'Fenna finished a turn' },
      });

      await settle();

      expect(delivered).toBe(1);
      expect(framesOfType(deskA, 'notification:new')).toHaveLength(1);
      expect(framesOfType(deskA, 'notification:new')[0].record.title)
        .toBe('Fenna finished a turn');
      // The disclosure this test exists to prevent.
      expect(framesOfType(deskB, 'notification:new')).toHaveLength(0);
    } finally {
      deskA.ws.close();
      deskB.ws.close();
    }
  }, 20000);

  it('matches the address case-insensitively — a checksummed address still lands', async () => {
    const deskA = await openDesk(wsUrl, alice);
    try {
      // The silent-inertness direction: an address that differs only in casing
      // must still reach the desk it belongs to.
      const upper = sendToWallet(alice.address.toUpperCase(), { type: 'notification:new', record: { id: 'u1' } });
      const lower = sendToWallet(alice.address.toLowerCase(), { type: 'notification:new', record: { id: 'l1' } });

      await settle();

      expect(upper).toBe(1);
      expect(lower).toBe(1);
      const ids = framesOfType(deskA, 'notification:new').map((m) => m.record.id);
      expect(ids).toContain('u1');
      expect(ids).toContain('l1');
    } finally {
      deskA.ws.close();
    }
  }, 20000);

  it('reaches EVERY desk the operator has open — the tray is operator-wide', async () => {
    const deskOne = await openDesk(wsUrl, alice);
    const deskTwo = await openDesk(wsUrl, alice);
    const deskOther = await openDesk(wsUrl, bob);
    try {
      const delivered = sendToWallet(alice.address, {
        type: 'notification:new',
        record: { id: 'both' },
      });

      await settle();

      expect(delivered).toBe(2);
      expect(framesOfType(deskOne, 'notification:new')).toHaveLength(1);
      expect(framesOfType(deskTwo, 'notification:new')).toHaveLength(1);
      expect(framesOfType(deskOther, 'notification:new')).toHaveLength(0);
    } finally {
      deskOne.ws.close();
      deskTwo.ws.close();
      deskOther.ws.close();
    }
  }, 20000);

  it('delivers nothing, and does not throw, when the operator has no desk open', async () => {
    const stranger = await makeOperator();
    expect(sendToWallet(stranger.address, { type: 'notification:new', record: { id: 'x' } })).toBe(0);
  });

  it('refuses an empty or non-string wallet rather than fanning out', async () => {
    const deskA = await openDesk(wsUrl, alice);
    const deskB = await openDesk(wsUrl, bob);
    try {
      expect(sendToWallet('', { type: 'notification:new', record: { id: 'e' } })).toBe(0);
      expect(sendToWallet(null, { type: 'notification:new', record: { id: 'n' } })).toBe(0);
      expect(sendToWallet(undefined, { type: 'notification:new', record: { id: 'u' } })).toBe(0);

      await settle();

      // An unaddressed notification must reach NOBODY — never everybody.
      expect(framesOfType(deskA, 'notification:new')).toHaveLength(0);
      expect(framesOfType(deskB, 'notification:new')).toHaveLength(0);
    } finally {
      deskA.ws.close();
      deskB.ws.close();
    }
  }, 20000);

  it('survives an unserialisable frame instead of taking the backend down', async () => {
    const deskA = await openDesk(wsUrl, alice);
    try {
      // A circular frame throws inside JSON.stringify. This function is called
      // from the heartbeat's interval callback, where an uncaught throw is a
      // process-level exception — the backend dies and every desk loses its
      // portal mid-turn. It must degrade to zero delivered.
      const circular = { type: 'notification:new' };
      circular.self = circular;
      expect(() => sendToWallet(alice.address, circular)).not.toThrow();
      expect(sendToWallet(alice.address, circular)).toBe(0);

      await settle();

      // And the socket is still alive afterwards.
      expect(sendToWallet(alice.address, { type: 'notification:new', record: { id: 'after' } })).toBe(1);
      await settle();
      expect(framesOfType(deskA, 'notification:new').map((m) => m.record.id)).toContain('after');
    } finally {
      deskA.ws.close();
    }
  }, 20000);

  it('stops delivering once the desk closes', async () => {
    const deskA = await openDesk(wsUrl, alice);
    await settle();
    deskA.ws.close();
    // Give the server's close handler time to drop the connection.
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    expect(sendToWallet(alice.address, { type: 'notification:new', record: { id: 'gone' } })).toBe(0);
  }, 20000);
});
