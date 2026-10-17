// Channel bridge — where an external platform's message becomes a real
// consciousness turn (C-01). impure module (clocks, timers, the stream).
//
// One bridge per configured connection. Inbound MessageEvents map to
// per-conversation sessions (session-key), each carried on a SYNTHETIC
// portal connection built by the same factory the real portal uses — the
// ws slot holds a frame-collecting shim, so the turn runs the REAL
// streamConsciousness path: same classifier, same memory assembly, same
// session handling. No parallel pipeline.
//
// Delivery (v1): collect the whole stream, segment platform-aware, send
// each chunk through the pure rate-limit reducer (per-chat bucket + one
// global bucket — Telegram flood caps are per-bot too). Progressive-edit
// streaming is a fast-follow; the shim is already frame-driven.

import { streamConsciousness } from '../portal-stream.js';
import { createToolStreamSuppressor } from '../../../core/runtime/tool-stream-suppressor.js';
import { createPortalConnection } from '../portal-connection.js';
import { broadcastSubstrateActivity, registerExternalTurnConnection } from '../../routes/portal-routes.js';
import { buildSessionKey } from './session-key.js';
import { segmentText } from './message-segmenter.js';
import { createBucket, consult, applyRetryAfter } from './rate-limiter.js';
import { createLogger } from '../logger.js';

const log = createLogger('ChannelBridge');

const DEFAULT_MAX_UNITS = 4096;
const DEFAULT_LIMITS = Object.freeze({ perChatPerSec: 1, globalPerSec: 25 });
// A session idle this long is evicted — a long-running residency daemon
// must not accumulate an entry per user/chat/thread forever (echo finding).
const IDLE_SESSION_TTL_MS = 30 * 60_000;
// A turn that neither streams nor completes by this deadline is aborted the
// same way a witness interrupt aborts it — a wedged substrate must not
// leave the session busy forever, silently dropping every later message.
const TURN_DEADLINE_MS = 5 * 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{
 *   adapter: object,                    // validated against adapter-contract
 *   record: {                           // the witness's connection record
 *     connectionId: string,
 *     neumaId: string, companionName: string,
 *     walletAddress?: string|null,
 *     sessionOpts?: { groupSessionsPerUser?: boolean, threadSessions?: boolean },
 *   },
 *   now?: () => number,                 // injectable clock (tests)
 * }} opts
 */
