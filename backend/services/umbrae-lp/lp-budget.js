// lp-budget.js — the operator's budget for a house member's liquidity, and the
// deposits waiting for the operator because they would pass it.
//
// Both records are written only by the platform, encrypted, in the house
// member's config folder; a plain-text file there is refused on read
// (workspace _readTrustedJSON), so a house member cannot set its own budget
// or approve its own deposit by writing a file.

import crypto from 'node:crypto';
import path from 'node:path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { createLogger } from '../logger.js';

const log = createLogger('LpBudget');

/** The largest budget the platform will record, in dollars. A typo past this is refused. */
export const MAX_BUDGET_USD = 1_000_000;
/** How long a waiting deposit stays answerable. Prices move; an old ask is asked again. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_PENDING_DEPOSITS = 25;

const budgetFile = (neumaId) => path.join(neumaWorkspace._path(neumaId), 'config', 'lp-budget.json');
const pendingFile = (neumaId) => path.join(neumaWorkspace._path(neumaId), 'config', 'lp-pending.json');

// impure — a platform record, or null when absent or not the platform's.
const readRecord = async (file) => {
  try {
    return await neumaWorkspace._readTrustedJSON(file);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'UNTRUSTED_PLAINTEXT') return null;
    throw err;
  }
};

/**
 * The budget the operator set for this house member, in dollars; null only when
 * no record was ever written (with none, deposits run under the transaction
 * policy). A record that is there and cannot be trusted or read — plain text
 * where the platform writes only encrypted envelopes, torn, undecryptable, or
 * not a budget — reads as $0, so every deposit waits for the operator (P6-13:
 * an unreadable cap was once no cap). impure.
 *
 * @param {string} neumaId
 * @returns {Promise<number|null>}
 */
export const readLpBudget = async (neumaId) => {
  let record;
  try {
    record = await neumaWorkspace._readTrustedJSON(budgetFile(neumaId));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    log.warn('LP budget record is unreadable; every deposit waits for the operator', { neumaId, code: err.code ?? err.name });
    return 0;
  }
  const usd = record?.budgetUsd;
  return typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? usd : 0;
};

/**
 * Record the operator's budget. Zero means every deposit waits. impure —
 * writes config and the audit line.
 *
 * @param {string} neumaId
 * @param {number} budgetUsd
 * @returns {Promise<number>} the budget as recorded
 */
export const writeLpBudget = async (neumaId, budgetUsd) => {
  if (typeof budgetUsd !== 'number' || !Number.isFinite(budgetUsd) || budgetUsd < 0 || budgetUsd > MAX_BUDGET_USD) {
    throw new Error(`A budget is a dollar amount from 0 to ${MAX_BUDGET_USD}.`);
  }
  const rounded = Math.round(budgetUsd * 100) / 100;
  await neumaWorkspace._writeJSON(budgetFile(neumaId), { budgetUsd: rounded, setAt: new Date().toISOString() });
  await neumaWorkspace.audit(neumaId, 'LP_BUDGET_SET', { budgetUsd: rounded });
  return rounded;
};

// impure — read, change and write the waiting list under its file lock.
const updatePending = (neumaId, change) => {
  const file = pendingFile(neumaId);
  return neumaWorkspace._locks.withFileLock(file, async () => {
    const now = Date.now();
    const live = ((await readRecord(file))?.requests ?? []).filter((r) => Date.parse(r.askedAt) + PENDING_TTL_MS > now);
    const { requests, result } = change(live);
    await neumaWorkspace._writeJSON(file, { requests });
    return result;
  });
};

/**
 * Put a deposit on the waiting list for the operator. impure.
 *
 * @param {string} neumaId
 * @param {{action: object, depositUsd: string, reason: string}} ask
 * @returns {Promise<Readonly<{id: string, action: object, depositUsd: string, reason: string, askedAt: string}>>}
 */
export const addPendingDeposit = async (neumaId, { action, depositUsd, reason }) => {
  const askedAt = new Date().toISOString();
  const request = Object.freeze({ id: crypto.randomUUID(), action, depositUsd, priceSnapshot: { depositUsd, at: askedAt }, reason, askedAt });
  await updatePending(neumaId, (live) => {
    if (live.length >= MAX_PENDING_DEPOSITS) throw new Error('Too many deposits are waiting for an operator answer.');
    return { requests: [...live, request], result: null };
  });
  await neumaWorkspace.audit(neumaId, 'LP_DEPOSIT_WAITING', { id: request.id, depositUsd });
  return request;
};

/**
 * The deposits waiting for the operator, oldest first. impure — reads config.
 *
 * @param {string} neumaId
 * @returns {Promise<Array<object>>}
 */
export const listPendingDeposits = async (neumaId) => {
  const now = Date.now();
  return ((await readRecord(pendingFile(neumaId)))?.requests ?? []).filter((r) => Date.parse(r.askedAt) + PENDING_TTL_MS > now);
};

/**
 * Take one waiting deposit off the list, once: the operator's yes or no both
 * end it, and a second answer finds nothing. impure.
 *
 * @param {string} neumaId
 * @param {string} id
 * @param {'approved'|'declined'} answer
 * @returns {Promise<object|null>} the request, or null when it is gone
 */
export const takePendingDeposit = async (neumaId, id, answer) => {
  const taken = await updatePending(neumaId, (live) => ({
    requests: live.filter((r) => r.id !== id),
    result: live.find((r) => r.id === id) ?? null,
  }));
  if (taken) await neumaWorkspace.audit(neumaId, answer === 'approved' ? 'LP_DEPOSIT_APPROVED' : 'LP_DEPOSIT_DECLINED', { id });
  return taken;
};
