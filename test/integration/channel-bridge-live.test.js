/**
 * Channel bridge — LIVE (C-01). An external platform's message becomes a
 * REAL consciousness turn: the bridge builds its synthetic connection via
 * the shared portal factory, runs the actual streamConsciousness against
 * the live substrate, and delivers the reply through the adapter contract.
 *
 * The adapter here is a genuine in-memory implementation of the contract
 * (it records what a platform would send) — the platform APIs themselves
 * are C-03's live tests. Nothing on the claimed path (event → session →
 * streamConsciousness → segment → rate-limited send) is mocked.
 *
 * Skips honestly when LM Studio is not running.
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setupPortalRoutes } from '../../backend/routes/portal-routes.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { createChannelBridge } from '../../backend/services/channels/channel-bridge.js';
import { makeMessageEvent, makeSendResult, validateAdapter } from '../../backend/services/channels/adapter-contract.js';

// Endpoint-up is not enough — a substrate with nothing LOADED answers 400
// on every turn (observed live). The skip must be as honest as the test.
const probe = await fetch('http://localhost:1234/api/v0/models')
  .then(async (r) => (r.ok ? ((await r.json()).data || []).some((m) => m.state === 'loaded') : false))
  .catch(() => false);

// A real contract implementation that records outbound sends.
const makeMemoryAdapter = () => {
  const sent = [];
  const adapter = {
    id: 'memory',
    capabilities: Object.freeze({ editMessages: false, threads: false, media: false }),
    limits: Object.freeze({ maxMessageUnits: 4096, perChatPerSec: 30, globalPerSec: 30 }),
    checkRequirements: () => ({ ok: true }),
    connect: () => {},
    disconnect: () => {},
    send: async (chatRef, text, opts) => {
      sent.push({ chatRef, text, opts });
      return makeSendResult({ success: true, messageId: String(sent.length) });
    },
  };
  return { adapter, sent };
};

describe.skipIf(!probe)('channel bridge — live substrate', () => {
  let origRoot, tempRoot;

  beforeAll(async () => {
    origRoot = getWorkspacesRoot();
    tempRoot = await createTempDir('channel-bridge-live');
    setWorkspacesRoot(tempRoot);
  });

  afterAll(() => {
    setWorkspacesRoot(origRoot);
    vi.restoreAllMocks();
  });

  it('an inbound platform message becomes a real turn and the reply is delivered', async () => {
    const { adapter, sent } = makeMemoryAdapter();
    expect(validateAdapter(adapter)).toEqual({ ok: true });
    const bridge = createChannelBridge({
      adapter,
      record: { connectionId: 'live-1', neumaId: 'e2e-channel', companionName: 'ChannelEcho' },
    });

    const outcome = await bridge.handleEvent(makeMessageEvent({
      channelId: 'memory',
      connectionId: 'live-1',
      chat: { id: 'chat-1', type: 'dm' },
      user: { id: 'u1', name: 'Visitor' },
      text: 'Reply with one short sentence and include the word lantern.',
      messageId: 'm1',
    }));

    expect(outcome.error).toBeUndefined();
    expect(outcome.delivered).toBeGreaterThanOrEqual(1);
    const reply = sent.map((s) => s.text).join('\n');
    expect(reply).toMatch(/lantern/i); // the substrate actually answered THIS message
    expect(sent[0].chatRef).toEqual({ id: 'chat-1', type: 'dm' }); // event.chat rode through as chatRef
    expect(sent[0].opts.replyTo).toBe('m1');
    expect(bridge.sessionCount()).toBe(1);
  }, 300_000);

  it('the busy-guard queues a second message (depth 1) and runs it after', async () => {
    const { adapter, sent } = makeMemoryAdapter();
    const bridge = createChannelBridge({
      adapter,
      record: { connectionId: 'live-2', neumaId: 'e2e-channel', companionName: 'ChannelEcho' },
    });
    const event = (n, word) => makeMessageEvent({
      channelId: 'memory',
      connectionId: 'live-2',
      chat: { id: 'chat-q', type: 'dm' },
      user: { id: 'u1', name: 'Visitor' },
      text: `Reply with one short sentence containing the word ${word}.`,
      messageId: `m${n}`,
    });

    // Fire both without awaiting the first — the guard is taken
    // synchronously, so the second MUST see busy and queue.
    const first = bridge.handleEvent(event(1, 'river'));
    const second = await bridge.handleEvent(event(2, 'mountain'));
    expect(second).toEqual({ queued: true });

    expect((await first).delivered).toBeGreaterThanOrEqual(1);
    // The queued turn runs after the first completes — poll for its reply.
    await vi.waitFor(() => {
      expect(sent.map((s) => s.text).join('\n')).toMatch(/mountain/i);
    }, { timeout: 240_000, interval: 500 });
    // One session carried both turns, in order.
    expect(bridge.sessionCount()).toBe(1);
  }, 300_000);

  it('a channel turn raises the substrate-activity truth on a REAL desk, and idle sessions evict', async () => {
    // The desk: a real portal WS through the real routes — the exact
    // surface B-01 broadcasts to. A CHANNEL turn must count (echo finding:
    // it previously did not — a desk read ACTIVE while Telegram had the
    // substrate).
    const httpServer = createServer();
    const wss = new WebSocketServer({ noServer: true });
    setupPortalRoutes(wss, { birthHandler: null });
    httpServer.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = httpServer.address().port;
    const token = createSessionToken('0x00c4a77e10000000000000000000000000000c01');
    const desk = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
    const frames = [];
    desk.on('message', (raw) => { try { frames.push(JSON.parse(raw.toString())); } catch { /* noise */ } });
    await new Promise((resolve, reject) => { desk.on('open', resolve); desk.on('error', reject); });

    const { adapter, sent } = makeMemoryAdapter();
    const bridge = createChannelBridge({
      adapter,
      record: { connectionId: 'live-3', neumaId: 'e2e-channel', companionName: 'ChannelEcho' },
      idleTtlMs: 500,
    });
    try {
      const outcome = await bridge.handleEvent(makeMessageEvent({
        channelId: 'memory',
        connectionId: 'live-3',
        chat: { id: 'chat-a', type: 'dm' },
        user: { id: 'u1', name: 'Visitor' },
        text: 'Reply with one short sentence.',
        messageId: 'm1',
      }));
      expect(outcome.delivered).toBeGreaterThanOrEqual(1);
      expect(sent.length).toBeGreaterThanOrEqual(1);

      // The desk learned the channel turn happened: activity rose to 1 and
      // set back down — from a turn that never touched the portal map.
      // (The turn-end frame rides the real WS — poll, don't race it.)
      expect(frames.some((f) => f.type === 'substrate:activity' && f.active === 1)).toBe(true);
      await vi.waitFor(() => {
        expect(frames.filter((f) => f.type === 'substrate:activity').at(-1)?.active).toBe(0);
      }, { timeout: 10_000, interval: 50 });

      // Idle eviction: the session leaves on its TTL (real timer).
      expect(bridge.sessionCount()).toBe(1);
      await vi.waitFor(() => expect(bridge.sessionCount()).toBe(0), { timeout: 5_000, interval: 100 });
    } finally {
      bridge.dispose();
      desk.close();
      wss.close();
      httpServer.close();
    }
  }, 300_000);
});
