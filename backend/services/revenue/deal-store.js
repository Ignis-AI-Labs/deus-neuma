// The house's deals — the Mercator office's record, append-only events in
// `<realm>/<wallet>/offices/revenue/deals.jsonl` (deal-shape.js folds them).
// A deal opens only where the rest law allows, and a move lands only on a deal
// still open — both re-checked under the store's write chain, so a race lands
// once.
// impure.

import { officeFile } from '../house-office.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { foldDeals, judgeMove, restRefusal } from './deal-shape.js';

const serialize = createWriteChain();
const fileOf = (wallet) => officeFile(wallet, 'revenue', 'deals.jsonl');

/** The house's deals, oldest first. @returns {Promise<{deals: object[], skipped: number, torn: number}>} */
export const readDeals = async (wallet) => {
  const { records, torn } = await readJsonLines(fileOf(wallet));
  return { ...foldDeals(records), torn };
};

/** Open a deal. @returns {Promise<{ok: true, deal: object} | {ok: false, reason: string}>} */
export const openDeal = (wallet, deal) => serialize(async () => {
  const refusal = restRefusal(deal, (await readDeals(wallet)).deals);
  if (refusal) return { ok: false, reason: refusal };
  await appendJsonLine(fileOf(wallet), { type: 'opened', deal, at: deal.openedAt });
  return { ok: true, deal };
});

/** Move a deal. @returns {Promise<{ok: true, event: object} | {ok: false, reason: string}>} */
export const moveDeal = (wallet, id, move) => serialize(async () => {
  const judged = judgeMove((await readDeals(wallet)).deals.find((d) => d.id === id), move);
  if (!judged.ok) return judged;
  await appendJsonLine(fileOf(wallet), judged.event);
  return judged;
});

/**
 * Move a deal and carry the outcome to its lead: a deal won or lost moves the lead it came from on the lead ledger.
 * The one road for the seat's act and the operator's own press. A ledger that will not move never costs the deal.
 * @returns {Promise<{ok: true, event: object, deal: ?object} | {ok: false, reason: string}>}
 */
export const moveDealAndLead = async (wallet, id, move) => {
  const moved = await moveDeal(wallet, id, move);
  if (!moved.ok) return moved;
  const deal = (await readDeals(wallet)).deals.find((d) => d.id === id) ?? null;
  if (deal?.leadId && ['won', 'lost'].includes(moved.event.stage)) {
    try {
      const { leadLedgerFor } = await import('../leads/lead-ledger.js');
      await (await leadLedgerFor(wallet)).touch(deal.leadId, { status: moved.event.stage, note: `deal [${id}] ${moved.event.stage}: ${moved.event.note}`, by: move.by });
    } catch { /* the deal stands */ }
  }
  return { ...moved, deal };
};
