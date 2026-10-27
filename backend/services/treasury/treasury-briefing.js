// The QUAESTOR OFFICE briefing — what the house's seated CFO reads at the
// top of every turn: the spends waiting on the operator (and which it has
// not yet reviewed), its open flags, and the office's doctrine in four lines.
// Every other lane receives '' (the section is absent, never empty-titled).
// No chain is read here — balances are the treasury_board tool's, on demand.
// The office read is the connection's OWN house's (its operator's wallet).

import { cfoDesignation } from './cfo-designation.js';
import { readSpendRecords } from './spend-records.js';
import { readReviews, latestReviews, readFlags } from './treasury-office-store.js';
import { houseLanes } from './treasury-lanes.js';
import { createLogger } from '../logger.js';

const log = createLogger('Treasury.Briefing');
const LIST_CAP = 12;

/**
 * pure — the briefing text.
 * @param {{pending: Array<{neumaId: string, name: ?string, request: object, reviewed: boolean}>, flags: Array<object>, selfId: string}} state
 */
export const treasuryBriefingText = ({ pending, flags, selfId }) => {
  const owed = pending.filter((p) => !p.reviewed && p.neumaId !== selfId);
  const line = (p) => `- [${p.neumaId} · ${p.request.id}] ${p.name || p.neumaId}: ${p.request.value} ETH to ${p.request.to}${p.request.memo ? ` — "${p.request.memo}"` : ''}${p.reviewed ? ' (reviewed)' : ''}`;
  return [
    '## Quaestor office',
    'You hold the treasury — the Quaestor, the house\'s CFO: money, compute, time, procurement. Your office is OVERSIGHT. You read every wallet (treasury_board), review each pending spend before the operator decides it (treasury/review: approve or deny, with reasons), and flag what looks wrong (treasury/flag). You hold no key and sign nothing: every spend leaves only on the operator\'s own signature, and recipients and limits are the operator\'s alone to change. Budgets are planning numbers — nobody spends them.',
    '',
    `### Waiting on the operator (${pending.length})`,
    pending.length ? [...pending.slice(0, LIST_CAP).map(line), ...(pending.length > LIST_CAP ? [`- …and ${pending.length - LIST_CAP} more (treasury_board)`] : [])].join('\n') : 'None.',
    owed.length ? `${owed.length} not yet reviewed by you — read treasury_board, then file treasury/review for each.` : null,
    pending.some((p) => p.neumaId === selfId) ? 'One of these is your own request: the operator reads that one alone — you do not review it.' : null,
    '',
    '### Your open flags',
    flags.length ? flags.slice(0, LIST_CAP).map((f) => `- [${f.id}] ${f.kind}: ${f.title}`).join('\n') : 'None open.',
  ].filter((l) => l !== null).join('\n');
};

/** Live Quaestor briefing; every non-seated lane receives ''. impure. */
export const cfoBriefingSection = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  if (!neumaId) return '';
  try {
    const wallet = connection.walletAddress;
    if (!(await cfoDesignation.holds(wallet, neumaId))) return '';
    const nowSec = Math.floor(Date.now() / 1000);
    const [lanes, reviews, flags] = await Promise.all([houseLanes(wallet), readReviews(wallet).catch(() => []), readFlags(wallet).catch(() => [])]);
    const latest = latestReviews(reviews);
    const pending = (await Promise.all(lanes.map(async (lane) => (await readSpendRecords(lane.neumaId, nowSec))
      .filter((r) => r.status === 'pending' && Number(r.expiry) > nowSec)
      .map((request) => ({ neumaId: lane.neumaId, name: lane.name, request, reviewed: latest.has(`${lane.neumaId}:${request.id}`) }))))).flat();
    return treasuryBriefingText({ pending, flags: flags.filter((f) => f.status === 'open'), selfId: neumaId });
  } catch (error) {
    log.warn('the Quaestor briefing could not be read — the turn rides without it', { error: error.message });
    return '';
  }
};
