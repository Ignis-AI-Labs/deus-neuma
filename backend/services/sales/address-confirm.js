// address-confirm — CONFIRM OR FIND, for an address that came back not confirmed (Design note, 2026-11-19, eleven staged
// emails reading RISKY — NOT CONFIRMED: […]).
//
// One pass, the same for the seat (sales/confirm-address) and the operator (FIND CONFIRMED ADDRESSES):
//   1. every attached database that has not checked the address checks it, until one confirms it (confirmWithAny);
//   2. none does: the same person is looked for by name with each attached finder (PAID LEAD DATA, within the
//      month's limit), and each other address found is checked the same way; the first one confirmed is theirs —
//      the lead moves to it, and the email waiting for them is re-addressed in place;
//   3. nothing confirms: the address is SETTLED — NO DATABASE CAN CONFIRM (sales-store.js noteAddressSettled), with
//      who was asked and what was tried. A settled address is never asked or looked for again; the seat is told to
//      stop, and the operator decides: send it as it is, or write to someone else at the company.
// impure (the checkers and finders, the lead ledger, the outbox). Never throws.

import { readAddressChecks, noteAddressSettled, noteContacts } from './sales-store.js';
import { confirmWithAny, mayWrite, FINDERS } from './address-check.js';
import { attachedProviders, reserveSpend, releaseSpend } from './lead-spend.js';
import { normalizeEmail } from './suppress-shape.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { readOutbox, stageDraft } from './email-outbox.js';

/** The answers that send but do not confirm: what this pass is for. */
export const RISKY = Object.freeze(['unknown', 'accept_all', 'webmail']);
const NOT_A_PERSON = /\b(team|capital|ventures?|fund|funds|partners|labs?|group|foundation|dao|inc|llc|ltd|gmbh|holdings|research|info|contact|hello|support)\b/i;

/** pure — a person's full name from a lead's name ([…] → "Bart Stephens"),
 *  or null when it names a team or a company. */
