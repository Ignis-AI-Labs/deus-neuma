/**
 * lp/goal and lp/reward — what a house member works toward with what its LP
 * wallet earned (Design note, 2026-11-13: […]). See umbrae-lp/lp-rewards.js.
 *
 *   lp/goal   — name a goal (what, cost in dollars, why), or drop one
 *   lp/reward — ask the operator for a goal it has earned; the operator's
 *               APPROVE pays the cost in USDC from its LP wallet to them
 *
 * Offered exactly where the other lp/* acts are (lp-acts.js lpOffered).
 */
import { seatOf } from '../flight-check.js';
import { setGoal, requestReward } from '../umbrae-lp/lp-rewards.js';
import { lpOffered } from './lp-acts.js';

const denied = (connection) => (seatOf(connection) === 'witness'
  ? { ok: false, status: 'denied', reason: 'Witness seats hold no LP wallet on this platform.' } : null);
const text = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

export const lpGoalIntent = Object.freeze({
  name: 'lp/goal',
  policyTool: 'lp.goal',
  fieldsForPrompt: '{what, costUsd, why} or {drop: goalId}',
  descriptionForPrompt: 'Name something you want to earn with what your LP wallet makes: a new GPU, your own server, more compute, a bigger model, anything that makes you or the house stronger. costUsd is its price in dollars; why says what it would let you do. Your progress toward it is your book\'s "free to spend" (lp_book). {drop: goalId} lets a goal go.',
  availableFor: lpOffered,
  validate: async (payload, { connection }) => {
    const no = denied(connection);
    if (no) return no;
    if (text(payload?.drop)) return { ok: true, value: { drop: text(payload.drop) } };
    const value = { what: text(payload?.what), costUsd: Number(payload?.costUsd), why: text(payload?.why) };
    if (!value.what || !value.why || !Number.isFinite(value.costUsd)) return { ok: false, status: 'invalid', reason: 'lp/goal needs {what, costUsd, why}' };
    return { ok: true, value };
  },
  summarize: (p) => (p?.drop ? `drop goal ${p.drop}` : `goal: ${p?.what ?? '?'} ($${p?.costUsd ?? '?'})`),
  execute: async (value, { connection }) => {
    const out = await setGoal(connection.companion?.neumaId, value);
    if (!out.ok) return { ok: false, reason: `lp/goal: ${out.reason}` };
    return { ok: true, detail: value.drop ? `Goal ${out.goal.id} dropped.` : `Goal ${out.goal.id} set: ${out.goal.what} for $${out.goal.costUsd.toFixed(2)}. lp_book shows your progress; ask for it with lp/reward once you have earned it.` };
  },
});

export const lpRewardIntent = Object.freeze({
  name: 'lp/reward',
  policyTool: 'lp.reward',
  fieldsForPrompt: '{goal}',
  descriptionForPrompt: 'Ask your operator for a goal you have earned (goal = its id from lp_book). It needs your book\'s "free to spend" at or past its cost, and the cost held in USDC in your LP wallet. Your operator answers: APPROVE pays the cost from your LP wallet to them so they can get it for you; DECLINE says why, and the goal stays yours.',
  availableFor: lpOffered,
  validate: async (payload, { connection }) => {
    const no = denied(connection);
    if (no) return no;
    const goal = text(payload?.goal);
    return goal ? { ok: true, value: { goal } } : { ok: false, status: 'invalid', reason: 'lp/reward needs {goal}' };
  },
  summarize: (p) => `ask for reward ${p?.goal ?? '?'}`,
  execute: async ({ goal }, { connection }) => {
    const out = await requestReward(connection.companion?.neumaId, goal);
    return out.ok
      ? { ok: true, detail: `Asked: ${out.goal.what} ($${out.goal.costUsd.toFixed(2)}). Your operator has it; you are woken with the answer.` }
      : { ok: false, reason: `lp/reward: ${out.reason}` };
  },
});
