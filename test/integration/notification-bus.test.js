/**
 * The notification lane end to end, below the UI — real WebSocket server, real
 * auth, real records on a real disk, the real bus and the real store. No mock
 * anywhere on the claimed path (RULE 0).
 *
 * Deliberately driven by a SCRIPTED WebSocket client and never by the tray. The
 * tray depends on the hook, the hook depends on this contract, and proving the
 * contract […] would make the sprint's evidence
 * circular. Everything here is observable with no React mount at all.
 */

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import path from 'path';
import {
  afterAll, beforeAll, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  generateChallenge, verifySignature, createSessionToken,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { StagedBirthHandler } from '../../core/birth/staged-birth-handler.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { notifyOperator, __resetCoalesce } from '../../backend/services/notification-bus.js';
import { readNotifications } from '../../backend/services/notification-store.js';
import { KIND, STANDING } from '../../core/runtime/notification-record.js';

const makeOperator = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return {
    address: keypair.address,
    token: createSessionToken(verifySignature(keypair.address, challenge, signature)),
  };
};

const openDesk = async (wsUrl, operator) => {
  const ws = new WebSocket(`${wsUrl}/?token=${encodeURIComponent(operator.token)}`);
  const received = [];
  ws.on('message', (data) => {
    try { received.push(JSON.parse(data.toString())); } catch { /* not ours */ }
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
  return { ws, received };
};

const settle = (ms = 200) => new Promise((resolve) => { setTimeout(resolve, ms); });
const of = (desk, type) => desk.received.filter((m) => m.type === type);

const turnFor = (wallet, over = {}) => notifyOperator({
  wallet,
  kind: KIND.turnDone,
  standing: STANDING.neuma,
  title: 'Fenna finished a turn',
  actor: { id: 'lane-1', name: 'Fenna' },
  ref: { sessionId: 's-1', turnId: 't-1' },
  ...over,
});

describe('notification bus over the real portal', () => {
  let httpServer;
  let wss;
  let wsUrl;
  let alice;
  let bob;
  let originalRoot;

  beforeAll(async () => {
    originalRoot = getRealmRoot();
    const tmp = await createTempDir('notification-bus');
    setWorkspacesRoot(path.join(tmp, 'house'));

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    setupPortalRoutes(wss, { birthHandler: new StagedBirthHandler() });
    await new Promise((resolve) => { httpServer.listen(0, resolve); });
    wsUrl = `ws://localhost:${httpServer.address().port}`;

    alice = await makeOperator();
    bob = await makeOperator();
  }, 20000);

  afterAll(async () => {
    setRealmRoot(originalRoot);
    setWorkspacesRoot(null);
    vi.restoreAllMocks();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });

  beforeEach(async () => {
    setRealmRoot(await createTempDir('notification-bus-realm'));
    __resetCoalesce();
  });

  it('stores the record AND pushes it to the operator, addressed', async () => {
    const deskA = await openDesk(wsUrl, alice);
    const deskB = await openDesk(wsUrl, bob);
    try {
      const record = await turnFor(alice.address);
      await settle();

      expect(record).not.toBeNull();

      // On the wire, to the right operator only.
      const frames = of(deskA, 'notification:new');
      expect(frames).toHaveLength(1);
      expect(frames[0].record.title).toBe('Fenna finished a turn');
      expect(frames[0].action).toBe('raise');
      expect(of(deskB, 'notification:new')).toHaveLength(0);

      // And on disk.
      const stored = await readNotifications(alice.address);
      expect(stored.records.map((r) => r.id)).toContain(record.id);
      expect((await readNotifications(bob.address)).records).toHaveLength(0);
    } finally {
      deskA.ws.close();
      deskB.ws.close();
    }
  }, 20000);

  it('hydrates a freshly opened desk with what it missed', async () => {
    // Nothing open — this is work finishing while the operator is away.
    await turnFor(alice.address, { title: 'happened while away' });
    await settle(50);

    const desk = await openDesk(wsUrl, alice);
    try {
      await settle();
      const hydrate = of(desk, 'notification:hydrate');
      expect(hydrate).toHaveLength(1);
      expect(hydrate[0].records.map((r) => r.title)).toContain('happened while away');
      expect(hydrate[0].unread).toBe(1);
    } finally {
      desk.ws.close();
    }
  }, 20000);

  it('carries a boot id on establish so the desk can tell a restart from a reconnect', async () => {
    const one = await openDesk(wsUrl, alice);
    const two = await openDesk(wsUrl, alice);
    try {
      const a = one.received.find((m) => m.type === 'portal:established');
      const b = two.received.find((m) => m.type === 'portal:established');
      expect(typeof a.bootId).toBe('string');
      expect(a.bootId).not.toBe('');
      // Same process, so the same id — a reconnect must NOT read as new code.
      expect(b.bootId).toBe(a.bootId);
    } finally {
      one.ws.close();
      two.ws.close();
    }
  }, 20000);

  it('collapses a burst from one lane into one card that updates in place', async () => {
    const desk = await openDesk(wsUrl, alice);
    try {
      for (let i = 0; i < 5; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await turnFor(alice.address, { ref: { sessionId: 's-1', turnId: `t-${i}` } });
      }
      await settle();

      const frames = of(desk, 'notification:new');
      expect(frames).toHaveLength(5);
      expect(frames[0].action).toBe('raise');
      expect(frames.slice(1).every((f) => f.action === 'replace')).toBe(true);
      expect(frames.at(-1).count).toBe(5);
      expect(frames.at(-1).supersedes).toBe(frames[0].record.id);

      // Nothing was dropped from the account, only from the card.
      const stored = await readNotifications(alice.address);
      expect(stored.records).toHaveLength(5);
    } finally {
      desk.ws.close();
    }
  }, 20000);

  it('keeps two different beings as two cards', async () => {
    const desk = await openDesk(wsUrl, alice);
    try {
      await turnFor(alice.address, { actor: { id: 'lane-1', name: 'Fenna' } });
      await turnFor(alice.address, { actor: { id: 'lane-2', name: 'Cael' } });
      await settle();
      const frames = of(desk, 'notification:new');
      expect(frames.every((f) => f.action === 'raise')).toBe(true);
    } finally {
      desk.ws.close();
    }
  }, 20000);

  it('marks read from a scripted client and converges EVERY desk the operator has open', async () => {
    const deskOne = await openDesk(wsUrl, alice);
    const deskTwo = await openDesk(wsUrl, alice);
    try {
      const record = await turnFor(alice.address);
      await settle();

      // Desk one reads it. Desk two never touched it.
      deskOne.ws.send(JSON.stringify({ type: 'notification:read', ids: [record.id] }));
      await settle(400);

      // Both desks are told, including the one that sent it.
      expect(of(deskOne, 'notification:read')).toHaveLength(1);
      expect(of(deskTwo, 'notification:read')).toHaveLength(1);
      expect(of(deskTwo, 'notification:read')[0].ids).toEqual([record.id]);

      // And it survives a restart.
      const stored = await readNotifications(alice.address);
      expect(stored.records.find((r) => r.id === record.id).read).toBe(true);
      expect(stored.unread).toBe(0);
    } finally {
      deskOne.ws.close();
      deskTwo.ws.close();
    }
  }, 20000);

  it('accepts a batched read so clearing a full tray cannot trip the rate limit', async () => {
    const desk = await openDesk(wsUrl, alice);
    try {
      const ids = [];
      for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const rec = await turnFor(alice.address, { actor: { id: `lane-${i}`, name: `B${i}` } });
        ids.push(rec.id);
      }
      await settle();

      desk.ws.send(JSON.stringify({ type: 'notification:read', ids }));
      await settle(400);

      const stored = await readNotifications(alice.address);
      expect(stored.unread).toBe(0);
    } finally {
      desk.ws.close();
    }
  }, 20000);

  it('rejects malformed ids at the boundary rather than passing them to the store', async () => {
    const desk = await openDesk(wsUrl, alice);
    try {
      const record = await turnFor(alice.address);
      await settle();

      desk.ws.send(JSON.stringify({
        type: 'notification:read',
        ids: ['../../etc/passwd', '', null, 'has space', record.id],
      }));
      await settle(400);

      // Only the well-formed id survived the filter.
      const echoed = of(desk, 'notification:read');
      expect(echoed).toHaveLength(1);
      expect(echoed[0].ids).toEqual([record.id]);
    } finally {
      desk.ws.close();
    }
  }, 20000);

  it('ignores a read frame carrying no usable id at all', async () => {
    const desk = await openDesk(wsUrl, alice);
    try {
      desk.ws.send(JSON.stringify({ type: 'notification:read', ids: ['!!bad!!'] }));
      await settle(300);
      expect(of(desk, 'notification:read')).toHaveLength(0);
      // The socket is still healthy.
      await turnFor(alice.address);
      await settle();
      expect(of(desk, 'notification:new')).toHaveLength(1);
    } finally {
      desk.ws.close();
    }
  }, 20000);

  it('refuses a malformed notification at the bus instead of storing it', async () => {
    const desk = await openDesk(wsUrl, alice);
    try {
      // A being-shaped kind that names no being — the "something finished" card.
      const result = await notifyOperator({
        wallet: alice.address,
        kind: KIND.turnDone,
        standing: STANDING.neuma,
        title: 'anonymous',
        actor: null,
      });
      await settle();
      expect(result).toBeNull();
      expect(of(desk, 'notification:new')).toHaveLength(0);
      expect((await readNotifications(alice.address)).records).toHaveLength(0);
    } finally {
      desk.ws.close();
    }
  }, 20000);

  it('never throws into its caller — a turn must not fail because a card did', async () => {
    await expect(notifyOperator({})).resolves.toBeNull();
    await expect(notifyOperator()).resolves.toBeNull();
    await expect(notifyOperator({ wallet: 'not-a-wallet', kind: KIND.storageWarning, standing: STANDING.system, title: 'x' }))
      .resolves.not.toThrow();
  }, 20000);

  it('a settled task names the work, so the operator can recognise it', async () => {
    const desk = await openDesk(wsUrl, alice);
    try {
      const rec = await notifyOperator({
        wallet: alice.address,
        kind: KIND.taskClosed,
        standing: STANDING.neuma,
        title: 'Fenna finished a task',
        detail: 'Draft the migration notes',
        actor: { id: 'lane-1', name: 'Fenna' },
        ref: { taskId: 'T-42', status: 'done', chatId: 'c-1' },
      });
      await settle();

      expect(rec).not.toBeNull();
      const frames = of(desk, 'notification:new');
      expect(frames).toHaveLength(1);
      // […] alone is not actionable — the title of the
      // work is what makes the card worth reading.
      expect(frames[0].record.detail).toBe('Draft the migration notes');
      expect(frames[0].record.ref.taskId).toBe('T-42');

      const stored = await readNotifications(alice.address);
      expect(stored.records[0].kind).toBe(KIND.taskClosed);
    } finally {
      desk.ws.close();
    }
  }, 20000);

  it('a dropped task is announced too — deciding not to do it is news', async () => {
    const desk = await openDesk(wsUrl, alice);
    try {
      await notifyOperator({
        wallet: alice.address,
        kind: KIND.taskClosed,
        standing: STANDING.neuma,
        title: 'Fenna dropped a task',
        detail: 'Chase the flaky spec',
        actor: { id: 'lane-1', name: 'Fenna' },
        ref: { taskId: 'T-9', status: 'dropped' },
      });
      await settle();
      const frames = of(desk, 'notification:new');
      expect(frames).toHaveLength(1);
      expect(frames[0].record.ref.status).toBe('dropped');
    } finally {
      desk.ws.close();
    }
  }, 20000);

  it('a system condition needs no being and still lands', async () => {
    const desk = await openDesk(wsUrl, alice);
    try {
      const rec = await notifyOperator({
        wallet: alice.address,
        kind: KIND.storageWarning,
        standing: STANDING.system,
        title: 'Storage critical',
        ref: { level: 'critical' },
      });
      await settle();
      expect(rec).not.toBeNull();
      expect(of(desk, 'notification:new')).toHaveLength(1);
      expect(of(desk, 'notification:new')[0].record.standing).toBe(STANDING.system);
    } finally {
      desk.ws.close();
    }
  }, 20000);
});
