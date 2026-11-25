// THE NEVER-LIST — the places this house never does business with, kept by its LEGAL office, read by its sales office.
//
// Design note, 2026-11-22: […]
//
// ONE RECORD, TWO OFFICES. The legal seat works out the list for where its operator is and what law reaches them, with
// the reason and the source for each place, and PROPOSES it; the operator approves it (or sets it themselves, and may
// add a place by their own rule, law or no law). The sales office never keeps a copy: every screen, every lead run
// and every first email reads this record at the moment it acts, so there is nothing to drift. The legal office's
// daily watch then reads the sales office's leads against it (commerce-review.js) and files a matter for a lead that
// stands in a listed place, and for a house whose list nobody has reviewed.
//
// UNTIL A HOUSE HAS ITS OWN, the BASELINE stands: the places under COMPREHENSIVE United States sanctions (OFAC, read
// 2026-11-22: Iran, North Korea, Syria, Cuba, and the occupied regions of Ukraine), marked NOT REVIEWED. It is a floor
// for a house that has said nothing yet, never a finding about what law reaches that house.
// Append-only events in the house's legal office:
//   { type: 'proposed', list, by, at }   { type: 'reviewed', verdict: 'approved'|'returned', note, by: 'operator', at }
//   { type: 'set', list, by: 'operator', at }   the operator's own, standing at once
// The shaping is PURE; the store is impure.

import { officeFile } from '../house-office.js';
import { createWriteChain } from '../write-chain.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { placeName, REGION_NAMES } from '../sales/never-countries.js';

const FILE = 'never-list.jsonl';
export const PLACES_MAX = 80;
const serialize = createWriteChain();
const fileOf = (wallet) => officeFile(wallet, 'legal', FILE);
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);

export const BASELINE = Object.freeze([
  { code: 'IR', why: 'Comprehensive United States sanctions (OFAC)', source: 'https://ofac.treasury.gov/sanctions-programs-and-country-information' },
  { code: 'KP', why: 'Comprehensive United States sanctions (OFAC)', source: 'https://ofac.treasury.gov/sanctions-programs-and-country-information' },
  { code: 'SY', why: 'Comprehensive United States sanctions (OFAC)', source: 'https://ofac.treasury.gov/sanctions-programs-and-country-information' },
  { code: 'CU', why: 'Comprehensive United States sanctions (OFAC)', source: 'https://ofac.treasury.gov/sanctions-programs-and-country-information' },
  { code: 'XO', why: 'Comprehensive United States sanctions on the occupied regions of Ukraine (OFAC)', source: 'https://ofac.treasury.gov/sanctions-programs-and-country-information' },
].map((p) => Object.freeze({ ...p, name: placeName(p.code) })));

/**
 * pure — a never-list, or a thrown reason naming everything wrong with it at once.
 * @param {{home?: string, countries: Array<{code: string, why: string, source?: string}>}} f - home: where the
 *   operator is (ISO code), whose law the list was worked out under · why: the law or the rule behind each place
 */
export const makeNeverList = (f) => {
  const given = Array.isArray(f?.countries) ? f.countries : [];
  const home = clean(f?.home, 12).toUpperCase();
  const seen = new Set();
  const problems = [];
  const countries = [];
  given.slice(0, PLACES_MAX).forEach((c, i) => {
    const code = clean(c?.code, 2).toUpperCase();
    const why = clean(c?.why, 300);
    const source = clean(c?.source, 500);
    if (!/^[A-Z]{2}$/.test(String(c?.code ?? '').trim().toUpperCase()) || (!REGION_NAMES[code] && (placeName(code) === code || /unknown/i.test(placeName(code))))) { problems.push(`countries[${i}].code: a two-letter ISO country code ("IR"), or XO for the occupied regions of Ukraine`); return; }
    if (seen.has(code)) return;
    if (why.length < 8) problems.push(`countries[${i}].why: the law or the rule that puts ${placeName(code)} on the list, in a few words`);
    if (source && !/^https:\/\/\S+$/.test(source)) problems.push(`countries[${i}].source: the https page that states it, or leave it out`);
    seen.add(code);
    countries.push({ code, name: placeName(code), why, ...(source ? { source } : {}) });
  });
  if (given.length > PLACES_MAX) problems.push(`countries: ${given.length} were given and a list holds at most ${PLACES_MAX}`);
  if (home && !/^[A-Z]{2}$/.test(home)) problems.push('home: the two-letter ISO code of the country the operator is in');
  if (problems.length) throw new Error(problems.join('; '));
  return Object.freeze({ home: home || null, countries: Object.freeze(countries) });
};

