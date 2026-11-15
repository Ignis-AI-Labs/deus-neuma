// lp-report.js — what the operator hears about a house member's LP wallet
// (Design note, 2026-11-12: inside the budget they act alone […]; the
// platform writes the report, not the house member).
//
//   · once a local day, after REPORT_HOUR, one card per house member whose LP
//     wallet has positions, did something since the last report, or has a
//     deposit waiting. An unfunded, idle wallet stays quiet;
//   · the moment a deposit passes the budget and starts waiting, one card.
//
// Both ride the notification bus (kinds lp_report and lp_waiting) to the
// lane's owner and open the WALLET window, whose LIQUIDITY layer holds the
// whole picture; the card is the summary. No model turn is spent.

import fs from 'node:fs/promises';
import path from 'node:path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { KIND, STANDING, TEXT_MAX } from '../../../core/runtime/notification-record.js';
import { notifyOperator } from '../notification-bus.js';
import { laneName } from '../house-titles.js';
import { createLogger } from '../logger.js';
import { readLpView } from './lp-view.js';
import { positionAmounts } from '../../../core/wallet/lp-book-math.js';
import { dayOf as localDay } from './lp-book.js';

const log = createLogger('LpReport');

/** The local hour from which the day's report may be written. */
export const REPORT_HOUR = 9;
/** How often the clock looks. The report itself is once a day. */
const CHECK_EVERY_MS = 60 * 60 * 1000;
// What the house member did, and what was decided for it. The operator's own
// setup (opening the wallet, setting the budget) is not news to the operator.
const ACTS = Object.freeze(['LP_ACTION', 'LP_DEPOSIT_WAITING', 'LP_DEPOSIT_APPROVED', 'LP_DEPOSIT_DECLINED']);

const reportFile = (neumaId) => path.join(neumaWorkspace._path(neumaId), 'config', 'lp-report.json');
// pure — a card's title and detail each hold TEXT_MAX characters.
const fit = (text) => (text.length <= TEXT_MAX ? text : `${text.slice(0, TEXT_MAX - 1)}…`);

/** Send one card ({kind, title, detail}) to the lane's owner, naming the house member. impure, never throws. */
export const tellLpOwner = async (neumaId, compose) => {
  try {
    const owner = await neumaWorkspace.readOwner(neumaId);
    if (!owner?.wallet) return null;
    const name = (await laneName(neumaId, owner).catch(() => null)) || neumaId;
    const card = compose(name);
    if (!card) return null;
    return await notifyOperator({
      wallet: owner.wallet, kind: card.kind, standing: STANDING.neuma, title: fit(card.title), detail: fit(card.detail),
      actor: { id: neumaId, name }, ref: { neumaId },
    });
  } catch (err) {
    log.warn('LP card not sent', { neumaId, error: err.message });
    return null;
  }
};

/**
 * Tell the operator a deposit is waiting for them. impure, never throws.
 *
 * @param {string} neumaId
 * @param {{id: string, action: object, depositUsd: string, reason: string}} request
 */
export const tellDepositWaiting = (neumaId, request) => tellLpOwner(neumaId, (name) => ({
  kind: KIND.lpWaiting,
  title: `${name} asks to put $${request.depositUsd} into a liquidity position`,
  detail: `${request.reason.split('. ')[0].replace(/\.$/, '')}. APPROVE or DECLINE in WALLET › LIQUIDITY within a day.`,
}));

// pure — the audit lines about the LP wallet since a moment, oldest first.
const actsSince = (text, sinceMs) => text.split(/\r?\n/).flatMap((line) => {
  try {
    const entry = JSON.parse(line);
    return ACTS.includes(entry.action) && Date.parse(entry.timestamp) > sinceMs ? [entry] : [];
  } catch {
    return [];
  }
});

// pure — dollars from a decimal amount and a price; 0 when either is unreadable (display only).
const usd = (amount, price) => {
  const value = Number(amount) * Number(price);
  return Number.isFinite(value) ? value : 0;
};

