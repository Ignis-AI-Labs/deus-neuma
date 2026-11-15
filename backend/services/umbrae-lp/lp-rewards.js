// lp-rewards.js — what a house member works toward with what it earned (Founder
// 2026-11-13: […]).
//
//   goal      the member names what it wants, what it costs, and why;
//             its progress is its earnings book's "free to spend" figure
//   request   once it has earned the cost and holds it in USDC, it asks
//   answer    the operator APPROVES: the cost is paid in USDC from the member's
//             LP wallet to the operator, who gets it the thing; or DECLINES,
//             saying why, and the goal stays the member's to work toward
//   delivered the operator marks it given; it stays on the member's record
//
// The record is the platform's (encrypted config, refused as plain text on
// read), so a member cannot approve its own reward. The payment is a house
// send through the signing rule (lp-trade.js runSend, purpose 'reward'), and
// the book counts it as a reward paid, never as money handed back.

import crypto from 'node:crypto';
import path from 'node:path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { KIND } from '../../../core/runtime/notification-record.js';
import { signalWake } from '../house-clock/wake-signal.js';
import { lpWalletAddress } from './lp-wallet.js';
import { readHoldings } from './lp-holdings.js';
import { readPositions } from './lp-view.js';
import { bookTick } from './lp-book.js';
import { runSend } from './lp-trade.js';
import { tellLpOwner } from './lp-report.js';

const file = (neumaId) => path.join(neumaWorkspace._path(neumaId), 'config', 'lp-rewards.json');
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
/** Goals a member may hold open at once. */
export const OPEN_GOALS_MAX = 5;
export const COST_MAX_USD = 1_000_000;
const OPEN = Object.freeze(['working', 'requested']);
const refuse = (reason) => Object.freeze({ ok: false, reason });

/** The member's goals, newest last. impure — reads config. */
export const readGoals = async (neumaId) => {
  const rec = await neumaWorkspace._readTrustedJSON(file(neumaId)).catch(() => null);
  return Array.isArray(rec?.goals) ? rec.goals : [];
};
const writeGoals = (neumaId, goals) => neumaWorkspace._writeJSON(file(neumaId), { goals: goals.slice(-100) });

// impure — the book's figures now (holdings and positions read fresh).
const figuresNow = async (neumaId) => {
  const address = await lpWalletAddress(neumaId);
  if (!address) return null;
  const [holdings, held] = await Promise.all([readHoldings(address).catch(() => null), readPositions(neumaId).catch(() => ({}))]);
  if (!holdings) return null;
  const look = await bookTick(neumaId, { holdings, positions: held.pools ?? null });
  const usdc = holdings.find((h) => h.key === USDC);
  return { ...look.figures, usdcHeld: usdc ? Number(usdc.raw) / 10 ** usdc.decimals : 0 };
};

/**
 * Set a goal, or drop one. The member's act. impure.
 * @param {string} neumaId
 * @param {{what?: string, costUsd?: number|string, why?: string, drop?: string}} ask
 */
export const setGoal = async (neumaId, { what, costUsd, why, drop } = {}) => {
  const goals = await readGoals(neumaId);
  if (drop) {
    const goal = goals.find((g) => g.id === drop && g.status === 'working');
    if (!goal) return refuse('No goal of yours that is still being worked toward has that id.');
    goal.status = 'dropped';
    goal.droppedAt = new Date().toISOString();
    await writeGoals(neumaId, goals);
    return Object.freeze({ ok: true, goal });
  }
  const w = String(what ?? '').trim();
  const y = String(why ?? '').trim();
  const cost = Math.round(Number(costUsd) * 100) / 100;
  if (!w || w.length > 120) return refuse('Name what you want in at most 120 characters.');
  if (!y || y.length > 500) return refuse('Say why you want it (how it makes you or the house stronger), in at most 500 characters.');
  if (!Number.isFinite(cost) || cost < 1 || cost > COST_MAX_USD) return refuse(`The cost is a dollar amount from 1 to ${COST_MAX_USD}.`);
  if (goals.filter((g) => OPEN.includes(g.status)).length >= OPEN_GOALS_MAX) return refuse(`You hold ${OPEN_GOALS_MAX} open goals already; drop one first.`);
  const goal = { id: `g-${crypto.randomBytes(4).toString('hex')}`, what: w, costUsd: cost, why: y, status: 'working', setAt: new Date().toISOString() };
  await writeGoals(neumaId, [...goals, goal]);
  await neumaWorkspace.audit(neumaId, 'LP_GOAL_SET', { id: goal.id, what: w, costUsd: cost });
  return Object.freeze({ ok: true, goal });
};

/**
 * Ask the operator for a goal's reward. Only what the member earned pays for
 * it, and the wallet must hold the cost in USDC. The member's act. impure.
 * @param {string} neumaId
 * @param {string} goalId
 */
