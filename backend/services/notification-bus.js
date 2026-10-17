/**
 * NOTIFICATION BUS — the one door every producer knocks on.
 *
 * Five places raise notifications: a turn ending, a task settling, a run or a
 * render landing, the disk filling. Each of them lives inside code that is doing
 * something far more important at the time — most of them inside a live turn, in
 * a file three other workstreams are editing.
 *
 * So the contract for a producer is exactly one line: call `notifyOperator`.
 * Everything else — minting the id, stamping the shape, writing the record,
 * collapsing a burst, addressing the frame — happens here.
 *
 * ── WHY THE SENDER IS INJECTED ──────────────────────────────────────────────
 *
 * The transport lives in `routes/`, and services must not import routes — the
 * same cycle the heartbeat's `storageNotifier` avoids by taking its notifier as
 * an argument. `portal-routes.js` calls `setNotificationSender(sendToWallet)`
 * when it loads. Wiring it there rather than in `server.js` also keeps this
 * feature out of a file three other workstreams are already editing.
 *
 * ── WHY NOTHING HERE CAN THROW ──────────────────────────────────────────────
 *
 * Every caller is mid-something-else. `portal-stream.js` calls this INSIDE a
 * turn; the storage path calls it from a heartbeat interval, where an uncaught
 * throw is a process-level exception that kills the backend and drops every
 * desk's portal.
 *
 * A notification is the least important thing happening at any of those moments.
 * It must never be the reason one of them fails. So every path is guarded, every
 * failure is logged, and `notifyOperator` resolves to `null` instead of
 * rejecting — including when the store write fails, because a card the operator
 * sees now is worth more than symmetry with a disk that is already unhappy.
 *
 * That is a deliberate exception to "no silent failures", and it is not silent:
 * it is loud in the log and invisible only to the turn that must not care.
 */

import crypto from 'crypto';
import { createLogger } from './logger.js';
import { makeRecord, validateRecord } from '../../core/runtime/notification-record.js';
import { initialCoalesceState, coalesce, pruneCoalesceState } from '../../core/runtime/notification-coalesce.js';
import { appendNotification } from './notification-store.js';

const log = createLogger('Notifications');

/** Injected by portal-routes at load. Null until then — see the module note. */
let send = null;

/** impure — wire the transport. Called once, from the routes layer. */
export const setNotificationSender = (fn) => {
  send = typeof fn === 'function' ? fn : null;
};

/**
 * Coalesce state, per operator.
 *
 * Per operator and not global because a burst from one operator's being must
 * never collapse another operator's card — on a single-wallet desk that cannot
 * happen, but the whole point of the wallet scoping downstream is that this
 * backend may one day serve more than one.
 */
const coalesceByWallet = new Map();

/** impure — drop all coalesce state. Test seam; never called in production. */
export const __resetCoalesce = () => coalesceByWallet.clear();

/**
 * Announce something to an operator.
 *
 * @param {object} input
 * @param {string} input.wallet - who to tell
 * @param {string} input.kind - one of KIND
 * @param {string} input.standing - one of STANDING
 * @param {string} input.title - the card's one line
 * @param {?string} [input.detail]
 * @param {?{id?: string, name?: string}} [input.actor]
 * @param {object} [input.ref] - what this is about
 * @returns {Promise<?object>} the stored record, or null if it could not be raised
 */
export const notifyOperator = async ({
  wallet, kind, standing, title, detail = null, actor = null, ref = {},
} = {}) => {
  try {
    const nowMs = Date.now();
    const record = makeRecord({
      // A url-safe id: it crosses the socket and comes back as a read marker,
      // and the record contract restricts the charset it will accept.
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 32),
      ts: nowMs,
      kind,
      standing,
      title,
      detail,
      actor,
      ref,
    });

    const { ok, errors } = validateRecord(record);
    if (!ok) {
      // A producer built something malformed. Loud, and dropped — writing it
      // would put a permanent bad line in the operator's log.
      log.error('Notification refused at the bus', { errors, kind, standing });
      return null;
    }

    // The record lands on disk even when it will not raise a card: the tray's
    // claim is a complete account of what happened, and a collapsed burst is
    // still eight things that happened.
    try {
      await appendNotification(wallet, record);
    } catch (error) {
      log.error('Notification not stored — raising it anyway', { error: error.message, id: record.id });
    }

    const prior = coalesceByWallet.get(wallet) ?? initialCoalesceState();
    const folded = coalesce(prior, record, nowMs);
    coalesceByWallet.set(wallet, pruneCoalesceState(folded.state, nowMs));

    if (!send) {
      log.warn('Notification has no transport — is portal-routes loaded?', { id: record.id });
      return record;
    }

    send(wallet, {
      type: 'notification:new',
      record,
      // The desk needs to know whether this is a new card or an update to one it
      // is already showing. Deriving that client-side would mean duplicating the
      // window logic in the renderer, and getting it wrong there is a popup storm.
      action: folded.action,
      count: folded.count,
      supersedes: folded.supersedes,
    });

    return record;
  } catch (error) {
    // The last line of defence. A turn must never fail because a card did.
    log.error('Notification failed', { error: error.message, kind });
    return null;
  }
};
