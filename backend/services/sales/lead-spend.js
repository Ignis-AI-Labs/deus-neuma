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
//   { type: 'reserve', id, spent, at } / { type: 'release', id, at }
// Actual spend is counted from lookups (sales-store.js), with unreleased
// maximum-cost reservations included while their provider calls run.
// The fold, the count and the judgement are PURE; the reads are impure.

import { randomUUID } from 'node:crypto';
import { officeFile } from '../house-office.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { resolveUsableCredential } from '../oauth-token-broker.js';
import { readContactLookups } from './sales-store.js';
import { hunterAccount, accountWords } from './hunter-discover.js';
import { PEOPLE_PROVIDERS } from './lead-providers.js';
import { rootdataAccount } from './rootdata-api.js';
import { rootdataKey } from './rootdata-key.js';
import { tombaAccount } from './tomba-api.js';
import { apolloAccount } from './apollo-api.js';

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

const left = (a) => Math.max(0, a.available - a.used);

/** pure — what each attached account itself says it has left, in the operator's words; null when none can be read. */
export const accountsWords = (accounts = {}) => [
  accountWords(accounts.hunter ?? null),
  accounts.tomba ? `TOMBA · ${String(accounts.tomba.plan).toUpperCase()} PLAN · ${left(accounts.tomba)} OF ${accounts.tomba.available} SEARCH CREDITS LEFT${accounts.tomba.checks ? ` · ${left(accounts.tomba.checks)} OF ${accounts.tomba.checks.available} ADDRESS CHECKS LEFT` : ''}` : null,
  accounts.apollo ? `APOLLO · ${left(accounts.apollo)} OF ${accounts.apollo.available} CREDITS LEFT THIS CYCLE` : null,
  accounts.rootdata ? `ROOTDATA · ${String(accounts.rootdata.plan).toUpperCase()} PLAN · ${left(accounts.rootdata)} OF ${accounts.rootdata.available} CREDITS LEFT` : null,
].filter(Boolean).join(' — ') || null;

/** pure — the setting as the seat reads it. */
export const spendLine = ({ rule, spent, attached, accounts = {} }) => {
  if (!attached.length) return 'PAID LEAD DATA: no provider is attached. Read each address on the company\'s own pages. (A free Hunter account would give you a company search that spends nothing and 50 people lookups a month: tell your operator.)';
  const own = ['tomba', 'apollo'].filter((id) => accounts[id]).map((id) => ` ${PEOPLE_PROVIDERS[id].name}'s own count: ${left(accounts[id])} of ${accounts[id].available} credits left.`).join('');
  return `${spendLineBody({ rule, spent, attached })}${attached.includes('hunter') ? ` Hunter's company search (sales/gather, source hunter-discover) spends no credits and is always allowed, whatever this setting says.${accounts.hunter ? ` Hunter's own count: ${Math.max(0, accounts.hunter.available - accounts.hunter.used)} of ${accounts.hunter.available} credits left this month (${accounts.hunter.plan} plan).` : ''}` : ''}${own}`;
};
const spendLineBody = ({ rule, spent, attached }) => {
  return `PAID LEAD DATA (${attached.join(', ')} attached; it spends your operator's credits): ${rule.on ? `ON. It is one of the ways you may find a person's address. Use what is free first (the company's own pages); pay for a lookup when those give none` : 'OFF. Do not ask for it; read each address on the company\'s own pages'}. Spent this month: ${spent} of ${rule.cap} credit(s). Every address an email goes to is checked before it leaves, ON or OFF, within the limit (address-check.js) — you never ask for that, it runs at staging and at send.`;
};

/**
 * pure — the setting as a row of the position's SETTINGS tab, beside its connection switches.
 * @param {{rule: object, spent: number, attached: string[]}} state
 */
export const spendSwitch = ({ rule, spent, attached, accounts = {} }) => ({
  id: 'paid-lead-data', kind: 'spend', on: rule.on, cap: rule.cap, spent, attached,
  // what each attached account itself says it has left, where it can be read
  note: accountsWords(accounts),
  name: `Paid lead data${attached.length ? ` (${attached.map((a) => a[0].toUpperCase() + a.slice(1)).join(', ')})` : ''}`,
  whileOff: attached.length ? 'your sales seat reads each address on the company\'s own pages and spends no credits finding people; every address an email goes to is still checked before it leaves, within this limit' : 'no provider key is attached yet. A free Hunter account (hunter.io) gives your sales seat a company search that spends nothing and 50 credits a month to look people up; add its key in Settings, API, Lead data',
});

/** impure — the rule of one house. */
export const readSpend = async (wallet) => foldSpend((await readJsonLines(officeFile(wallet, 'revenue', FILE))).records);

/** impure — reservations not yet released, counted against the cap while their provider call runs. */
export const readSpendReservations = async (wallet) => {
  const events = (await readJsonLines(officeFile(wallet, 'revenue', FILE))).records;
  const released = new Set(events.filter((e) => e?.type === 'release').map((e) => e.id));
  return events.filter((e) => e?.type === 'reserve' && e.id && !released.has(e.id));
};

/** impure — the cap check and its reservation land under one write chain, before any provider call. */
export const reserveSpend = (wallet, cost) => serialize(async () => {
  const [rule, lookups, reservations] = await Promise.all([readSpend(wallet), readContactLookups(wallet), readSpendReservations(wallet)]);
  const refusal = spendRefusal({ rule, spent: spentThisMonth([...lookups, ...reservations], Date.now()), cost });
  if (refusal) return { ok: false, reason: refusal };
  const reservation = { id: randomUUID(), spent: cost, at: new Date().toISOString() };
  await appendJsonLine(officeFile(wallet, 'revenue', FILE), { type: 'reserve', ...reservation });
  return { ok: true, reservation };
});

/** impure — the hold for an address check before an email leaves: within the month's limit, whatever the switch
 * says (Design note, 2026-11-19: […]) — address-check.js checkBeforeSending. */
export const reserveCheck = (wallet, cost) => serialize(async () => {
  const [rule, lookups, reservations] = await Promise.all([readSpend(wallet), readContactLookups(wallet), readSpendReservations(wallet)]);
  const spent = spentThisMonth([...lookups, ...reservations], Date.now());
  if (spent + cost > rule.cap) return { ok: false, reason: `this month's limit for paid lead data is reached (${spent} of ${rule.cap} credits)` };
  const reservation = { id: randomUUID(), spent: cost, at: new Date().toISOString() };
  await appendJsonLine(officeFile(wallet, 'revenue', FILE), { type: 'reserve', ...reservation });
  return { ok: true, reservation };
});

