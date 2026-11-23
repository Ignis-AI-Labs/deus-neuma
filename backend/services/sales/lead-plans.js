// LEAD DATA PLANS — what the operator pays each lead-data partner, so the house can say what its leads COST (Founder,
// 2026-11-20: […]).
//
// A plan is the operator's own word about their own subscription: the partner, the price a month, the credits it
// includes (when it has any), and the day it began. Nothing is read from a card or a bank: what was actually charged
// is the books' to say (accounts/), and the cost sheet shows the two side by side.
//
// Append-only events in the revenue office:  { type: 'plan', plan, at }   { type: 'ended', partner, at }
// The shape and the fold are PURE; the reads and writes are impure.
import { officeFile } from '../house-office.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';

const serialize = createWriteChain();
const FILE = 'lead-plans.jsonl';
export const PLAN_MAX = 100000;
const CURRENCY = /^[A-Z]{3}$/;
const key = (partner) => String(partner ?? '').trim().toLowerCase();

/**
 * pure — a plan from what the operator sent; throws in words.
 * @param {{partner: unknown, monthly: unknown, currency?: unknown, credits?: unknown, since?: unknown}} input
 * @param {string} now ISO
 */
export const makePlan = ({ partner, monthly, currency = 'USD', credits = null, since = null }, now) => {
  const name = String(partner ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (name.length < 2) throw new Error('partner: who the plan is with (Apollo, Hunter, Tomba …)');
  const price = Number(monthly);
  if (!Number.isFinite(price) || price < 0 || price > PLAN_MAX) throw new Error(`monthly: what the plan costs a month, 0 to ${PLAN_MAX}`);
  const code = String(currency ?? 'USD').trim().toUpperCase();
  if (!CURRENCY.test(code)) throw new Error('currency: three letters (USD, EUR, GBP …)');
  const included = credits === null || credits === undefined || credits === '' ? null : Number(credits);
  if (included !== null && (!Number.isInteger(included) || included < 0 || included > 100_000_000)) throw new Error('credits: the whole number of credits a month the plan includes, or leave it out');
  const began = since ? String(since).slice(0, 10) : now.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(began) || Number.isNaN(Date.parse(began))) throw new Error('since: the day the plan began, as YYYY-MM-DD');
  if (Date.parse(began) > Date.parse(now) + 86_400_000) throw new Error('since: the plan cannot begin in the future');
  return Object.freeze({ partner: name, monthly: Math.round(price * 100) / 100, currency: code, credits: included, since: began });
};

/** pure — the plans that stand: the last one filed per partner, without the ones ended since. */
export const foldPlans = (events) => {
  const by = new Map();
  for (const e of events) {
    if (e?.type === 'plan' && e.plan?.partner) by.set(key(e.plan.partner), e.plan);
    if (e?.type === 'ended') by.delete(key(e.partner));
  }
  return [...by.values()].sort((a, b) => a.partner.localeCompare(b.partner));
};

/**
 * pure — how many times a plan has been charged up to `now`: once on the day it began, then once on each monthly
 * return of that day (a plan begun on the 31st is charged on a shorter month's last day).
 */
export const chargesSoFar = (plan, now) => {
  const start = new Date(`${plan.since}T00:00:00Z`);
  const at = new Date(now);
  if (Number.isNaN(start.getTime()) || at < start) return 0;
  let months = (at.getUTCFullYear() - start.getUTCFullYear()) * 12 + at.getUTCMonth() - start.getUTCMonth();
  const lastDay = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
  if (at.getUTCDate() < Math.min(start.getUTCDate(), lastDay)) months -= 1;
  return months + 1;
};

/** impure — the plans of one house. */
export const readPlans = async (wallet) => foldPlans((await readJsonLines(officeFile(wallet, 'revenue', FILE))).records);

/** impure — file (or replace) a plan. One currency across a house's plans, so their sum means something. */
export const setPlan = (wallet, input, now = new Date().toISOString()) => serialize(async () => {
  const plan = makePlan(input, now);
  const other = (await readPlans(wallet)).find((p) => key(p.partner) !== key(plan.partner) && p.currency !== plan.currency);
  if (other) throw new Error(`currency: your ${other.partner} plan is in ${other.currency} — keep every plan in one currency so the totals add up`);
  await appendJsonLine(officeFile(wallet, 'revenue', FILE), { type: 'plan', plan, at: now });
  return plan;
});

/** impure — a plan ended: it stops counting from now (what it cost stays in the books). False when none stood. */
export const endPlan = (wallet, partner, now = new Date().toISOString()) => serialize(async () => {
  if (!(await readPlans(wallet)).some((p) => key(p.partner) === key(partner))) return false;
  await appendJsonLine(officeFile(wallet, 'revenue', FILE), { type: 'ended', partner: String(partner).trim(), at: now });
  return true;
});
