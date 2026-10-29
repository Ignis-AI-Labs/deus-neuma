// The HANDS record of one company: `hands.jsonl` beside its line, append-only
// (hands-shape.js folds it). A raise is refused once the company holds
// OPEN_MAX open items — a house that asks for twenty acts at once has stopped
// asking and started dumping — and an answer lands only on an item still
// open, both checked under the store's write chain so a race lands once.
// impure.

import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { companyPath } from './company-store.js';
import { foldHands, judgeAnswer, OPEN_MAX } from './hands-shape.js';

const serialize = createWriteChain();
const fileOf = (wallet, id) => companyPath(wallet, id, 'hands.jsonl');

/**
 * Every HANDS item of a company, oldest first.
 * @param {string} wallet
 * @param {string} id - the company
 * @returns {Promise<{items: object[], skipped: number, torn: number}>}
 */
export const readHands = async (wallet, id) => {
  const { records, torn } = await readJsonLines(fileOf(wallet, id));
  return { ...foldHands(records), torn };
};

/**
 * Raise one item. impure.
 * @returns {Promise<{ok: true, item: object} | {ok: false, reason: string}>}
 */
export const raiseHands = (wallet, id, item) => serialize(async () => {
  const { items } = await readHands(wallet, id);
  if (items.filter((i) => i.status === 'open').length >= OPEN_MAX) {
    return { ok: false, reason: `the operator already holds ${OPEN_MAX} open HANDS items for this company — wait for answers before asking for more` };
  }
  await appendJsonLine(fileOf(wallet, id), { type: 'raised', item, at: item.raisedAt });
  return { ok: true, item };
});

/**
 * The operator answers one item. impure.
 * @param {{status: string, text?: string, now: string}} answer
 * @returns {Promise<{ok: true, event: object} | {ok: false, reason: string}>}
 */
export const answerHands = (wallet, id, handsId, answer) => serialize(async () => {
  const { items } = await readHands(wallet, id);
  const judged = judgeAnswer(items.find((i) => i.id === handsId), answer);
  if (!judged.ok) return judged;
  await appendJsonLine(fileOf(wallet, id), judged.event);
  return judged;
});
