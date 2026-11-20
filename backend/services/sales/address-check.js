// THE ADDRESS CHECK — a lead's address is checked before the first email goes to it.
//
// Design note, 2026-11-16: […] An email to an address that does not exist bounces, and bounces are
// what get a new mailbox marked as a spammer. So before the FIRST email to a lead, the address is
// asked of Hunter's verifier with the operator's own stored key (never shown to a being):
//   GET /email-verifier?email=    half a credit; status valid | invalid | accept_all | webmail |
//                                 disposable | unknown; 202 while Hunter is still checking
// It runs only where the operator allows paid lead data (lead-spend.js: ON, within the month's
// limit); where they do not, the email goes as before and the seat is told the address was not
// checked. Each address is checked once and the answer is kept (sales-store.js), so a follow-up
// or a second lead at the same address costs nothing.
//   invalid, disposable   the email is REFUSED: nothing is sent to an address that will bounce
//   valid                 it goes, and the contact book calls the address verified
//   accept_all, webmail, unknown   it goes: the server would not say, which is not a no
// Email Finder rides the same key (sales-hunter-acts.js): a named person at a domain, charged
// only when an address is found. The judging is PURE; the asking is impure, never throws.
//
// Tomba and Apollo serve the same steps (Design note, 2026-11-18: […]): FINDERS holds each attached provider's finder, CHECKERS each
// one that can check an address. Tomba's verifier spends a credit of its own verification balance
// (counted here as 1); Apollo's (2026-11-19: […]) is asked and then waited on (apollo-api.js), a credit an address, and it
// never says […] — only confirmed or not. A check asks the cheapest attached checker
// first — Hunter, then Tomba, then Apollo — and the next when one cannot answer.
// EVERY DATABASE (Design note, 2026-11-19: […]): checkWithEvery asks each attached checker that has not yet
// checked the address; each answer is kept, and the address shows how many confirmed it
// (address-verdict.js). Any that says it will bounce wins.

import process from 'node:process';
import dns from 'node:dns/promises';
import { HUNTER_URL } from './lead-providers.js';
import { tombaFind, tombaVerify } from './tomba-api.js';
import { apolloFind, apolloVerify } from './apollo-api.js';
import { normalizeEmail } from './suppress-shape.js';
import { readAddressChecks, noteAddressCheck } from './sales-store.js';
import { releaseSpend, reserveCheck, attachedProviders } from './lead-spend.js';
import { testEndpoint } from '../test-endpoint-door.js';

export const VERIFY_COST = 0.5;
export const FIND_COST = 1;
const WILL_BOUNCE = new Set(['invalid', 'disposable']);
const urlOf = () => testEndpoint(process.env, 'NEUMA_LEAD_SOURCE_HUNTER', HUNTER_URL);
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** pure — what a check's answer means for a send, in words; `checker` names who checked it. */
export const checkWords = (status, checker = 'Hunter') => ({
  valid: `exists (${checker} checked it)`, invalid: `does not exist (${checker} checked it)`, disposable: `is a throwaway address (${checker} checked it)`,
  accept_all: 'could not be confirmed: its server accepts every address', webmail: `is a personal mailbox, which ${checker} does not confirm`, unknown: 'could not be confirmed: its server did not answer',
}[status] ?? `was answered "${status}"`);

/** pure — whether an email may go to an address with this check on record. */
export const mayWrite = (status) => !WILL_BOUNCE.has(status);

/** pure — Hunter's verifier answer as the house keeps it, or null when it says nothing. */
export const checkOf = (answer) => {
  const d = answer?.data;
  return d?.status ? { status: String(d.status), score: Number(d.score) || 0, mx: Boolean(d.mx_records), smtp: Boolean(d.smtp_check) } : null;
};

