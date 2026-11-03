// PROGRAMMES — chained team runs toward one goal, re-planned between runs
// (the house economy's Stage 5: […]). A lead opens a programme with its goal and
// how many runs it may take; each team run the lead dispatches while it is
// open joins it; when a run ends, the lead is woken with where the programme
// stands and either submits its next plan, revised by what the run taught
// (plan_submit — the Optio approves it inside the charter, while runs
// remain), or closes the programme with why. The charter caps the runs a
// programme may take (delegation.maxProgrammeRuns); past them, a plan goes to
// the operator.
// One record per house: `<realm>/<wallet>/programmes.json`.
// The folds are pure; the store is impure.

import path from 'path';
import crypto from 'crypto';
import { walletDir } from '../user-realm.js';
import { readJson, writePrivate, ABSENT } from '../house-office-legacy.js';
import { createWriteChain } from '../write-chain.js';

export const PROGRAMME_RUNS_MAX = 20;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);
const serialize = createWriteChain();
const fileOf = (wallet) => path.join(walletDir(wallet), 'programmes.json');

/**
 * A new programme, or a thrown reason. Pure but for its id.
 * @param {{lead: string, name: unknown, goal: unknown, maxRuns: unknown, cap: number, now: string}} fields - cap: the charter's
 */
export const makeProgramme = ({ lead, name, goal, maxRuns, cap, now }) => {
  const n = clean(name, 60);
  const g = clean(goal, 1000);
  if (n.length < 3) throw new Error('name: what the programme is called, a few words');
  if (g.length < 10) throw new Error('goal: what the programme is for — the one sentence every run serves, and how you will know it is met');
  const runs = Number(maxRuns);
  if (!Number.isInteger(runs) || runs < 2 || runs > Math.min(cap, PROGRAMME_RUNS_MAX)) {
    throw new Error(`maxRuns: from 2 to ${Math.min(cap, PROGRAMME_RUNS_MAX)} runs${cap < PROGRAMME_RUNS_MAX ? ' — the charter allows no more' : ''}`);
  }
  return Object.freeze({ id: `pg-${crypto.randomBytes(4).toString('hex')}`, lead, name: n, goal: g, maxRuns: runs, runs: [], status: 'open', openedAt: now, closed: null });
};

/** The lead's open programme, or null. pure. */
export const openOf = (programmes, lead) => programmes.find((p) => p.lead === lead && p.status === 'open') ?? null;

/** Where a programme stands, for the lead's wake and the Optio's review. pure. */
export const standingOf = (p) => ({ id: p.id, name: p.name, goal: p.goal, n: p.runs.length, of: p.maxRuns, left: Math.max(0, p.maxRuns - p.runs.length) });

/** The house's programmes. impure. */
export const readProgrammes = async (wallet) => {
  const doc = await readJson(fileOf(wallet));
  return doc === ABSENT || !Array.isArray(doc?.programmes) ? [] : doc.programmes;
};

const change = (wallet, fn) => serialize(async () => {
  const programmes = await readProgrammes(wallet);
  const out = fn(programmes);
  if (out.programmes) await writePrivate(fileOf(wallet), { programmes: out.programmes });
  return out.result;
});

/** Open one; a lead holds one open programme at a time. impure. */
export const openProgramme = (wallet, programme) => change(wallet, (programmes) => (openOf(programmes, programme.lead)
  ? { result: { ok: false, reason: `you already lead the open programme "${openOf(programmes, programme.lead).name}" — close it first (programme/close)` } }
  : { programmes: [...programmes, programme], result: { ok: true, programme } }));

/** A run the lead dispatched joins its open programme; null when it has none. impure. */
export const joinRun = (wallet, lead, run) => change(wallet, (programmes) => {
  const p = openOf(programmes, lead);
  if (!p || p.runs.some((r) => r.id === run.id)) return { result: p ? standingOf(p) : null };
  const next = { ...p, runs: [...p.runs, { id: run.id, status: run.status, finishedAt: run.finishedAt, report: run.report ?? null }] };
  return { programmes: programmes.map((x) => (x === p ? next : x)), result: standingOf(next) };
});

/** The lead closes its programme with why. impure. */
export const closeProgramme = (wallet, lead, { why, met, now }) => change(wallet, (programmes) => {
  const p = openOf(programmes, lead);
  if (!p) return { result: { ok: false, reason: 'you lead no open programme' } };
  const reason = clean(why, 600);
  if (reason.length < 10) return { result: { ok: false, reason: 'why: what the runs came to — the goal met, or why it stops here' } };
  const next = { ...p, status: 'closed', closed: { met: met === true, why: reason, at: now } };
  return { programmes: programmes.map((x) => (x === p ? next : x)), result: { ok: true, programme: next } };
});