const personName = (leadName) => {
  const head = String(leadName ?? '').split(/[,(|—–]| - | at /)[0].replace(/\s+/g, ' ').trim();
  const words = head.split(' ').filter(Boolean);
  return words.length >= 2 && words.length <= 4 && !NOT_A_PERSON.test(head) ? head : null;
};

const named = (list) => (list.length ? list.join(', ') : 'none');

// impure — the same person looked for by name with each attached finder, cheapest first; each other address found is
// checked at once (confirmWithAny), and the first one confirmed ends the search — nothing more is spent.
const lookFor = async (wallet, { email, name, by, signal }) => {
  const domain = email.split('@')[1];
  const finders = (await attachedProviders()).filter((a) => FINDERS[a.id]);
  const asked = [];
  const tried = [];
  const problems = [];
  for (const a of finders) {
    const finder = FINDERS[a.id];
    const reserved = await reserveSpend(wallet, finder.cost);
    if (!reserved.ok) { problems.push(`${finder.name}: ${reserved.reason}`); break; }
    let out;
    try {
      out = await finder.find(a, { domain, name, signal });
      if (out.ok) await noteContacts(wallet, domain, `${a.id}-find`, [], by, out.spent ?? 0);
    } finally {
      await releaseSpend(wallet, reserved.reservation.id);
    }
    if (!out.ok) { problems.push(`${finder.name}: ${out.why}`); continue; }
    asked.push(finder.name);
    const other = normalizeEmail(out.found?.email);
    if (!other || other === email || tried.includes(other)) continue;
    tried.push(other);
    const check = (await confirmWithAny(wallet, other, { by, signal })).check;
    if (check?.status === 'valid') return { asked, tried, problems, confirmed: { email: other, by: finder.name, check } };
  }
  return { asked, tried, problems, confirmed: null };
};

// impure — the lead and the email waiting for it, moved to the address that was confirmed.
const moveTo = async (wallet, { email, to, lead, foundBy, confirmedBy, by }) => {
  const notes = [];
  if (lead) {
    const moved = await (await leadLedgerFor(wallet)).touch(lead.id, { contact: to, note: `moved to a confirmed address: ${to} (${foundBy} found it, ${confirmedBy.join(' + ')} confirmed it) — no database could confirm ${email}`, by });
    if (!moved.ok) notes.push(`the lead could not be moved: ${moved.error}`);
  }
  const waiting = (await readOutbox(wallet)).drafts.filter((d) => d.state === 'waiting' && d.to.includes(email));
  for (const d of waiting) {
    const again = await stageDraft(wallet, { id: d.id, to: [to], subject: d.subject, text: d.text, promise: d.promise, by: d.by, followUp: d.followUp === true, formula: d.formula ?? null });
    notes.push(again.ok ? `the email [${d.id}] now goes to ${to}` : `the email [${d.id}] still names ${email}: ${again.reason}`);
  }
  return notes;
};

/**
 * @param {string} wallet
 * @param {{email: string, by?: string, signal?: AbortSignal}} q
 * @returns {Promise<{outcome: 'confirmed'|'found'|'settled'|'nothing-to-do', email: string, to?: string, words: string}>}
 */
export const confirmAddress = async (wallet, { email: given, by = 'operator', signal } = {}) => {
  const email = normalizeEmail(given);
  try {
    const before = (await readAddressChecks(wallet)).find((c) => c.email === email) ?? null;
    if (before?.status === 'valid' && before.live) return { outcome: 'nothing-to-do', email, words: `${email} is confirmed already (${named(before.confirmedBy)}).` };
    if (before?.settled) return { outcome: 'settled', email, words: settledWords(email, before.settled) };
    // 1. Every database not yet asked, until one confirms it.
    const first = await confirmWithAny(wallet, email, { by, signal });
    if (first.check?.status === 'valid') return { outcome: 'confirmed', email, words: `${email} is confirmed now: ${named(first.check.confirmedBy)} confirmed it.` };
    const checkedBy = first.check?.checkedBy ?? [];
    // 2. The same person, at another address.
    const lead = (await (await leadLedgerFor(wallet)).load()).find((l) => normalizeEmail(l.contact) === email) ?? null;
    const name = personName(lead?.name);
    const look = name ? await lookFor(wallet, { email, name, by, signal }) : { asked: [], tried: [], problems: [], confirmed: null };
    if (look.confirmed) {
      const { email: to, by: foundBy, check } = look.confirmed;
      const notes = await moveTo(wallet, { email, to, lead, foundBy, confirmedBy: check.confirmedBy, by });
      return { outcome: 'found', email, to, words: `No database could confirm ${email}, so ${name} was looked for: ${foundBy} found ${to}, and ${named(check.confirmedBy)} confirmed it. ${notes.join('; ')}.` };
    }
    // 3. Nothing confirms: settled, so nobody asks again.
    const dead = first.check && !mayWrite(first.check.status);
    const why = [!name ? 'the lead names no person to look for (a team or a company address)' : null, ...first.problems, ...look.problems].filter(Boolean).join('; ') || null;
    const mark = { outcome: dead ? 'will-bounce' : 'unconfirmable', checkedBy, findersAsked: look.asked, tried: look.tried, why };
    await noteAddressSettled(wallet, { email, ...mark, by });
    return { outcome: 'settled', email, words: settledWords(email, { ...mark, at: new Date().toISOString() }) };
  } catch (err) {
    return { outcome: 'nothing-to-do', email, words: `${email} could not be confirmed or looked for now (${err.message}) — try again in a moment.` };
  }
};

/** pure — what a settled address means, for the seat and the operator. */
export const settledWords = (email, s) => `NO DATABASE CAN CONFIRM ${email} (settled ${String(s.at ?? '').slice(0, 10)}): asked ${named(s.checkedBy ?? [])}`
  + `${(s.findersAsked ?? []).length ? `; looked for the person with ${named(s.findersAsked)}${(s.tried ?? []).length ? `, which found ${s.tried.join(', ')} — not confirmed either` : ', which found no other address'}` : ''}`
  + `${s.why ? ` (${s.why})` : ''}. Do not check it or look for it again. Your operator decides: send it as it is, or write to someone else at the company (sales/contacts).`;
