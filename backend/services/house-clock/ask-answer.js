/**
 * THE OPERATOR ANSWERS — what house work filed for them, answered in the
 * HOUSE CLOCK (Design note, 2026-10-16: […]).
 *
 * One answer per ask, by its kind:
 *   - an ACT: ALLOW (once) writes a one-shot grant for exactly that seat,
 *     tool and arguments (one-shot-grants.js), recorded on the act ledger as
 *     the operator's consent; DENY grants nothing;
 *   - a PLAN: APPROVE makes it the lead's plan of record through the
 *     operator's yes path, stamped approvedBy operator; REVISE sends it back
 *     with their notes (wake-plan.js operatorRulesPlan);
 *   - a DECISION: REPLY with their words and/or one of the asker's choices.
 * Every answer closes the ask with {answeredAt, decision, text?, option?} and
 * wakes the asking seat (reason 'operator-answer'), whose opening note
 * carries the answer verbatim (wake-thought.js). The first answer stands.
 *
 * Only the operator's own authenticated answer reaches here (the route, under
 * their token, their house only). Nothing here answers for them.
 *
 * Pure: the answer's law (answerCheck). impure: answerAsk.
 */
import { recordAct } from '../act-ledger.js';
import { readAsks, recordAnswer, settleChain } from './wake-ledger.js';
import { grantOnce } from './one-shot-grants.js';
import { operatorRulesPlan } from './wake-plan.js';
import { enqueueWake } from './wake-queue.js';

/** The answers each kind of ask takes. */
export const ANSWER_DECISIONS = Object.freeze({ act: ['allow', 'deny'], plan: ['approve', 'revise'], decision: ['reply'] });
export const ANSWER_TEXT_MAX = 4000;

/** A refusal the route turns into its status. */
export class AnswerError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, reason) => ({ ok: false, status, reason });

/**
 * Whether this answer may settle this ask, and its clean form. Pure.
 * @param {?Object} ask - as readAsks returns it
 * @param {{decision?: unknown, text?: unknown, option?: unknown}} answer
 * @returns {{ok: true, value: {decision: string, text?: string, option?: string}} | {ok: false, status: number, reason: string}}
 */
export const answerCheck = (ask, { decision, text, option } = {}) => {
  if (!ask) return fail(404, 'this house filed no such ask');
  if (ask.status !== 'open') return fail(409, `this ask is already ${ask.status}`);
  const allowed = ANSWER_DECISIONS[ask.kind];
  if (!allowed) return fail(409, 'this ask cannot be answered here — close it');
  if (!allowed.includes(decision)) return fail(400, `a ${ask.kind} ask is answered ${allowed.join(' or ')}`);
  if (text != null && (typeof text !== 'string' || text.length > ANSWER_TEXT_MAX)) return fail(400, `your words are text of at most ${ANSWER_TEXT_MAX} characters`);
  if (option != null && (typeof option !== 'string' || !(ask.options ?? []).includes(option))) return fail(400, 'that is not one of the choices this ask offered');
  const words = typeof text === 'string' ? text.trim() : '';
  if (decision === 'reply' && !words && !option) return fail(400, 'a reply needs your words or one of its choices');
  if (decision === 'revise' && !words) return fail(400, 'say what must change');
  if (decision === 'allow' && !ask.argsHash) return fail(409, 'this ask was filed before ALLOW ONCE existed — close it, and tell the seat in its sitting');
  if (ask.kind === 'plan' && !ask.planId) return fail(409, 'this plan was not recorded when it was filed — close it, and tell the lead in its sitting');
  return { ok: true, value: { decision, ...(words ? { text: words } : {}), ...(option ? { option } : {}) } };
};

// impure — the answer's own effect, before it is recorded: a grant, or a ruled plan
const apply = async (wallet, ask, { decision, text }, by) => {
  if (ask.kind === 'act' && decision === 'allow') {
    await grantOnce(wallet, { askId: ask.id, seat: ask.seat, tool: ask.tool, argsHash: ask.argsHash, by });
    // THE CONSENT ITSELF, on the operator's act ledger (SEC-035): metadata only.
    await recordAct({
      laneId: ask.seat, tool: ask.tool, scope: ask.scope ?? null,
      decision: 'operator-allowed-once', approvedBy: { kind: 'operator', askId: ask.id }, status: 'granted',
    });
  }
  if (ask.kind === 'plan') {
    try {
      await operatorRulesPlan(wallet, { askId: ask.id, planId: ask.planId, decision, text });
    } catch (err) {
      throw new AnswerError(409, err.message);
    }
  }
};

/**
 * The operator answers one ask of their own house. impure.
 * @param {string} wallet - the house (the operator's own wallet)
 * @param {string} id - the ask
 * @param {{decision: string, text?: string, option?: string}} answer
 * @param {{by: string}} who
 * @returns {Promise<{ask: Object, woken: {queued: boolean, why?: string}}>} throws AnswerError on a refusal
 */
export const answerAsk = (wallet, id, answer, { by }) => settleChain(async () => {
  const ask = (await readAsks(wallet)).find((a) => a.id === id) ?? null;
  const judged = answerCheck(ask, answer);
  if (!judged.ok) throw new AnswerError(judged.status, judged.reason);
  await apply(wallet, ask, judged.value, by);
  const answered = await recordAnswer(wallet, { askId: id, by, answer: judged.value });
  const woken = await enqueueWake(wallet, {
    seat: ask.seat, reason: 'operator-answer', ref: id, detail: { kind: ask.kind, decision: judged.value.decision },
  });
  return { ask: answered, woken: { queued: woken.queued, ...(woken.why ? { why: woken.why } : {}) } };
});