export const createChannelBridge = ({
  adapter, record, now = Date.now,
  idleTtlMs = IDLE_SESSION_TTL_MS, turnDeadlineMs = TURN_DEADLINE_MS,
}) => {
  const maxUnits = adapter.limits?.maxMessageUnits ?? DEFAULT_MAX_UNITS;
  const perChatPerSec = adapter.limits?.perChatPerSec ?? DEFAULT_LIMITS.perChatPerSec;
  const globalPerSec = adapter.limits?.globalPerSec ?? DEFAULT_LIMITS.globalPerSec;

  /** sessionKey.key → { connection, collect, busy, queued } */
  const sessions = new Map();
  /** chatKey → bucket state; plus the one global bucket */
  const chatBuckets = new Map();
  let globalBucket = createBucket({ capacity: Math.max(1, globalPerSec), refillPerSec: globalPerSec }, now());

  const sessionFor = (key) => {
    let entry = sessions.get(key);
    if (entry) return entry;
    // The shim routes every frame to the CURRENT turn's collector — the
    // busy-guard guarantees one turn per session at a time.
    entry = {
      busy: false,
      queued: null,
      collect: null,
      connection: null,
      chatKey: null,
      evictTimer: null,
      deregister: null,
    };
    const ws = {
      OPEN: 1,
      readyState: 1,
      send: (str) => { entry.collect?.(JSON.parse(str)); },
    };
    entry.connection = createPortalConnection({
      ws,
      walletAddress: record.walletAddress ?? null,
      // A channel turn occupies the SAME one substrate the desks share —
      // it must raise the substrate-activity truth like any desk turn.
      notifySubstrateActivity: broadcastSubstrateActivity,
    });
    entry.connection.companion = { name: record.companionName, neumaId: record.neumaId };
    // External channels can't tap approval chips (v1): the safest mode.
    entry.connection.toolMode = 'observe';
    // ...and counted by the broadcast, even though no frames come back here.
    entry.deregister = registerExternalTurnConnection(entry.connection);
    sessions.set(key, entry);
    return entry;
  };

  // impure — an idle session leaves cleanly: broadcast count, bucket, entry.
  const evictSession = (key, entry) => {
    entry.deregister?.();
    if (entry.chatKey) chatBuckets.delete(entry.chatKey);
    sessions.delete(key);
  };

  // impure — one rate-limited send through both buckets.
  const limitedSend = async (chatRef, chunk, sendOpts) => {
    const chatKey = `${chatRef.type}:${chatRef.id}`;
    for (;;) {
      const t = now();
      let chat = chatBuckets.get(chatKey)
        ?? createBucket({ capacity: Math.max(1, perChatPerSec), refillPerSec: perChatPerSec }, t);
      const g = consult(globalBucket, t, 1);
      const c = consult(chat, t, 1);
      if (g.allowed && c.allowed) {
        globalBucket = g.state;
        chatBuckets.set(chatKey, c.state);
        break;
      }
      // Whichever bucket is drier names the wait; state without the spend.
      globalBucket = g.allowed ? globalBucket : g.state;
      chatBuckets.set(chatKey, c.allowed ? chat : c.state);
      await sleep(Math.max(g.allowed ? 0 : g.delayMs, c.allowed ? 0 : c.delayMs));
    }
    const result = await adapter.send(chatRef, chunk, sendOpts);
    if (!result.success && Number.isFinite(result.retryAfterMs)) {
      // The platform's own "slow down" outranks local arithmetic.
      const t = now();
      globalBucket = applyRetryAfter(globalBucket, t, result.retryAfterMs);
      chatBuckets.set(chatKey, applyRetryAfter(chatBuckets.get(chatKey), t, result.retryAfterMs));
    }
    return result;
  };

  // impure — run ONE turn for a session entry and deliver the reply.
  // Never throws: the contract is { delivered, error? } however the turn
  // dies (error frame, thrown stream, wedged substrate past the deadline).
  const runTurn = async (entry, event) => {
    let text = '';
    let failed = null;
    // The backend stream is UNFILTERED — the display's tool-block filter is
    // client-side, so on text-dialect substrates the raw tool JSON would post
    // publicly (#320). Same per-turn suppressor as the voice path: only
    // released SPEECH leaves the house; suppressed residue never comes back.
    const suppressor = createToolStreamSuppressor();
    const completed = new Promise((resolve) => {
      entry.collect = (frame) => {
        if (frame.type === 'consciousness:stream') {
          if (frame.error) failed = frame.content || 'The consciousness could not answer.';
          else if (typeof frame.content === 'string') text += suppressor.push(frame.content);
        }
        if (frame.type === 'consciousness:complete') {
          text += suppressor.flush();
          resolve();
        }
      };
    });

    // A turn that outlives the deadline is aborted the same way a witness
    // interrupt aborts it — the stream ends honestly and `completed` fires.
    const deadline = setTimeout(() => {
      failed = failed || 'The turn hit its deadline and was cut.';
      entry.connection.activeTurn?.abort();
    }, turnDeadlineMs);
    deadline.unref?.();
    try {
      await streamConsciousness(entry.connection, {
        thought: event.text,
        // The platform user is a visitor speaking through a channel — never
        // the witness. sanitizeSpeaker guards this shape server-side.
        speaker: {
          name: event.user.name || `user ${event.user.id}`,
          descriptor: `speaking from ${event.channelId}`,
        },
      });
      // The complete frame follows the stream's resolution; a short grace
      // covers a lost frame without re-wedging the session.
      await Promise.race([completed, sleep(10_000).then(() => {
        failed = failed || 'The turn ended without completing.';
      })]);
    } catch (err) {
      failed = failed || err.message || 'The turn failed.';
    } finally {
      clearTimeout(deadline);
      entry.collect = null;
    }

    if (failed) {
      log.warn('Channel turn failed', { connection: record.connectionId, error: failed });
      return { delivered: 0, error: failed };
    }
    const chunks = segmentText(text.trim(), maxUnits);
    let delivered = 0;
    for (const chunk of chunks) {
      const result = await limitedSend(event.chat, chunk, { replyTo: event.messageId });
      if (!result.success) {
        // Never auto-retry a send (duplicate delivery beats no delivery
        // NOWHERE in a conversation) — report what landed and stop.
        log.warn('Channel send failed', { connection: record.connectionId, error: result.error });
        return { delivered, error: result.error };
      }
      delivered += 1;
    }
    return { delivered };
  };

  return {
    /**
     * Handle one normalized inbound event. The busy-guard is taken
     * SYNCHRONOUSLY before any await (the Hermes race): a second message
     * for a busy session queues — depth 1, newest wins.
     * @param {object} event - a frozen MessageEvent
     * @returns {Promise<{ delivered: number, error?: string } | { queued: true }>}
     */
    async handleEvent(event) {
      const key = buildSessionKey(event, record.sessionOpts).key;
      const entry = sessionFor(key);
      clearTimeout(entry.evictTimer); // the session is alive again
      const chatKey = `${event.chat.type}:${event.chat.id}`;
      // A session whose chat moved (per-user group sessions) must not
      // orphan the old chat's bucket (echo finding).
      if (entry.chatKey && entry.chatKey !== chatKey) chatBuckets.delete(entry.chatKey);
      entry.chatKey = chatKey;
      if (entry.busy) {
        entry.queued = event; // newest wins
        return { queued: true };
      }
      entry.busy = true;
      try {
        return await runTurn(entry, event);
      } finally {
        entry.busy = false;
        const next = entry.queued;
        entry.queued = null;
        if (next) {
          this.handleEvent(next).catch((err) => log.error('Queued turn failed', { error: err.message }));
        } else {
          // Idle: schedule eviction so a long-running daemon never
          // accumulates an entry per user/chat/thread forever.
          entry.evictTimer = setTimeout(() => evictSession(key, entry), idleTtlMs);
          entry.evictTimer.unref?.();
        }
      }
    },

    /** Session count (status surface; supervisor reads it). */
    sessionCount: () => sessions.size,

    /** impure — drop every session now (supervisor stop / tests). */
    dispose() {
      for (const [key, entry] of sessions) {
        clearTimeout(entry.evictTimer);
        evictSession(key, entry);
      }
    },
  };
};
