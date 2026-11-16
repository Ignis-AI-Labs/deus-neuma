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
import { PEOPLE_PROVIDERS } from './lead-providers.js';

const serialize = createWriteChain();
const FILE = 'lead-spend.jsonl';
export const SPEND_MODES = Object.freeze(['ask', 'free-first', 'paid-first']);
export const DEFAULT_CAP = 100;
export const CAP_MAX = 100000;

/** pure — the rule that stands: the last one set; `ask` with the default cap until the operator chooses. */
export const foldSpend = (events) => {
  const last = events.filter((e) => e?.type === 'rule' && SPEND_MODES.includes(e.mode)).at(-1);
  return last ? { mode: last.mode, cap: last.cap, chosen: true, at: last.at } : { mode: 'ask', cap: DEFAULT_CAP, chosen: false, at: null };
};

/** pure — a rule from what the operator sent; throws in words. */
export const makeRule = ({ mode, cap }) => {
  if (!SPEND_MODES.includes(mode)) throw new Error(`mode is one of: ${SPEND_MODES.join(', ')}`);
  const n = Number(cap);
  if (!Number.isInteger(n) || n < 0 || n > CAP_MAX) throw new Error(`cap: a whole number of credits a month, 0 to ${CAP_MAX}`);
  return { mode, cap: n };
};

/** pure — the credits spent in the calendar month of `now` (UTC), from the lookups on record. */
export const spentThisMonth = (lookups, now) => {
  const month = new Date(now).toISOString().slice(0, 7);
  return lookups.filter((l) => String(l.at ?? '').startsWith(month)).reduce((n, l) => n + (Number.isFinite(l.spent) ? l.spent : 1), 0);
};

/**
 * pure — may this lookup run? null when it may; else the reason, in words the
 * seat passes to its operator.
 * @param {{rule: object, spent: number, cost: number, scored: boolean, providers: string[]}} at
 *   cost: the most this lookup may spend · scored: the seat has scored this company from its own pages
 */
export const spendRefusal = ({ rule, spent, cost, scored, providers }) => {
  if (rule.mode === 'ask') return `paid lead data is not allowed yet. Ask your operator now, in plain words: "${providers.join(' and ')} can give me the people at each company, and each lookup spends your credits there. Do you want me to use it from the start, or only for a company whose own pages gave me no address?" They choose in POSITIONS, CHIEF REVENUE OFFICER, LEADS, under PAID LEAD DATA. Until then read each address on the company's own pages`;
  if (rule.mode === 'free-first' && !scored) return 'your operator chose FREE FIRST: read this company\'s own pages (team, about, contact) and score it with sales/prospect first; a paid lookup is for a company you have scored whose own pages gave no address';
  if (spent + cost > rule.cap) return `this month's cap is ${rule.cap} credit(s) and ${spent} are spent; this lookup may spend ${cost}. Tell your operator; they raise the cap in POSITIONS, CHIEF REVENUE OFFICER, LEADS, under PAID LEAD DATA. Until then read each address on the company's own pages`;
  return null;
};

/** pure — the rule as the seat reads it. */
export const spendLine = ({ rule, spent, attached }) => {
  if (!attached.length) return 'PAID LEAD DATA: no provider is attached. Read each address on the company\'s own pages.';
  const how = { ask: 'NOT ALLOWED YET. Ask your operator whether you may use it, and whether from the start or only after the free ways', 'free-first': 'FREE FIRST. Read and score each company from its own pages; use sales/contacts only for a scored company whose pages gave no address', 'paid-first': 'ALLOWED FROM THE START for any company you gathered' }[rule.mode];
  return `PAID LEAD DATA (${attached.join(', ')} attached; it spends your operator's credits): ${how}. Spent this month: ${spent} of ${rule.cap} credit(s).`;
};

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
  return { rule, spent: spentThisMonth(lookups, Date.now()), attached: attached.map((a) => a.id), lookups: lookups.slice(-10).reverse() };
};
