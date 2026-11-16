// PAID LEAD DATA — WHEN IT MAY BE SPENT (Design note, 2026-11-15: […]). A lookup at an attached
// provider spends the operator's own credits, so the operator chooses ONCE:
//   ask         nothing paid runs; the seat asks the operator first (the
//               state of every house until its operator chooses)
//   free-first  the free ways first: a paid lookup runs only for a company
//               the seat has already read and scored from its own pages
//   paid-first  a paid lookup runs for any company gathered, from the start
// and a cap: the most credits the seat may spend in one calendar month.
//
// The record is append-only events in the revenue office:
//   { type: 'rule', mode, cap, at }
// What was spent is counted from the lookups themselves (sales-store.js).
// The fold, the count and the judgement are PURE; the reads are impure.

import { officeFile } from '../house-office.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { resolveUsableCredential } from '../oauth-token-broker.js';
import { readContactLookups } from './sales-store.js';
import { hunterAccount, accountWords } from './hunter-discover.js';
import { PEOPLE_PROVIDERS } from './lead-providers.js';

const serialize = createWriteChain();
const FILE = 'lead-spend.jsonl';
// ON or OFF, and a limit (Design note, 2026-11-16: […]). A rule written before this (ask, free-first, paid-first) reads as off, on, on.
export const SPEND_MODES = Object.freeze(['off', 'on']);
const LEGACY = Object.freeze({ ask: 'off', 'free-first': 'on', 'paid-first': 'on' });
const modeOf = (mode) => (SPEND_MODES.includes(mode) ? mode : LEGACY[mode] ?? null);
export const DEFAULT_CAP = 100;
export const CAP_MAX = 100000;

/** pure — the rule that stands: the last one set; OFF with the default limit until the operator turns it on. */
export const foldSpend = (events) => {
  const last = events.filter((e) => e?.type === 'rule' && modeOf(e.mode)).at(-1);
  return last ? { mode: modeOf(last.mode), on: modeOf(last.mode) === 'on', cap: last.cap, chosen: true, at: last.at } : { mode: 'off', on: false, cap: DEFAULT_CAP, chosen: false, at: null };
};

/** pure — a rule from what the operator sent; throws in words. */
export const makeRule = ({ mode, cap }) => {
  if (!modeOf(mode)) throw new Error(`mode is one of: ${SPEND_MODES.join(', ')}`);
  const n = Number(cap);
  if (!Number.isInteger(n) || n < 0 || n > CAP_MAX) throw new Error(`cap: a whole number of credits a month, 0 to ${CAP_MAX}`);
  return { mode: modeOf(mode), cap: n };
};

/** pure — the credits spent in the calendar month of `now` (UTC), from the lookups on record. */
export const spentThisMonth = (lookups, now) => {
  const month = new Date(now).toISOString().slice(0, 7);
  return lookups.filter((l) => String(l.at ?? '').startsWith(month)).reduce((n, l) => n + (Number.isFinite(l.spent) ? l.spent : 1), 0);
};

const WHERE = 'POSITIONS, CHIEF REVENUE OFFICER, SETTINGS';

/**
 * pure — may this lookup run? null when it may; else the reason, in words the seat passes to its operator.
 * @param {{rule: object, spent: number, cost: number}} at - cost: the most this lookup may spend
 */
export const spendRefusal = ({ rule, spent, cost }) => {
  if (!rule.on) return `PAID LEAD DATA is off. Your operator turns it on in ${WHERE}. Until then read each address on the company's own pages`;
  if (spent + cost > rule.cap) return `this month's limit is ${rule.cap} credit(s) and ${spent} are spent; this lookup may spend ${cost}. Tell your operator; they raise the limit in ${WHERE}. Until then read each address on the company's own pages`;
  return null;
};

/** pure — the setting as the seat reads it. */
export const spendLine = ({ rule, spent, attached, accounts = {} }) => {
  if (!attached.length) return 'PAID LEAD DATA: no provider is attached. Read each address on the company\'s own pages. (A free Hunter account would give you a company search that spends nothing and 50 people lookups a month: tell your operator.)';
  return `${spendLineBody({ rule, spent, attached })}${attached.includes('hunter') ? ` Hunter's company search (sales/gather, source hunter-discover) spends no credits and is always allowed, whatever this setting says.${accounts.hunter ? ` Hunter's own count: ${Math.max(0, accounts.hunter.available - accounts.hunter.used)} of ${accounts.hunter.available} credits left this month (${accounts.hunter.plan} plan).` : ''}` : ''}`;
};
const spendLineBody = ({ rule, spent, attached }) => {
  return `PAID LEAD DATA (${attached.join(', ')} attached; it spends your operator's credits): ${rule.on ? `ON. It is one of the ways you may find a person's address. Use what is free first (the company's own pages); pay for a lookup when those give none` : 'OFF. Do not ask for it; read each address on the company\'s own pages'}. Spent this month: ${spent} of ${rule.cap} credit(s).`;
};

/**
 * pure — the setting as a row of the position's SETTINGS tab, beside its connection switches.
 * @param {{rule: object, spent: number, attached: string[]}} state
 */
export const spendSwitch = ({ rule, spent, attached, accounts = {} }) => ({
  id: 'paid-lead-data', kind: 'spend', on: rule.on, cap: rule.cap, spent, attached,
  // what the attached account itself says it has left, where it can be read (Hunter today)
  note: accountWords(accounts.hunter ?? null),
  name: `Paid lead data${attached.length ? ` (${attached.map((a) => a[0].toUpperCase() + a.slice(1)).join(', ')})` : ''}`,
  whileOff: attached.length ? 'your sales seat reads each address on the company\'s own pages and spends none of your credits' : 'no provider key is attached yet. A free Hunter account (hunter.io) gives your sales seat a company search that spends nothing and 50 credits a month to look people up; add its key in Settings, API, Lead data',
});

/** impure — the rule of one house. */
export const readSpend = async (wallet) => foldSpend((await readJsonLines(officeFile(wallet, 'revenue', FILE))).records);

/** The operator sets the rule. @returns {Promise<{ok: true, rule: object} | {ok: false, reason: string}>} */
export const setSpend = (wallet, input) => serialize(async () => {
  try {
    const rule = makeRule(input);
    await appendJsonLine(officeFile(wallet, 'revenue', FILE), { type: 'rule', ...rule, at: new Date().toISOString() });
    return { ok: true, rule: await readSpend(wallet) };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});

/** impure — the providers whose key the operator attached, cheapest first, each with its key (never shown to a being). */
export const attachedProviders = async () => {
  const found = await Promise.all(Object.entries(PEOPLE_PROVIDERS).map(async ([id, source]) => {
    const credential = await resolveUsableCredential(source.key).catch(() => null);
    return credential?.apiKey ? { id, source, apiKey: credential.apiKey } : null;
  }));
  return found.filter(Boolean);
};

/** impure — where the house stands: the rule, what the month has spent, which providers are attached (ids only). */
export const spendState = async (wallet) => {
  const [rule, lookups, attached] = await Promise.all([readSpend(wallet), readContactLookups(wallet), attachedProviders()]);
  const hunter = attached.find((a) => a.id === 'hunter');
  return { rule, spent: spentThisMonth(lookups, Date.now()), attached: attached.map((a) => a.id), accounts: hunter ? { hunter: await hunterAccount(hunter.apiKey) } : {}, lookups: lookups.slice(-10).reverse() };
};