/** impure — actual charges now stand in the lookup ledger; the maximum-cost hold can leave. */
export const releaseSpend = (wallet, id) => serialize(() =>
  appendJsonLine(officeFile(wallet, 'revenue', FILE), { type: 'release', id, at: new Date().toISOString() }));

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

/** impure — the providers whose key the operator attached, cheapest first, each with its key (never shown to a being).
 * A provider that also takes a secret (Tomba) stands attached only with both — or with the older `key:secret` row. */
export const attachedProviders = async () => {
  const found = await Promise.all(Object.entries(PEOPLE_PROVIDERS).map(async ([id, source]) => {
    const credential = await resolveUsableCredential(source.key).catch(() => null);
    if (!credential?.apiKey) return null;
    if (!source.secret) return { id, source, apiKey: credential.apiKey };
    const secret = (await resolveUsableCredential(source.secret).catch(() => null))?.apiKey ?? null;
    return secret || credential.apiKey.includes(':') ? { id, source, apiKey: credential.apiKey, secret } : null;
  }));
  return found.filter(Boolean);
};

// Each attached account's own count, asked at most every ten minutes: the engine is read on every change, and
// Tomba's free plan answers /me 30 times a minute at most. Hunter keeps its own (hunter-discover.js).
const ACCOUNT_FRESH_MS = 10 * 60 * 1000;
const counted = new Map();
const ASK_ACCOUNT = Object.freeze({
  hunter: (a) => hunterAccount(a.apiKey),
  tomba: (a) => tombaAccount({ apiKey: a.apiKey, secret: a.secret }),
  apollo: (a) => apolloAccount({ apiKey: a.apiKey }),
});
const accountOf = async (a, now = Date.now()) => {
  const held = counted.get(a.id);
  if (a.id !== 'hunter' && held && held.key === a.apiKey && now - held.at < ACCOUNT_FRESH_MS) return held.value;
  const value = await ASK_ACCOUNT[a.id]?.(a).catch(() => null) ?? null;
  counted.set(a.id, { key: a.apiKey, at: now, value });
  return value;
};
/** impure — { hunter?, tomba?, apollo? }: each attached account's plan and credits, where it can be read. */
// RootData is no people provider (it holds no address), so it is not among `attached`: its count is read beside them.
const rootdataCount = async (now = Date.now()) => {
  const apiKey = await rootdataKey();
  if (!apiKey) return null;
  const held = counted.get('rootdata');
  if (held && held.key === apiKey && now - held.at < ACCOUNT_FRESH_MS) return held.value;
  const value = await rootdataAccount({ apiKey });
  counted.set('rootdata', { key: apiKey, at: now, value });
  return value;
};
const accountsOf = async (attached) => Object.fromEntries([...(await Promise.all(attached.map(async (a) => [a.id, await accountOf(a)]))), ['rootdata', await rootdataCount().catch(() => null)]].filter(([, v]) => v));

/** impure — where the house stands: the rule, what the month has spent, which providers are attached (ids only). */
export const spendState = async (wallet) => {
  const [rule, lookups, reservations, attached] = await Promise.all([readSpend(wallet), readContactLookups(wallet), readSpendReservations(wallet), attachedProviders()]);
  return { rule, spent: spentThisMonth([...lookups, ...reservations], Date.now()), attached: attached.map((a) => a.id), accounts: await accountsOf(attached), lookups: lookups.slice(-10).reverse() };
};
