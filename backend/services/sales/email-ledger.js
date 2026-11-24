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

import { firstEmailScreen } from './lead-screen.js';
import { closes, saidWords } from './reply-said.js';
import { readSuppressions, markSender, readSalesFacts, readProspects, readSegments } from './sales-store.js';
import { checkSalesEmail, factsFor } from './sales-facts.js';
import { readNeverList } from '../legal/never-list.js';
import { claimsRead } from './claims-reader.js';
import { checkFirstEmail, writtenBefore, cleanPromise } from './first-email.js';
import { normalizeEmail, suppressionMatcher } from './suppress-shape.js';
import { leadLedgerFor, kindOf, UNSORTED, personTouches } from '../leads/lead-ledger.js';
import { checkBeforeSending } from './address-check.js';
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
 * The address check of an email, alone (address-check.js), or null when it may go. A FIRST email to a lead goes only to
 * an address a database confirmed live (2026-11-19, a stored "verified" that hard-bounced: Founder, […]); the operator alone may send one anyway (acceptRisk). Someone who wrote to the house is known to be real.
 * Run at staging and again at every send (email-outbox.js sendDraft). impure.
 */
export const addressRefusal = async (wallet, { to, laneId, acceptRisk = false, everyone = null, leads = null }) => {
  const wanted = new Set(to.map(normalizeEmail).filter(Boolean));
  const people = everyone ?? (await (await leadLedgerFor(wallet)).load()).filter((l) => wanted.has(normalizeEmail(l.contact)));
  const sold = leads ?? people.filter((l) => ['buyer', UNSORTED].includes(kindOf(l)));
  const first = sold.some((l) => !writtenBefore({ touches: personTouches(l) }) && !personTouches(l).some((t) => t.direction === 'in'));
  const wrote = people.filter((l) => personTouches(l).some((t) => t.direction === 'in')).map((l) => l.contact);
  const address = await checkBeforeSending(wallet, [...wanted], { by: laneId ?? 'send', skip: wrote, requireConfirmed: first && !acceptRisk });
  if (!address.refusal) return null;
  return sold.length ? `this email goes to a lead, and ${address.refusal}` : address.refusal;
};

/**
 * Why an email may not go (the facts check on a lead's email, and the address check on every recipient's), or null
 * when it may.
 */