export const requestReward = async (neumaId, goalId) => {
  const goals = await readGoals(neumaId);
  const goal = goals.find((g) => g.id === goalId);
  if (!goal || goal.status !== 'working') return refuse('No goal of yours that is still being worked toward has that id.');
  const figures = await figuresNow(neumaId);
  if (!figures) return refuse('Your LP wallet could not be read right now; ask again in a moment.');
  if (figures.freeUsd < goal.costUsd) return refuse(`You have earned $${figures.freeUsd.toFixed(2)} free to spend; "${goal.what}" costs $${goal.costUsd.toFixed(2)}. Keep earning.`);
  if (figures.usdcHeld < goal.costUsd) return refuse(`A reward is paid in USDC and your wallet holds ${figures.usdcHeld.toFixed(2)} USDC; swap into USDC first (lp/swap).`);
  goal.status = 'requested';
  goal.requestedAt = new Date().toISOString();
  await writeGoals(neumaId, goals);
  await neumaWorkspace.audit(neumaId, 'LP_REWARD_REQUESTED', { id: goal.id, costUsd: goal.costUsd });
  await tellLpOwner(neumaId, (name) => ({
    kind: KIND.lpReward,
    title: `${name} earned its reward: ${goal.what} ($${goal.costUsd.toFixed(2)})`,
    detail: `Earned ${figures.earnedUsd >= 0 ? '+' : '−'}$${Math.abs(figures.earnedUsd).toFixed(2)}. APPROVE pays $${goal.costUsd.toFixed(2)} USDC from its LP wallet to you. WALLET › LIQUIDITY.`,
  }));
  return Object.freeze({ ok: true, goal, figures });
};

/**
 * The operator's answer to a requested reward, or its delivery. impure — an
 * approval pays from the member's LP wallet; the member is woken with the answer.
 * @param {string} neumaId
 * @param {string} goalId
 * @param {'approved'|'declined'|'delivered'} answer
 * @param {{note?: string, provider?: object}} [opts]
 */
export const answerReward = async (neumaId, goalId, answer, { note, provider } = {}) => {
  const goals = await readGoals(neumaId);
  const goal = goals.find((g) => g.id === goalId);
  const said = typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null;
  if (answer === 'delivered') {
    if (goal?.status !== 'paid') return refuse('Only a paid reward can be marked delivered.');
    Object.assign(goal, { status: 'delivered', deliveredAt: new Date().toISOString(), ...(said ? { deliveredNote: said } : {}) });
    await writeGoals(neumaId, goals);
    await neumaWorkspace.addJournalEntry(neumaId, { type: 'lp-reward', content: `My reward arrived: ${goal.what}, earned with $${goal.costUsd.toFixed(2)} of what my LP wallet made.${said ? ` My operator said: "${said}"` : ''}` }).catch(() => {});
    return Object.freeze({ ok: true, goal });
  }
  if (!['approved', 'declined'].includes(answer)) return refuse('The answer is approved, declined or delivered.');
  if (goal?.status !== 'requested') return refuse('That reward is not waiting for an answer.');
  if (answer === 'approved') {
    // Marked before paying, so a second press finds it no longer waiting and pays nothing.
    goal.status = 'paying';
    await writeGoals(neumaId, goals);
    const paid = await runSend(neumaId, { to: 'operator', token: 'USDC', amount: goal.costUsd.toFixed(2), why: `reward: ${goal.what}` }, { purpose: 'reward', provider });
    if (!paid.ok) {
      goal.status = 'requested';
      await writeGoals(neumaId, goals);
      return refuse(`The reward could not be paid: ${paid.reason}`);
    }
    Object.assign(goal, { status: 'paid', paidAt: new Date().toISOString(), txHash: paid.txHashes[0], ...(said ? { note: said } : {}) });
  } else {
    Object.assign(goal, { status: 'working', declinedAt: new Date().toISOString(), note: said });
  }
  await writeGoals(neumaId, goals);
  await neumaWorkspace.audit(neumaId, answer === 'approved' ? 'LP_REWARD_PAID' : 'LP_REWARD_DECLINED', { id: goal.id, costUsd: goal.costUsd });
  signalWake({ seat: neumaId, reason: 'lp', ref: `reward-${goal.id}-${answer}`, detail: { event: 'reward-answered', answer, what: goal.what.slice(0, 80), costUsd: goal.costUsd, note: said?.slice(0, 120) ?? null } });
  return Object.freeze({ ok: true, goal });
};

/**
 * The goals as lines the member reads, with its progress. Pure.
 * @param {Array<object>} goals
 * @param {number} freeUsd - the book's free-to-spend figure
 * @returns {string[]}
 */
export const goalLines = (goals, freeUsd) => {
  const open = goals.filter((g) => OPEN.includes(g.status));
  const done = goals.filter((g) => g.status === 'paid' || g.status === 'delivered').slice(-5);
  return [
    `YOUR GOALS (rewards you earn with what you make; at most ${OPEN_GOALS_MAX} open):`,
    ...(open.length ? open.map((g) => {
      const pct = Math.min(100, Math.floor((Math.max(0, freeUsd) / g.costUsd) * 100));
      const state = g.status === 'requested' ? 'ASKED, waiting for your operator' : pct >= 100 ? 'EARNED: ask for it (lp/reward)' : `${pct}%`;
      return `  ${g.id} ${g.what}: $${g.costUsd.toFixed(2)} · ${state}${g.note ? ` · last answer: "${g.note}"` : ''} · why: ${g.why}`;
    }) : ['  none yet: name something worth working toward (lp/goal).']),
    ...(done.length ? ['  Earned before:', ...done.map((g) => `    ${g.what} ($${g.costUsd.toFixed(2)}) ${g.status === 'delivered' ? 'delivered' : 'paid, on its way'}`)] : []),
  ];
};
