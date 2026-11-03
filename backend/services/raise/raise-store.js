// A company's raise — `raise.jsonl` beside its line in the company's record,
// append-only (raise-shape.js folds it). Every write is judged against the
// raise as it stands at that instant, under the store's write chain, so a
// signature can only land on the draft the operator read, and a review on the
// sheet counsel saw.
// impure.

import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { companyPath } from '../company-line/company-store.js';
import { foldRaise, judgeReach } from './raise-shape.js';

const serialize = createWriteChain();
const fileOf = (wallet, id) => companyPath(wallet, id, 'raise.jsonl');

/** The raise as it stands — the receiving account included; never hand this to a being (raiseForBeings). */
export const readRaise = async (wallet, id) => {
  const { records, torn } = await readJsonLines(fileOf(wallet, id));
  return { ...foldRaise(records), torn };
};

/**
 * Append the event a judge makes of the raise as it stands, or refuse.
 * @param {string} wallet
 * @param {string} id - the company
 * @param {(state: object) => ({ok: true, event: object} | {ok: false, reason: string})} judge
 */
export const applyRaise = (wallet, id, judge) => serialize(async () => {
  const judged = judge(await readRaise(wallet, id));
  if (!judged.ok) return judged;
  await appendJsonLine(fileOf(wallet, id), judged.event);
  return { ok: true, event: judged.event, state: await readRaise(wallet, id) };
});

// The operator's switch on a signed mandate: pause, resume, close — each only from where it can be.
const FROM = Object.freeze({ paused: ['active'], resumed: ['paused'], closed: ['active', 'paused'] });

/** A status move judged. pure. */
export const judgeStatus = (type, note, now) => (state) => (FROM[type]?.includes(state.status)
  ? { ok: true, event: { type, note: typeof note === 'string' ? note.trim().slice(0, 400) || null : null, by: 'operator', at: now } }
  : { ok: false, reason: `the mandate is ${state.status} — it cannot be ${type} from there` });

/**
 * Reach one investor, under the store's chain so the mandate's pace can never
 * be raced: judge the reach against the raise as it stands, send, and keep
 * the message in the investor's thread — as WRITTEN (the payment placeholder
 * unfilled), so the house's own record never carries the account.
 * @param {string} wallet
 * @param {string} id - the company
 * @param {{investorId: string, subject: string, body: string, by: string, now: string}} message
 * @param {(investor: object, account: object) => Promise<{ok: boolean, messageId?: string, detail?: string}>} send
 */
export const reachUnderChain = (wallet, id, { investorId, subject, body, by, now }, send) => serialize(async () => {
  const state = await readRaise(wallet, id);
  const judged = judgeReach(state, { investorId, now });
  if (!judged.ok) return judged;
  const sent = await send(judged.investor, state.account);
  if (!sent.ok) return { ok: false, reason: `the message was not sent: ${sent.detail}` };
  const event = { type: 'reach', id: investorId, to: judged.investor.email, subject, text: body, messageId: sent.messageId ?? null, by, at: now };
  await appendJsonLine(fileOf(wallet, id), event);
  return { ok: true, event };
});