/** pure — Hunter's finder answer: the address of one named person, with how sure it is and where it was seen. */
export const foundOf = (answer) => {
  const d = answer?.data;
  if (!d?.email) return null;
  const page = (d.sources ?? []).map((s) => (/^https:\/\//.test(String(s?.uri ?? '')) ? s.uri : null)).find(Boolean) ?? null;
  return { email: String(d.email).toLowerCase(), score: Number(d.score) || 0, role: String(d.position ?? '').trim(), linkedin: d.linkedin_url || null, status: d.verification?.status ?? null, sourceUrl: page };
};

// impure — one Hunter read, JSON with its HTTP status, or a thrown reason in words.
const ask = async (pathAndQuery, apiKey, signal) => {
  const res = await fetch(`${urlOf()}${pathAndQuery}&api_key=${encodeURIComponent(apiKey)}`, { headers: { accept: 'application/json' }, signal });
  if (res.status === 401) throw new Error('Hunter refused the key — check it in SETTINGS, API, Lead data');
  if (res.status === 429) throw new Error('Hunter is out of credits for the month, or busy');
  if (!res.ok && res.status !== 202) throw new Error(`Hunter answered ${res.status}`);
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

/**
 * impure — ask Hunter whether one address exists. Hunter may still be checking (202): it is asked again, briefly.
 * @returns {Promise<{ok: true, check: object} | {ok: false, why: string}>}
 */
export const verifyAddress = async (email, { apiKey, signal, tries = 4, pauseMs = 2500 } = {}) => {
  try {
    for (let i = 0; i < tries; i += 1) {
      const got = await ask(`/email-verifier?email=${encodeURIComponent(email)}`, apiKey, signal);
      if (got.status === 200) { const check = checkOf(got.json); return check ? { ok: true, check, spent: VERIFY_COST } : { ok: false, why: 'Hunter gave no answer for this address' }; }
      await wait(pauseMs);
    }
    return { ok: false, why: 'Hunter was still checking after several tries' };
  } catch (err) {
    return { ok: false, why: err.message };
  }
};

/** impure — the address of one named person at a domain. Charged by Hunter only when one is found. Never throws. */
export const findAddress = async ({ domain, name, apiKey, signal }) => {
  try {
    const got = await ask(`/email-finder?domain=${encodeURIComponent(domain)}&full_name=${encodeURIComponent(name)}`, apiKey, signal);
    const found = foundOf(got.json);
    return { ok: true, found, spent: found ? FIND_COST : 0 };
  } catch (err) {
    return { ok: false, why: err.message };
  }
};

/**
 * Each provider's finder of one named person's address, cheapest first; each says what it spent. `a` is the attached
 * provider (lead-spend.js attachedProviders: its key, and its secret where it takes one).
 */
export const FINDERS = Object.freeze({
  hunter: Object.freeze({ name: 'Hunter', cost: FIND_COST, find: (a, q) => findAddress({ ...q, apiKey: a.apiKey }) }),
  tomba: Object.freeze({ name: 'Tomba', cost: 1, find: (a, q) => tombaFind({ ...q, apiKey: a.apiKey, secret: a.secret }) }),
  apollo: Object.freeze({ name: 'Apollo', cost: 1, find: (a, q) => apolloFind({ ...q, apiKey: a.apiKey }) }),
});

/** Each provider that can check an address before an email goes, cheapest first. */
export const CHECKERS = Object.freeze({
  hunter: Object.freeze({ name: 'Hunter', cost: VERIFY_COST, verify: (a, email, signal) => verifyAddress(email, { apiKey: a.apiKey, signal }) }),
  tomba: Object.freeze({ name: 'Tomba', cost: 1, verify: (a, email, signal) => tombaVerify(email, { apiKey: a.apiKey, secret: a.secret, signal }) }),
  apollo: Object.freeze({ name: 'Apollo', cost: 1, verify: (a, email, signal) => apolloVerify(email, { apiKey: a.apiKey, signal }) }),
});

/** impure — the attached checkers, cheapest first, each with its provider's key. */
export const attachedCheckers = async () => {
  const attached = await attachedProviders();
  return Object.keys(CHECKERS).map((id) => attached.find((a) => a.id === id)).filter(Boolean).map((a) => ({ ...CHECKERS[a.id], provider: a }));
};

// impure — one checker asked about one address, within the month's limit, and its answer kept. Never throws.
const askChecker = async (wallet, how, email, { signal, by }) => {
  const reserved = await reserveCheck(wallet, how.cost);
  if (!reserved.ok) return { ok: false, limit: true, why: reserved.reason };
  try {
    const asked = await how.verify(how.provider, email, signal);
    if (!asked.ok) return { ok: false, why: `${how.name}: ${asked.why}` };
    const kept = { ...asked.check, checker: how.name };
    await noteAddressCheck(wallet, { email, check: kept, spent: asked.spent ?? how.cost, by });
    return { ok: true, check: { email, ...kept } };
  } finally {
    await releaseSpend(wallet, reserved.reservation.id);
  }
};

// EVERY ADDRESS IS CHECKED BEFORE AN EMAIL LEAVES (Design note, 2026-11-19, a Google Group that bounced: […]). Every recipient, first
// email or not — once, the answer kept, so a follow-up costs nothing — and whatever PAID LEAD DATA says: the check
// is part of sending, not of finding leads. It still counts against the month's limit; past it, the email waits.
// With a checker attached (Hunter, else Tomba) the mailbox itself is asked; with none, the address's domain is asked
// whether it takes mail at all (DNS, free). An address that cannot be checked waits — it is never sent unchecked.
const domainTakesMail = async (email) => {
  const domain = String(email).split('@')[1] ?? '';
  try {
    const mx = await dns.resolveMx(domain);
    return mx.some((r) => r?.exchange) ? { ok: true } : { ok: false, why: `${domain} takes no mail (it names no mail server)` };
  } catch (err) {
    if (['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN'].includes(err.code)) return { ok: false, why: `${domain} takes no mail (${err.code === 'ENOTFOUND' ? 'the domain does not exist' : 'it names no mail server'})` };
    return { ok: null, why: `the domain could not be asked (${err.code || err.message})` };
  }
};

/**
 * impure — the check before an email leaves. For each address: the LIVE answer on record, else a live check (the
 * mailbox with a checker attached, the domain without one) — an address that stands only on a provider's stored
 * "verified" is checked live first (address-verdict.js: a live answer outranks it). Never throws.
 * @param {string[]} [skip] addresses known to be real (they wrote to the house): not asked
 * @param {boolean} [requireConfirmed] a FIRST email to a lead: only a confirmed address may be written to — one that
 *   is not (could not be confirmed, a server that takes any address, the domain alone) is refused, and the operator
 *   alone may send it anyway (email-outbox.js sendDraft acceptRisk)
 * @returns {Promise<{refusal: ?string, notes: string[]}>} refusal: why nothing may be sent (an address that will
 *   bounce, one that could not be checked, or an unconfirmed one where a confirmed one is required) · notes: what the
 *   seat should know
 */
export const checkBeforeSending = async (wallet, emails, { by = 'send', signal, skip = [], requireConfirmed = false } = {}) => {
  const notes = [];
  const unconfirmed = (email, said) => `the address ${email} is not confirmed (${said}) — a first email goes only to an address a database confirmed LIVE. FIND CONFIRMED ADDRESSES (sales/confirm-address): every database, then another address for them; or your operator sends it anyway, knowing it may bounce`;
  try {
    const known = new Map((await readAddressChecks(wallet)).map((c) => [c.email, c]));
    const real = new Set(skip.map(normalizeEmail));
    const wanted = [...new Set(emails.map(normalizeEmail).filter(Boolean))].filter((e) => !real.has(e));
    const checkers = await attachedCheckers();
    for (const email of wanted) {
      let check = known.get(email) ?? null;
      if (!check && !checkers.length) {
        const domain = await domainTakesMail(email);
        if (domain.ok === false) return { refusal: `the address ${email} cannot receive mail: ${domain.why} — nothing was sent. Find another address for this person (their company's own pages, sales/find-address), or close the lead`, notes };
        if (domain.ok === null) return { refusal: `the address ${email} could not be checked before sending: ${domain.why} — the email waits; send it again in a moment`, notes };
        if (requireConfirmed) return { refusal: unconfirmed(email, 'its domain takes mail; no database is attached to check the mailbox itself'), notes };
        notes.push(`${email}: its domain takes mail; the mailbox itself was not checked (a Hunter, Tomba or Apollo key under SETTINGS, API, Lead data checks every mailbox)`);
        continue;
      }
      // Asked LIVE, the cheapest attached checker first and the next when one cannot answer (Founder: […]) — for an address never checked, and for one that stands only on a provider's
      // stored flag (2026-11-19: a stored […] hard-bounced).
      const storedOnly = Boolean(check && !check.live);
      const tried = [];
      for (const how of !check || storedOnly ? checkers : []) {
        const asked = await askChecker(wallet, how, email, { signal, by });
        if (asked.ok) { check = (await readAddressChecks(wallet)).find((c) => c.email === email) ?? asked.check; break; }
        if (asked.limit) { if (storedOnly) { tried.push(asked.why); break; } return { refusal: `the address ${email} could not be checked before sending: ${asked.why} — your operator raises it in POSITIONS, CHIEF REVENUE OFFICER, SETTINGS, and the email waits until then`, notes }; }
        tried.push(asked.why);
      }
      if (!check) return { refusal: `the address ${email} could not be checked before sending (${tried.join('; ')}) — the email waits; send it again when a check can run`, notes };
      if (!mayWrite(check.status)) return { refusal: `the address ${email} ${checkWords(check.status, check.checker)} — nothing was sent. Find another address for this person (their company's own pages, sales/contacts, sales/find-address), or close the lead`, notes };
      if (requireConfirmed && check.status !== 'valid') return { refusal: unconfirmed(email, checkWords(check.status, check.checker)), notes };
      notes.push(check.live === false
        ? `${email}: ${check.foundBy?.join(', ') || check.checker} gave it as verified from its own records; no live check could answer (${tried.join('; ') || 'none asked'})`
        : `${email} ${checkWords(check.status, check.checker)}`);
    }
    return { refusal: null, notes };
  } catch (err) {
    return { refusal: `the address check could not run (${err.message}) — the email waits; send it again in a moment`, notes };
  }
};
/**
 * impure — LOCK IT IN: each address asked of every attached checker that has not yet checked it, each answer kept.
 * Never throws.
 * @returns {Promise<{asked: number, addresses: Array<{email: string, status: ?string, confirmedBy: string[], checkedBy: string[]}>, problems: string[]}>}
 */
export const checkWithEvery = async (wallet, emails, { by = 'operator', signal } = {}) => {
  const problems = [];
  let asked = 0;
  try {
    const checkers = await attachedCheckers();
    if (!checkers.length) return { asked, addresses: [], problems: ['no checker is attached: a Hunter, Tomba or Apollo key under SETTINGS, API, Lead data'] };
    const before = new Map((await readAddressChecks(wallet)).map((c) => [c.email, c]));
    for (const email of [...new Set(emails.map(normalizeEmail).filter(Boolean))]) {
      for (const how of checkers.filter((h) => !(before.get(email)?.checkedBy ?? []).includes(h.name))) {
        const answer = await askChecker(wallet, how, email, { signal, by });
        if (answer.ok) asked += 1;
        else problems.push(`${email}: ${answer.why}`);
        if (answer.limit) break;
      }
    }
    const after = new Map((await readAddressChecks(wallet)).map((c) => [c.email, c]));
    const addresses = [...new Set(emails.map(normalizeEmail).filter(Boolean))].map((email) => {
      const c = after.get(email);
      return { email, status: c?.status ?? null, confirmedBy: c?.confirmedBy ?? [], checkedBy: c?.checkedBy ?? [] };
    });
    return { asked, addresses, problems };
  } catch (err) {
    return { asked, addresses: [], problems: [...problems, `the checks could not run (${err.message})`] };
  }
};

/**
 * impure — CONFIRM WITH ANY: an address that came back not confirmed is asked of each attached checker that has not
 * checked it yet, cheapest first, until one confirms it or says it will bounce. Never throws.
 * @returns {Promise<{check: ?object, asked: string[], problems: string[]}>} check: what its checks add up to now
 */
export const confirmWithAny = async (wallet, email, { by = 'operator', signal } = {}) => {
  const asked = [];
  const problems = [];
  const now = async () => (await readAddressChecks(wallet)).find((c) => c.email === email) ?? null;
  try {
    const before = await now();
    for (const how of (await attachedCheckers()).filter((h) => !(before?.checkedBy ?? []).includes(h.name))) {
      const answer = await askChecker(wallet, how, email, { signal, by });
      if (!answer.ok) { problems.push(answer.why); if (answer.limit) break; continue; }
      asked.push(how.name);
      if (answer.check.status === 'valid' || !mayWrite(answer.check.status)) break;
    }
    return { check: await now(), asked, problems };
  } catch (err) {
    return { check: null, asked, problems: [...problems, `the checks could not run (${err.message})`] };
  }
};

/** The older name, kept for its callers. */
export const checkBeforeFirstEmail = checkBeforeSending;
