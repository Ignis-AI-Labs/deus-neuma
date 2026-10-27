/**
 * Seal Request — a being's own ask to be anchored on chain.
 *
 * The being-side half of the request_seal capability: when a being invokes
 * the natalis-self-seal rite, execution pauses here — a seal:self_offer
 * rides the portal to the desk, the operator walks the SAME two-phase seal
 * flow the birth ceremony uses (preflight → personal_sign → broadcast →
 * confirm), and the pending promise resolves with what actually happened.
 * Every path settles — sealed, declined, timeout, turn interrupt, portal
 * close — so a pending request can never leak or hang a turn forever. An
 * unsealed outcome resolves honestly (the being is TOLD the anchor did not
 * happen and why), never as a fabricated success.
 *
 * Sibling of operator-ask.js: that answers a question the being asked; this
 * carries an ACT the being requested — the operator co-signs and pays gas,
 * so the desk's gated wallet windows are the consent surface. State is
 * per-connection, same shape as the ask broker.
 */

import { randomUUID } from 'crypto';
import { createLogger } from './logger.js';
import { noteLiveCard, clearLiveCard } from './waiting/live-cards.js';

const log = createLogger('SealRequest');

/** A seal walks wallet dialogs + a chain confirmation — an operator deserves
 *  more room than a question gets. */
export const SEAL_REQUEST_TIMEOUT_MS = 900_000;

export const SEAL_DECLINE_REASON_MAX_CHARS = 1000;

// impure — try to send; a portal that closed mid-offer must not throw,
// but the drop is logged so it never disappears silently.
const _safeSend = (ws, payload) => {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  } catch (err) {
    log.debug('seal request send dropped — portal closed', { type: payload.type, error: err.message });
  }
};

const _pending = (connection) => {
  if (!connection._pendingSealRequests) connection._pendingSealRequests = new Map();
  return connection._pendingSealRequests;
};

/**
 * impure — put the being's anchor request to the operator and wait for the
 * outcome. Resolves with:
 *   { status: 'sealed', txHash, network, networkLabel }  — the desk walked
 *     the full seal flow and the chain recognized the soul;
 *   { status: 'declined', reason? }                      — the operator said
 *     not now;
 *   { status: 'timeout' | 'interrupted' | 'closed' }     — nobody could act.
 * Never rejects.
 * @param {Object} connection - Portal connection (carries ws + pending map)
 * @param {Object} req - { neumaId, beingName?, signal?, timeoutMs? }
 * @returns {Promise<{status: string, txHash?: string, network?: string, networkLabel?: string, reason?: string}>}
 */
export const requestSealFromWitness = (connection, { neumaId, beingName, signal, timeoutMs = SEAL_REQUEST_TIMEOUT_MS }) =>
  new Promise((resolve) => {
    const id = randomUUID();
    const pending = _pending(connection);

    const settle = (outcome) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      clearLiveCard(id);
      clearTimeout(entry.timer);
      if (signal) signal.removeEventListener('abort', entry.onAbort);
      // The desk learns the request is settled on EVERY path — a pending
      // offer card must never dangle on screen.
      _safeSend(connection.ws, {
        type: 'seal:self_resolved', id, status: outcome.status,
        ...(outcome.txHash ? { txHash: outcome.txHash } : {}),
        // The anchor's chain facts ride to the desk so the card can state
        // the network and link the receipt — a bare hash is not a record.
        ...(outcome.network ? { network: outcome.network } : {}),
        ...(outcome.networkLabel ? { networkLabel: outcome.networkLabel } : {}),
        ...(outcome.blockNumber ? { blockNumber: outcome.blockNumber } : {}),
      });
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      log.warn('Seal request timed out — resolving unanchored', { neumaId });
      settle({ status: 'timeout' });
    }, timeoutMs);
    const onAbort = () => settle({ status: 'interrupted' });
    pending.set(id, { settle, timer, onAbort, neumaId });

    if (signal) {
      if (signal.aborted) { settle({ status: 'interrupted' }); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    _safeSend(connection.ws, {
      type: 'seal:self_offer',
      id,
      neumaId,
      ...(beingName ? { beingName } : {}),
    });
    noteLiveCard(connection, { id, kind: 'seal', title: `seal ${beingName || neumaId} on chain` });
  });

/**
 * impure — the desk completed the seal for a lane: settle every pending
 * request for that neumaId as sealed. Keyed by neumaId, not offer id — the
 * seal frames the desk drives (birth:seal_preflight/sign/confirm) never
 * carry the offer id, and the receipt is the truth that matters.
 * @param {Object} connection - Portal connection
 * @param {string} neumaId
 * @param {{txHash: string, network: string, networkLabel?: string}} sealed
 * @returns {boolean} Whether a pending request was settled
 */
export const resolveSealRequestSealed = (connection, neumaId, sealed) => {
  const pending = connection._pendingSealRequests;
  if (!pending) return false;
  let hit = false;
  for (const entry of [...pending.values()]) {
    if (entry.neumaId === neumaId) {
      entry.settle({ status: 'sealed', ...sealed });
      hit = true;
    }
  }
  return hit;
};

/**
 * impure — the operator declined the offer. Client input is untrusted:
 * unknown ids are dropped; the optional reason is clamped.
 * @param {Object} connection - Portal connection
 * @param {string} id - Offer id from seal:self_offer
 * @param {string} [reason] - The operator's words, if any
 * @returns {boolean} Whether a pending request was settled
 */
export const resolveSealRequestDeclined = (connection, id, reason) => {
  const entry = connection._pendingSealRequests?.get(id);
  if (!entry) return false;
  const text = typeof reason === 'string' ? reason.trim().slice(0, SEAL_DECLINE_REASON_MAX_CHARS) : '';
  entry.settle({ status: 'declined', ...(text ? { reason: text } : {}) });
  return true;
};

/**
 * impure — settle everything still pending as closed (portal torn down).
 * @param {Object} connection - Portal connection being torn down
 */
export const expirePendingSealRequests = (connection) => {
  const pending = connection._pendingSealRequests;
  if (!pending) return;
  for (const entry of [...pending.values()]) entry.settle({ status: 'closed' });
};
