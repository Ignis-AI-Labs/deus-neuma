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

import process from 'node:process';
import { HUNTER_URL } from './lead-providers.js';
import { normalizeEmail } from './suppress-shape.js';
import { readAddressChecks, noteAddressCheck, readContactLookups } from './sales-store.js';
import { readSpend, spentThisMonth, spendRefusal, attachedProviders } from './lead-spend.js';

export const VERIFY_COST = 0.5;
export const FIND_COST = 1;
const WILL_BOUNCE = new Set(['invalid', 'disposable']);
const urlOf = () => process.env.NEUMA_LEAD_SOURCE_HUNTER || HUNTER_URL;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** pure — what a check's answer means for a send, in words. */
export const checkWords = (status) => ({
  valid: 'exists (Hunter checked it)', invalid: 'does not exist (Hunter checked it)', disposable: 'is a throwaway address (Hunter checked it)',
  accept_all: 'could not be confirmed: its server accepts every address', webmail: 'is a personal mailbox, which Hunter does not confirm', unknown: 'could not be confirmed: its server did not answer',
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
      if (got.status === 200) { const check = checkOf(got.json); return check ? { ok: true, check } : { ok: false, why: 'Hunter gave no answer for this address' }; }
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
    return { ok: true, found: foundOf(got.json) };
  } catch (err) {
    return { ok: false, why: err.message };
  }
};

/**
 * impure — the check before a first email. For each address: the answer on record, else a fresh check where the
 * operator's rule allows one. Never throws.
 * @returns {Promise<{refusal: ?string, notes: string[]}>} refusal: why nothing may be sent (an address that will
 *   bounce) · notes: what the seat should know (checked and fine; not checked, and why)
 */
export const checkBeforeFirstEmail = async (wallet, emails, { by = 'send', signal } = {}) => {
  const notes = [];
  try {
    const wanted = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
    const known = new Map((await readAddressChecks(wallet)).map((c) => [c.email, c]));
    const hunter = (await attachedProviders()).find((a) => a.id === 'hunter') ?? null;
    for (const email of wanted) {
      let check = known.get(email) ?? null;
      if (!check) {
        if (!hunter) { notes.push(`${email} was not checked before sending: no Hunter key is attached`); continue; }
        const [rule, lookups] = await Promise.all([readSpend(wallet), readContactLookups(wallet)]);
        const no = spendRefusal({ rule, spent: spentThisMonth(lookups, Date.now()), cost: VERIFY_COST });
        if (no) { notes.push(`${email} was not checked before sending: ${rule.on ? 'this month\'s limit for paid lead data is reached' : 'PAID LEAD DATA is off'}`); continue; }
        const asked = await verifyAddress(email, { apiKey: hunter.apiKey, signal });
        if (!asked.ok) { notes.push(`${email} could not be checked before sending: ${asked.why}`); continue; }
        check = { email, ...asked.check };
        await noteAddressCheck(wallet, { email, check: asked.check, spent: VERIFY_COST, by });
      }
      if (!mayWrite(check.status)) return { refusal: `the address ${email} ${checkWords(check.status)} — nothing was sent. Find another address for this person (their company's own pages, sales/contacts, sales/find-address), or close the lead`, notes };
      notes.push(`${email} ${checkWords(check.status)}`);
    }
    return { refusal: null, notes };
  } catch (err) {
    return { refusal: null, notes: [...notes, `the address check could not run: ${err.message}`] };
  }
};
