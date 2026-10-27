// spend-card — one pending spend as the operator decides it (#586): who
// asks and in its own words why, the exact amount, asset and chain, the
// recipient and where it stands on the operator's allowlist (and a plain
// warning when the being has never sent there), the wallet it leaves and
// that wallet's balance after, the limits that hold, the time left, and the
// Quaestor's review when one was written. Pure.
//
// Amounts are exact: every figure is decimal ETH computed in wei (ethers'
// parse/format), never a float, never rounded. A balance the chain did not
// answer is null — never a zero that would read as an empty wallet.
import { ethers } from 'ethers';

export const SPEND_ASSET = 'ETH';

// pure — wei, or null when the text is not an ETH amount.
const weiOf = (value) => {
  try {
    return ethers.parseEther(String(value));
  } catch {
    return null;
  }
};

const lower = (a) => String(a || '').toLowerCase();

/**
 * The recipient's standing: on the allowlist now (with the operator's label
 * and the day it was approved), or removed since the request; and how often
 * this being's money has gone there before. Pure.
 * @param {string} to
 * @param {{entries?: Array<{address: string, label?: string, addedAt?: string}>}|null} allowlist
 * @param {ReadonlyArray<object>} records - the lane's whole spend ledger
 */
export const recipientStanding = (to, allowlist, records) => {
  const entry = (allowlist?.entries || []).find((e) => lower(e.address) === lower(to)) || null;
  const priorSends = records.filter((r) => r.status === 'executed' && lower(r.to) === lower(to)).length;
  return Object.freeze({
    address: to,
    label: entry?.label || '',
    standing: entry ? 'approved' : 'removed',
    approvedAt: entry?.addedAt || null,
    priorSends,
    firstTime: priorSends === 0,
  });
};

/**
 * The wallet the money leaves, and its balance once this amount is gone.
 * Pure. `short` when the balance read does not cover the amount.
 * @param {?string} address
 * @param {?string} balanceEth - decimal ETH as read, or null (unread)
 * @param {?bigint} valueWei
 */
export const fromWallet = (address, balanceEth, valueWei) => {
  const balanceWei = balanceEth === null || balanceEth === undefined ? null : weiOf(balanceEth);
  const after = balanceWei !== null && valueWei !== null ? balanceWei - valueWei : null;
  return Object.freeze({
    address: address || null,
    balanceEth: balanceWei === null ? null : ethers.formatEther(balanceWei),
    balanceAfterEth: after === null ? null : ethers.formatEther(after),
    short: after !== null && after < 0n,
  });
};

/**
 * One pending spend, whole, for the operator's card. Pure.
 * @param {object} request - the pending record (neuma-wallet-spend.js requestSpend)
 * @param {{neumaId: string, name: ?string, network: string, chainLabel: string,
 *   allowlist: object|null, thresholdEth: number, capEth: string, address: ?string,
 *   balanceEth: ?string, records: ReadonlyArray<object>, review: ?object, nowSec: number}} ctx
 */
export const spendCardOf = (request, ctx) => {
  const valueWei = weiOf(request.value);
  return Object.freeze({
    id: request.id,
    neumaId: ctx.neumaId,
    who: Object.freeze({ laneId: ctx.neumaId, name: ctx.name || null }),
    // The being's own words, as it wrote them — never paraphrased.
    reason: typeof request.memo === 'string' && request.memo.trim() ? request.memo : null,
    amount: String(request.value),
    amountValid: valueWei !== null && valueWei > 0n,
    asset: SPEND_ASSET,
    network: ctx.network,
    chain: ctx.chainLabel,
    recipient: recipientStanding(request.to, ctx.allowlist, ctx.records),
    from: fromWallet(ctx.address, ctx.balanceEth, valueWei),
    limits: Object.freeze({
      // What clears without the operator (the standing threshold) and the hard
      // per-send cap on those sends; this card is above the threshold, so it
      // goes out only on the operator's own signature, for this exact amount.
      thresholdEth: Number(ctx.thresholdEth) || 0,
      capEth: ctx.capEth,
      signatureNeeded: true,
    }),
    requestedAt: request.requestedAt || null,
    expiresAt: new Date(Number(request.expiry) * 1000).toISOString(),
    secondsLeft: Math.max(0, Number(request.expiry) - ctx.nowSec),
    // What the approval signs — the exact bytes (core/wallet/spend-policy.js).
    approval: Object.freeze({ to: request.to, value: String(request.value), expiry: request.expiry, nonce: request.nonce }),
    review: ctx.review
      ? Object.freeze({ recommend: ctx.review.recommend, reasons: ctx.review.reasons, by: ctx.review.by, at: ctx.review.at })
      : null,
  });
};

/**
 * One settled record for the history: what went out, what did not, and why.
 * Pure.
 * @param {object} record
 * @param {{neumaId: string, name: ?string}} who
 */
export const historyRowOf = (record, { neumaId, name }) => Object.freeze({
  id: record.id,
  neumaId,
  name: name || null,
  status: record.status,
  autonomous: record.autonomous === true,
  amount: String(record.value),
  asset: SPEND_ASSET,
  to: record.to,
  reason: typeof record.memo === 'string' && record.memo.trim() ? record.memo : null,
  note: record.note || null,
  txHash: record.txHash || null,
  failure: record.failure || null,
  requestedAt: record.requestedAt || null,
  resolvedAt: record.resolvedAt || null,
  told: Boolean(record.toldAt),
});
