// THE MAILBOX AND THE LEAD LEDGER — where an email meets the lead engine. A
// send to anyone on the house's do-not-contact list is refused before any
// card, and so is one to a lead that fails the facts check (sales-facts.js)
// or the claims check (claims-reader.js), and a FIRST email that is not short, single-asked and promise-named (first-email.js); a send that leaves records itself on every lead it reached (direction
// out — a cold or contacted lead moves to contacted, a lead further along
// keeps its status); a message from a lead records itself the other way
// (direction in — a cold or contacted lead moves to replied). Lead upkeep
// reads the directions to say who wrote last. A ledger that will not move
// never costs the email: the mail stands either way.
// impure (the house's do-not-contact list and lead ledger).

import { readSuppressions, markSender, readSalesFacts, readProspects, readSegments } from './sales-store.js';
import { checkSalesEmail, factsFor } from './sales-facts.js';
import { claimsRead } from './claims-reader.js';
import { checkFirstEmail, writtenBefore, cleanPromise } from './first-email.js';
import { normalizeEmail, suppressionMatcher } from './suppress-shape.js';
import { leadLedgerFor, kindOf, UNSORTED } from '../leads/lead-ledger.js';
import { checkBeforeFirstEmail } from './address-check.js';
import { createLogger } from '../logger.js';

const log = createLogger('Sales.EmailLedger');
const OUT_MOVES = new Set(['cold', 'contacted']);
const IN_MOVES = new Set(['cold', 'contacted']);

/** The recipients on the house's do-not-contact list. */
export const suppressedRecipients = async (wallet, to) => {
  const blocked = suppressionMatcher(await readSuppressions(wallet));
  return to.filter((address) => blocked.email(address));
};

// pure — the companies these leads are sold: each lead's prospect names its audience, the audience its company.
const companiesOf = (leads, prospects, segments) => [...new Set(leads.map((l) => segments.find((s) => s.id === prospects.find((p) => p.leadId === l.id)?.segmentId)?.company).filter(Boolean))];

/** The one company an email to `to` speaks for, or null (no lead among them, or more than one company). impure. */
export const companyOfRecipients = async (wallet, to) => {
  const wanted = new Set(to.map(normalizeEmail).filter(Boolean));
  const leads = (await (await leadLedgerFor(wallet)).load()).filter((l) => wanted.has(normalizeEmail(l.contact)));
  if (!leads.length) return null;
  const companies = companiesOf(leads, await readProspects(wallet), await readSegments(wallet));
  return companies.length === 1 ? companies[0] : null;
};

/**
 * Why an email may not go to the leads among `to` (the facts check), or null
 * when none of them is a lead or the email passes.
 */
export const leadEmailRefusal = async (wallet, { to, subject, text, promise, laneId }) => {
  const wanted = new Set(to.map(normalizeEmail).filter(Boolean));
  // The sales checks are for people the house SELLS to, and for anyone not yet sorted (until someone says they are
  // not a buyer, the careful rule holds). An applicant, a partner or the press is answered like any other email:
  // by the operator's own approval, with no pitch to check.
  const leads = (await (await leadLedgerFor(wallet)).load()).filter((l) => wanted.has(normalizeEmail(l.contact)) && ['buyer', UNSORTED].includes(kindOf(l)));
  if (!leads.length) return null;
  // The company a lead is sold: its prospect's audience names it. An email speaks for ONE company.
  const [prospects, segments, sheet] = await Promise.all([readProspects(wallet), readSegments(wallet), readSalesFacts(wallet)]);
  const companies = companiesOf(leads, prospects, segments);
  if (companies.length > 1) return `this email goes to leads of ${companies.join(' and ')} — one email speaks for one company`;
  const approved = factsFor(sheet.approved, companies[0] ?? null);
  const verdict = checkSalesEmail({ subject, text, approved });
  if (!verdict.ok) return `this email goes to a lead, and it does not pass the facts check: ${verdict.problems.join('; ')}`;
  // The first email to a lead: short, one ask, and the promise it makes named (first-email.js).
  const shape = leads.some((l) => !writtenBefore(l)) ? checkFirstEmail({ subject, text, promise }) : [];
  if (shape.length) return `this is the first email to a lead: ${shape.join('; ')}`;
  // The address itself, before the first email to it: one that does not exist is never written to (address-check.js).
  const fresh = leads.filter((l) => !writtenBefore(l)).map((l) => l.contact);
  const address = fresh.length ? await checkBeforeFirstEmail(wallet, fresh, { by: laneId ?? 'send' }) : { refusal: null };
  if (address.refusal) return `this email goes to a lead, and ${address.refusal}`;
  // Words, not just numbers: the house's own model names the fact behind every claim (claims-reader.js).
  const claims = await claimsRead({ laneId, facts: approved.facts, subject, text });
  return claims.ok ? null : `this email goes to a lead, and ${claims.reason}`;
};

// impure — touch every open-or-closed lead whose address is one of `emails`.
const touchByAddress = async (wallet, emails, changeFor) => {
  const wanted = new Set(emails.map(normalizeEmail).filter(Boolean));
  if (!wanted.size) return [];
  const ledger = await leadLedgerFor(wallet);
  const hits = (await ledger.load()).filter((l) => wanted.has(normalizeEmail(l.contact)));
  for (const lead of hits) await ledger.touch(lead.id, changeFor(lead));
  return hits.map((l) => l.id);
};

/** Record a sent email on the leads it reached, and the sending address's first day writing to leads. Never throws. */
export const recordSent = async (wallet, { to, subject, promise, by, from }) => {
  try {
    const leads = await touchByAddress(wallet, to, (lead) => ({
      ...(OUT_MOVES.has(lead.status) ? { status: 'contacted' } : {}),
      direction: 'out',
      ...(cleanPromise(promise) ? { promised: cleanPromise(promise) } : {}),
      note: `emailed: "${String(subject).slice(0, 120)}"`,
      by,
    }));
    if (leads.length && from) await markSender(wallet, from);
    return leads;
  } catch (err) {
    log.warn('The lead ledger did not take the sent email — the email stands', { err: err.message });
    return [];
  }
};

/** Record a message a lead sent the house. Never throws. */
export const recordReceived = (wallet, { from, ref }) => touchByAddress(wallet, [from], (lead) => ({
  ...(IN_MOVES.has(lead.status) ? { status: 'replied' } : {}),
  direction: 'in',
  note: `wrote to the house (${ref})`,
  by: 'mail-watch',
})).catch((err) => {
  log.warn('The lead ledger did not take the received mail — the wake stands', { err: err.message });
  return [];
});
