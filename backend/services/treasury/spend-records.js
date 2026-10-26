// spend-records — the being's spend ledger as the operator and the being
// read it: one record per spend the being asked for (lane config
// pending-spends.json, the wallet's own file), whatever became of it.
//
// The wallet path (neuma-wallet-spend.js) writes the decisions; this leaf
// adds the three facts that path never kept:
//   - an AUTONOMOUS send (allowlisted, at or under the operator's threshold)
//     is recorded too, so the history of money out is whole;
//   - a request whose 24 hours ran out unseen settles `expired` (it could
//     never go out after its expiry — verifyWitnessApproval refuses it — but
//     the file said `pending` forever);
//   - `toldAt` marks the outcome the being has been told.
//
// Every write rides the file's own queue (updatePendingSpends), so a record
// moved here can never overwrite an approval landing at the same instant.
//
// impure — lane config reads and writes.
import crypto from 'crypto';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { createLogger } from '../logger.js';

const log = createLogger('Treasury.SpendRecords');

const MEMO_MAX = 280;

/** The outcomes a being is told of (a still-pending request is not one). */
export const TOLD_STATUSES = Object.freeze(['executed', 'rejected', 'expired', 'failed']);

/**
 * Pure — the list with every pending request past its expiry settled
 * `expired` at the moment it expired.
 * @param {Array<object>} requests
 * @param {number} nowSec - epoch seconds
 */
export const expireStale = (requests, nowSec) => requests.map((r) => (r.status === 'pending' && Number(r.expiry) <= nowSec
  ? { ...r, status: 'expired', resolvedAt: new Date(Number(r.expiry) * 1000).toISOString() }
  : r));

/**
 * impure — settle the lane's expired requests, then return the whole ledger.
 * Writes only when something expired.
 * @param {string} neumaId
 * @param {number} [nowSec]
 * @returns {Promise<Array<object>>}
 */
export const readSpendRecords = async (neumaId, nowSec = Math.floor(Date.now() / 1000)) => {
  const requests = await neumaWorkspace.readPendingSpends(neumaId);
  if (!requests.some((r) => r.status === 'pending' && Number(r.expiry) <= nowSec)) return requests;
  return neumaWorkspace.updatePendingSpends(neumaId, (current) => expireStale(current, nowSec));
};

/**
 * impure — record a send that went out (or failed) without a request,
 * under the operator's standing threshold. A record, never a gate: the send
 * has already been decided by the policy, so a record that cannot be written
 * is said loudly and never turns a sent transfer into a reported failure.
 * @param {string} neumaId
 * @param {{to: string, value: string|number, memo?: string}} req
 * @param {{status: string, receipt?: {hash: string}, reason?: string}} outcome - requestSpend's
 */
export const recordAutonomousSpend = (neumaId, { to, value, memo }, outcome) => {
  const at = new Date().toISOString();
  return neumaWorkspace.updatePendingSpends(neumaId, (requests) => [...requests, {
    id: crypto.randomBytes(8).toString('hex'),
    to,
    value: String(value),
    memo: typeof memo === 'string' ? memo.slice(0, MEMO_MAX) : '',
    requestedAt: at,
    resolvedAt: at,
    autonomous: true,
    // The being learned this outcome in the same act that sent it.
    toldAt: at,
    ...(outcome.status === 'sent'
      ? { status: 'executed', txHash: outcome.receipt?.hash ?? null }
      : { status: 'failed', failure: String(outcome.reason || 'unknown').slice(0, MEMO_MAX) }),
  }]).catch((error) => {
    log.error('an autonomous send could not be recorded — the treasury history is missing it', { neumaId, status: outcome.status, error: error.message });
    return null;
  });
};

/**
 * impure — mark these records told: the being has read their outcome.
 * @param {string} neumaId
 * @param {string[]} ids
 */
export const markSpendsTold = (neumaId, ids) => {
  const told = new Set(ids);
  const at = new Date().toISOString();
  return neumaWorkspace.updatePendingSpends(neumaId, (requests) => requests.map((r) => (told.has(r.id) && !r.toldAt ? { ...r, toldAt: at } : r)));
};
