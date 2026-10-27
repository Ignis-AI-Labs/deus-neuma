// waiting-sources.js — every store that holds a decision owed by the
// operator, read for ONE house (the operator's wallet), folded into one list
// (waiting-fold.js). The one source of truth behind the desk's WAITING ON YOU
// indicator and every platform window's band.
//
// The sources, each read where it already lives — no copy, no new store:
//   - chat cards on a portal right now (live-cards.js): tool approvals, a
//     being's questions, plans, seal offers — parked approvals included
//   - house asks still open (house-clock/wake-ledger.js)
//   - a charter version written and not yet approved (house-clock/charter-store.js)
//   - queue drafts — posts and replies — awaiting approval (social/queue-house.js)
//   - open sovereignty proposals of each of the house's beings (sovereignty/proposal-store.js)
//   - the CMO's open asks on the house's campaigns (marketing/campaign-store.js)
//   - the CMO's proposed changes to a company's links (marketing/link-changes.js)
//   - every being's pending wallet spend and the Quaestor's open flags
//     (treasury/treasury-waiting.js, #586)
//   - a paused CMO mandate, and each hostile-text hold it raised (marketing/mandate/)
// Beside the items, not among them: an ACTIVE mandate (`mandate`), which owes
// no decision but stands as the bell's quiet mark while the CMO acts.
// Deliberately NOT here: an unsettled intent file (it becomes a chat card the
// moment a screen is open — counting both would count one decision twice) and
// a team run's check-in (a report, not a decision).
//
// A source that cannot be read is an empty page plus a named gap, never a
// failed account: the desk still shows everything else, and says what it
// could not read.
//
// impure — store reads.
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { createLogger } from '../logger.js';
import { keyLockWaitingItems } from './key-lock-item.js';
import { laneName } from '../house-titles.js';
import { liveCardsFor } from './live-cards.js';
import { readAsks } from '../house-clock/wake-ledger.js';
import { readCharter } from '../house-clock/charter-read.js';
import { charterStanding } from '../house-clock/charter-shape.js';
import { houseEntries } from '../social/queue-house.js';
import { readProposals } from '../sovereignty/proposal-store.js';
import { campaignStoreFor } from '../marketing/campaign-store.js';
import { asksOwedBy } from '../marketing/campaign-asks.js';
import { openLinkChanges } from '../marketing/link-changes.js';
import { treasuryWaitingItems } from '../treasury/treasury-waiting.js';
import { readMandate } from '../marketing/mandate/mandate-store.js';
import { mandateWaitingItem, mandateOnMark } from '../marketing/mandate/mandate-words.js';
import { readHolds } from '../marketing/mandate/mandate-hold-store.js';
import { holdWaitingItem } from '../marketing/mandate/mandate-hold.js';
import { pauseSource, holdSource } from '../marketing/mandate/mandate-sources.js';
import {
  liveCardItem, houseAskItem, charterItem, queueItem, isQueueDecision, proposalItem, campaignAskItem, linkChangeItem, foldWaiting,
} from './waiting-fold.js';

const log = createLogger('waiting');

// impure — the house's own lanes and their names.
const houseLanes = async (wallet) => {
  const lanes = await neumaWorkspace.listNeumaByOwner(wallet).catch(() => []);
  return Promise.all(lanes.map(async ({ neumaId, owner }) => ({ neumaId, name: await laneName(neumaId, owner) })));
};

// One source read: its items, or none and its name in `gaps`.
const read = async (source, fn, gaps) => {
  try {
    return await fn();
  } catch (error) {
    log.warn('a waiting source could not be read', { source, error: error.message });
    gaps.push(source);
    return [];
  }
};

/**
 * impure — everything waiting on this wallet's house, oldest first.
 * @param {string} wallet - the operator's wallet (the house)
 * @returns {Promise<{count: number, oldestAt: ?string, items: object[], gaps: string[], mandate: ?object}>}
 */
export const readWaiting = async (wallet) => {
  const gaps = [];
  let standing = null;
  const lanes = await read('lanes', () => houseLanes(wallet), gaps);
  const names = new Map(lanes.filter((l) => l.name).map((l) => [l.neumaId, l.name]));
  const [cards, asks, charter, queue, proposals, campaignAsks, mandate] = await Promise.all([
    read('chats', async () => liveCardsFor(wallet).map(liveCardItem), gaps),
    read('house-asks', async () => (await readAsks(wallet))
      .filter((a) => a.status === 'open').map((a) => houseAskItem(a, names)), gaps),
    read('charter', async () => {
      const record = await readCharter(wallet);
      return record && charterStanding(record) === 'unapproved' ? [charterItem(record)] : [];
    }, gaps),
    read('queue', async () => {
      const entries = await houseEntries(wallet);
      return entries.filter(isQueueDecision).map((e) => queueItem(e, entries, names));
    }, gaps),
    read('proposals', async () => (await Promise.all(lanes.map(async ({ neumaId }) => {
      const store = await readProposals(neumaId);
      return (store?.proposals || []).filter((p) => p.status === 'open').map((p) => proposalItem(p, neumaId, names));
    }))).flat(), gaps),
    read('campaigns', async () => (await (await campaignStoreFor(wallet)).load())
      .flatMap((c) => asksOwedBy(c, 'operator').map((a) => campaignAskItem(a, c, names))), gaps),
    // A PAUSED mandate waits on the operator's resume or withdraw, and each
    // open hostile-text hold on the operator's CLEAR (marketing/mandate/).
    read('mandate', async () => {
      const [m, holds, entries] = await Promise.all([readMandate(wallet), readHolds(wallet, { pending: false }), houseEntries(wallet).catch(() => [])]);
      standing = mandateOnMark(m);
      // Each row carries its door to what tripped it or what it holds, from this house's own queue.
      const item = mandateWaitingItem(m, { seatName: m ? names.get(m.laneId) : null, door: pauseSource(m, entries) });
      const held = holds.map((h) => holdWaitingItem(h, { seatName: names.get(h.laneId), door: holdSource(h, entries) })).filter(Boolean);
      return [...(item ? [item] : []), ...held];
    }, gaps),
  ]);
  const money = await read('treasury', () => treasuryWaitingItems(lanes, wallet, names), gaps);
  const links = await read('link-changes', async () => (await openLinkChanges(wallet)).map((c) => linkChangeItem(c, names)), gaps);
  const kit = await read('key-lock', () => keyLockWaitingItems(wallet), gaps);
  return Object.freeze({ ...foldWaiting([...cards, ...asks, ...charter, ...queue, ...proposals, ...campaignAsks, ...mandate, ...money, ...links, ...kit]), gaps, mandate: standing });
};
