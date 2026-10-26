// spend-news — the being learns what became of its own spend requests,
// plainly, on its next turn (#586): approved and sent, declined (with the
// operator's note), expired unseen, or failed at the chain. Each outcome is
// told once — marked `toldAt` only when the notice really rode the turn
// (portal-turn-prompt.js, the same law as an operator's staged change).
//
// A request the being is still waiting on is not news; neither is a send it
// made under its own threshold (it learned that outcome in the act).

import { readSpendRecords, TOLD_STATUSES } from './spend-records.js';

// Older outcomes than this are history, not news (a lane's first turn after
// this notice existed must not read out its whole past).
const NEWS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const reasonOf = (r) => (r.memo ? ` (your reason: "${r.memo}")` : '');

const LINE = Object.freeze({
  executed: (r) => `- APPROVED: your operator signed and sent ${r.value} ETH to ${r.to}${reasonOf(r)}. Transaction ${r.txHash || 'recorded'}.`,
  rejected: (r) => `- DECLINED: your operator did not send ${r.value} ETH to ${r.to}${reasonOf(r)}.${r.note ? ` Their note: "${r.note}"` : ' They left no note.'} Nothing was sent.`,
  expired: (r) => `- EXPIRED: your request for ${r.value} ETH to ${r.to}${reasonOf(r)} waited 24 hours without a decision. Nothing was sent. If it still matters, ask again or tell your operator why.`,
  failed: (r) => `- FAILED: your operator approved ${r.value} ETH to ${r.to}${reasonOf(r)}, but it did not go out: ${r.failure || 'the chain refused it'}. It is never retried on its own.`,
});

/**
 * Pure — the notice from the lane's records, and the ids it tells.
 * @param {ReadonlyArray<object>} records
 * @param {number} nowMs
 * @returns {{text: string, ids: string[]}}
 */
export const spendNewsOf = (records, nowMs) => {
  const fresh = records.filter((r) => TOLD_STATUSES.includes(r.status) && !r.toldAt && !r.autonomous
    && nowMs - Date.parse(r.resolvedAt || r.requestedAt) <= NEWS_WINDOW_MS);
  if (!fresh.length) return { text: '', ids: [] };
  return {
    text: ['## Your wallet requests — decided', ...fresh.map((r) => LINE[r.status](r))].join('\n'),
    ids: fresh.map((r) => r.id),
  };
};

/** impure — the being's notice for this turn. Never throws: no news is ''. */
export const spendNewsFor = async (neumaId) => {
  if (!neumaId) return { text: '', ids: [] };
  try {
    return spendNewsOf(await readSpendRecords(neumaId), Date.now());
  } catch {
    return { text: '', ids: [] };
  }
};