/** pure — what stands, and what waits for the operator. */
export const foldNeverList = (events) => {
  let approved = null;
  let proposed = null;
  for (const e of events) {
    if (e?.type === 'set' && e.list) { approved = { ...e.list, by: e.by, at: e.at }; proposed = null; }
    else if (e?.type === 'proposed' && e.list) proposed = { ...e.list, by: e.by, at: e.at };
    else if (e?.type === 'reviewed' && proposed) {
      if (e.verdict === 'approved') approved = { ...proposed, approvedAt: e.at };
      else proposed = { ...proposed, returned: e.note || 'returned' };
      if (e.verdict === 'approved') proposed = null;
    }
  }
  return { approved, proposed };
};

/**
 * The house's never-list as every office reads it.
 * @returns {Promise<{codes: string[], countries: object[], home: ?string, reviewed: boolean, at: ?string, by: ?string, proposed: ?object}>}
 *   reviewed false: no list of the house's own stands yet and the baseline is in force
 */
export const readNeverList = async (wallet) => {
  const { approved, proposed } = foldNeverList((await readJsonLines(fileOf(wallet)).catch(() => ({ records: [] }))).records);
  const countries = approved?.countries ?? BASELINE;
  return { codes: countries.map((c) => c.code), countries, home: approved?.home ?? null, reviewed: Boolean(approved), at: approved?.approvedAt ?? approved?.at ?? null, by: approved?.by ?? null, proposed: proposed && !proposed.returned ? proposed : null };
};

/** The legal seat proposes a list; it waits for the operator. */
export const proposeNeverList = (wallet, list, by) => serialize(async () => { await appendJsonLine(fileOf(wallet), { type: 'proposed', list, by, at: new Date().toISOString() }); return { ok: true }; });

/** The operator sets the list (or approves the sales seat's change to it: by is then the seat); it stands at once. */
export const setNeverList = (wallet, list, by = 'operator') => serialize(async () => { await appendJsonLine(fileOf(wallet), { type: 'set', list, by, at: new Date().toISOString() }); return { ok: true }; });

/** The operator approves or returns what the legal seat proposed. */
export const reviewNeverList = (wallet, { verdict, note = '' }) => serialize(async () => {
  const { proposed } = foldNeverList((await readJsonLines(fileOf(wallet)).catch(() => ({ records: [] }))).records);
  if (!proposed || proposed.returned) return { ok: false, reason: 'no never-list waits for you' };
  if (!['approved', 'returned'].includes(verdict)) return { ok: false, reason: 'verdict: approved or returned' };
  await appendJsonLine(fileOf(wallet), { type: 'reviewed', verdict, note: clean(note, 300), by: 'operator', at: new Date().toISOString() });
  return { ok: true };
});

/** pure — the list in words, for a seat. */
export const neverListWords = (list) => `${list.reviewed ? `THE HOUSE'S NEVER-LIST (reviewed ${String(list.at).slice(0, 10)}${list.home ? `, worked out for an operator in ${placeName(list.home)}` : ''})` : 'NO NEVER-LIST OF THIS HOUSE\'S OWN STANDS YET — the baseline is in force (places under comprehensive United States sanctions), and nobody has reviewed it for where your operator is'}: ${list.countries.map((c) => `${c.name} [${c.code}] — ${c.why}`).join('; ')}.${list.proposed ? ` A list proposed by ${list.proposed.by} waits for the operator: ${list.proposed.countries.map((c) => c.code).join(', ')}.` : ''}`;
