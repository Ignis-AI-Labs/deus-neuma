// THE WEEKLY SENDING GOAL — how many emails the operator means to send in a week, split across the campaigns they
// name, so the screen can say where each campaign stands against its share.
//
// Design note, 2026-11-24: […]
//
// One setting a house, the operator's alone: the number for the week, and the campaigns it is split between (evenly).
// It sends nothing and holds nothing: it is the measure the EMAILS screen reads what was sent against (send-pace.js).
// Append-only in the house's revenue office: { type: 'set', weekly, campaigns: [id], by: 'operator', at }
// The shaping is PURE; the store is impure.

import { officeFile } from '../house-office.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';

const FILE = 'send-goal.jsonl';
export const WEEKLY_MAX = 5000;
export const CAMPAIGNS_MAX = 20;
const serialize = createWriteChain();
const fileOf = (wallet) => officeFile(wallet, 'revenue', FILE);

/**
 * pure — a goal, or a thrown reason.
 * @param {{weekly: number, campaigns?: string[]}} f - weekly 0 takes the goal away
 */
export const makeGoal = (f) => {
  const weekly = f?.weekly === null || f?.weekly === '' || typeof f?.weekly === 'boolean' ? NaN : Number(f?.weekly);
  if (!Number.isInteger(weekly) || weekly < 0 || weekly > WEEKLY_MAX) throw new Error(`weekly: how many emails a week, a whole number from 0 (no goal) to ${WEEKLY_MAX}`);
  const campaigns = [...new Set((Array.isArray(f?.campaigns) ? f.campaigns : []).map((c) => String(c ?? '').trim()).filter(Boolean))];
  if (campaigns.length > CAMPAIGNS_MAX) throw new Error(`campaigns: at most ${CAMPAIGNS_MAX}`);
  if (weekly > 0 && !campaigns.length) throw new Error('campaigns: the campaigns the week\'s number is split between');
  return Object.freeze({ weekly, campaigns: Object.freeze(campaigns) });
};

/** The goal as it stands, or null when none was set (or it was taken away). */
export const readGoal = async (wallet) => {
  const last = (await readJsonLines(fileOf(wallet)).catch(() => ({ records: [] }))).records.filter((e) => e?.type === 'set').at(-1);
  return last && last.weekly > 0 ? { weekly: last.weekly, campaigns: last.campaigns ?? [], at: last.at } : null;
};

/** The operator sets the week's goal. */
export const setGoal = (wallet, goal) => serialize(async () => { await appendJsonLine(fileOf(wallet), { type: 'set', ...goal, by: 'operator', at: new Date().toISOString() }); return { ok: true }; });
