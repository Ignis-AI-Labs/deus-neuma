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