/**
 * The day's card for one house member, or null when there is nothing to say:
 * no positions, nothing it did, nothing waiting. Pure.
 *
 * @param {string} name - the house member's name
 * @param {object|null} view - from readLpView
 * @param {Array<object>} acts - audit entries since the last report
 * @returns {null | {kind: string, title: string, detail: string}}
 */
export const composeLpReport = (name, view, acts) => {
  if (!view) return null;
  const held = (view.positions ?? []).flatMap((pool) => (pool?.positions?.userPositions ?? []).map((p) => ({ pool, d: p.positionData ?? {} })));
  if (held.length === 0 && acts.length === 0 && view.pending.length === 0) return null;
  const out = held.filter(({ pool, d }) => {
    const active = pool.positions?.activeBin?.binId;
    return Number.isInteger(active) && (active < d.lowerBinId || active > d.upperBinId);
  }).length;
  const fees = held.reduce((sum, { pool, d }) => {
    const a = positionAmounts(pool, d);
    return sum + usd(a.feeX, pool.poolInfo?.tokenXPriceUsd) + usd(a.feeY, pool.poolInfo?.tokenYPriceUsd);
  }, 0);
  const actions = acts.filter((a) => a.action === 'LP_ACTION').length;
  const waitingUsd = view.pending.reduce((sum, r) => sum + (Number(r.depositUsd) || 0), 0);
  return {
    kind: KIND.lpReport,
    title: `${name}: ${held.length} liquidity position(s)${out ? `, ${out} out of range` : ''}, $${fees.toFixed(2)} in fees waiting`,
    detail: [
      `${actions} action(s) since the last report`,
      view.pending.length ? `${view.pending.length} deposit(s) for $${waitingUsd.toFixed(2)} wait for you` : 'nothing waits for you',
      view.budgetUsd === null ? 'no cap' : `cap $${view.budgetUsd}`,
      `gas ${view.balanceEth === null ? 'unreadable' : `${Number(view.balanceEth).toFixed(4)} ETH`}`,
    ].join(' · '),
  };
};

// impure — one house member's report, when today's is due and not yet written.
const reportOne = async (neumaId, nowMs) => {
  const last = await neumaWorkspace._readTrustedJSON(reportFile(neumaId)).catch(() => null);
  if (last?.day === localDay(nowMs)) return false;
  const view = await readLpView(neumaId);
  if (!view) return false;
  const audit = await fs.readFile(path.join(neumaWorkspace._path(neumaId), 'audit', 'audit.jsonl'), 'utf8').catch(() => '');
  const acts = actsSince(audit, Date.parse(last?.at ?? 0) || 0);
  await neumaWorkspace._writeJSON(reportFile(neumaId), { day: localDay(nowMs), at: new Date(nowMs).toISOString() });
  return Boolean(await tellLpOwner(neumaId, (name) => composeLpReport(name, view, acts)));
};

/**
 * Write today's report for every house member with an LP wallet, once.
 * impure, never throws.
 *
 * @param {number} [nowMs]
 * @returns {Promise<string[]>} the house members a card was sent for
 */
export const reportLpDay = async (nowMs = Date.now()) => {
  if (new Date(nowMs).getHours() < REPORT_HOUR) return [];
  const sent = [];
  for (const neumaId of await neumaWorkspace.listNeuma().catch(() => [])) {
    try {
      if (await reportOne(neumaId, nowMs)) sent.push(neumaId);
    } catch (err) {
      log.warn('LP report failed', { neumaId, error: err.message });
    }
  }
  return sent;
};

/**
 * Stand the daily report up: a look every hour, unref'd so it never holds the
 * process open. impure.
 * @returns {() => void} stop
 */
export const startLpReports = () => {
  const timer = setInterval(() => { reportLpDay().catch(() => {}); }, CHECK_EVERY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
};