export const leadEmailRefusal = async (wallet, { to, subject, text, promise, laneId, acceptRisk = false, claims: readClaims = true, external = true }) => {
  const wanted = new Set(to.map(normalizeEmail).filter(Boolean));
  const everyone = (await (await leadLedgerFor(wallet)).load()).filter((l) => wanted.has(normalizeEmail(l.contact)));
  // The sales checks are for people the house SELLS to, and for anyone not yet sorted (until someone says they are
  // not a buyer, the careful rule holds). An applicant, a partner or the press is answered like any other email:
  // by the operator's own approval, with no pitch to check.
  const leads = everyone.filter((l) => ['buyer', UNSORTED].includes(kindOf(l)));
  let approved = null;
  if (leads.length) {
    // The company a lead is sold: its prospect's audience names it. An email speaks for ONE company.
    const [prospects, segments, sheet] = await Promise.all([readProspects(wallet), readSegments(wallet), readSalesFacts(wallet)]);
    const companies = companiesOf(leads, prospects, segments);
    if (companies.length > 1) return `this email goes to leads of ${companies.join(' and ')} — one email speaks for one company`;
    approved = factsFor(sheet.approved, companies[0] ?? null);
    const verdict = checkSalesEmail({ subject, text, approved });
    if (!verdict.ok) return `this email goes to a lead, and it does not pass the facts check: ${verdict.problems.join('; ')}`;
    // The first email to a lead: short, one ask, and the promise it makes named (first-email.js).
    // Written before means to THIS person: a lead moved to the next person at its company owes them a first email.
    const firstTo = (l) => !writtenBefore({ touches: personTouches(l) });
    const shape = leads.some(firstTo) ? checkFirstEmail({ subject, text, promise }) : [];
    if (shape.length) return `this is the first email to a lead: ${shape.join('; ')}`;
    // THE SCREEN (lead-screen.js): a first email goes only to a company scored a fit for an approved audience, with
    // what that audience requires proved — on every road an email takes, not only the staged one. The operator alone
    // may send one anyway.
    if (!acceptRisk) {
      const never = (await readNeverList(wallet)).codes;
      for (const lead of leads.filter((l) => firstTo(l) && !personTouches(l).some((t) => t.direction === 'in'))) {
        const prospect = prospects.find((p) => p.leadId === lead.id && p.stage !== 'dropped') ?? null;
        const unscreened = firstEmailScreen({ lead, prospect, segment: prospect ? segments.find((sg) => sg.id === prospect.segmentId) ?? null : null, segments, never });
        if (unscreened) return `this is the first email to a lead, and ${unscreened}`;
      }
    }
  }
  if (!external) return null;
  // EVERY ADDRESS, BEFORE IT LEAVES (Design note, 2026-11-19: […]): one that does not
  // exist, or cannot be checked, is never written to (address-check.js) — first email or not. Someone who wrote to the
  // house is known to be real and is not asked. These provider/DNS/model calls run only at execution.
  const address = await addressRefusal(wallet, { to, laneId, acceptRisk, everyone, leads });
  if (address) return address;
  // claims false: the OPERATOR's own send of an email they read (email-outbox.js). No model reads it again.
  if (!leads.length || !readClaims) return null;
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

/**
 * The conversation an email to ONE lead continues: the message ids already exchanged with that person, oldest first
 * (ours as sent, theirs as received). Sent with them, the email lands in the same thread in their mail program.
 * Several recipients, or nobody on the ledger: none. Never throws. impure.
 * @param {string} wallet @param {string[]} to
 * @returns {Promise<string[]>}
 */
export const threadFor = async (wallet, to) => {
  try {
    if (!Array.isArray(to) || to.length !== 1) return [];
    const address = normalizeEmail(to[0]);
    const lead = (await (await leadLedgerFor(wallet)).load()).find((l) => normalizeEmail(l.contact) === address);
    return lead ? personTouches(lead).filter((t) => t.messageId && t.delivery !== 'maybe-sent').map((t) => t.messageId) : [];
  } catch { return []; }
};

/** Record a sent email on the leads it reached, and the sending address's first day writing to leads. Never throws. */
export const recordSent = async (wallet, { to, subject, promise, by, from, messageId, uncertain = false }) => {
  try {
    const leads = await touchByAddress(wallet, to, (lead) => ({
      ...(OUT_MOVES.has(lead.status) ? { status: 'contacted' } : {}),
      direction: 'out',
      ...(from ? { from: String(from).trim().toLowerCase() } : {}),
      ...(cleanPromise(promise) ? { promised: cleanPromise(promise) } : {}),
      ...(messageId ? { messageId } : {}),
      ...(uncertain ? { delivery: 'maybe-sent' } : {}),
      note: `${uncertain ? 'maybe emailed' : 'emailed'}: "${String(subject).slice(0, 120)}"`,
      by,
    }));
    if (leads.length && from) await markSender(wallet, from);
    return leads;
  } catch (err) {
    log.warn('The lead ledger did not take the sent email — the email stands', { err: err.message });
    return [];
  }
};

/** Record a message a lead sent the house, with its subject and their own words when it was read. Never throws. */
// What it says (reply-reading.js) is kept with it and moves the lead: a no, or a person who has left, closes it — the
// house stops writing and the contact stays on the ledger; a machine's reply moves nothing, so the follow-ups run on.
export const recordReceived = (wallet, { from, ref, subject = null, text = null, said = null, messageId = null, closeProven = false }) => touchByAddress(wallet, [from], (lead) => ({
  ...(messageId ? { messageId } : {}), // their message's own id: the next email to them names it and stays in their thread
  ...(closes(said) && closeProven && lead.status !== 'won' ? { status: 'lost' } : said?.says === 'auto' ? {} : IN_MOVES.has(lead.status) ? { status: 'replied' } : {}),
  direction: 'in',
  ...(said ? { said } : {}),
  note: `wrote to the house (${ref})${said && said.says !== 'open' ? ` — ${saidWords(said)}` : ''}`,
  ...(subject ? { subject } : {}),
  ...(text ? { text } : {}),
  by: 'mail-watch',
})).catch((err) => {
  log.warn('The lead ledger did not take the received mail — the wake stands', { err: err.message });
  return [];
});
