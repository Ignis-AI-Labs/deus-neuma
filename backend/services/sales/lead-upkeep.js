// LEAD UPKEEP — the maintenance half of the lead engine: what on the house's
// lead ledger needs a hand today, most urgent first. A lead that replied waits
// on an answer; a contacted lead with no reply is due a follow-up, until the
// sequence runs out and it is closed as no reply — and when the house holds
// someone else at that company, the next one up is named to write to instead
// (top-first.js: the top first, then down the team); who wrote last is read
// from each touch's direction, which the mailbox records itself; a lead
// nobody touched in two weeks has gone stale; two leads with one address are one person; a lead on
// the do-not-contact list is closed. The ledger records what IS — this reads
// it and says what is due; nothing here moves a lead.
// PURE.

import { saidOf } from './reply-said.js';
import { normalizeEmail } from './suppress-shape.js';
import { promiseOf } from './first-email.js';
import { kindOf, UNSORTED, personTouches, formerContacts } from '../leads/lead-ledger.js';
import { nextUp, domainOfAddress } from './top-first.js';

export const FOLLOW_UP_DAYS = 3;
// The first email and two follow-ups.
export const MAX_TOUCHES = 3;
export const STALE_DAYS = 14;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const OPEN = new Set(['cold', 'contacted', 'replied', 'qualified']);
const ORDER = ['bounced', 'suppressed', 'sort', 'answer', 'follow-up', 'next-up', 'close-out', 'duplicate', 'stale', 'unreachable'];

// pure — the moment the lead last moved, and how many times the house wrote
// to it: a touch marked out, or (before touches carried a direction) one
// that set the status contacted.
const lastAt = (lead) => Date.parse(lead.touches?.at(-1)?.at ?? lead.updatedAt ?? lead.createdAt);
export const isOut = (t) => t.direction === 'out' || (!t.direction && t.status === 'contacted');
// Counted for the lead's current person: a lead moved to the next person at its company starts its sequence anew.
const contactTouches = (lead) => personTouches(lead).filter(isOut).length;

// pure — did they write last? The last touch with a direction says; a lead
// marked replied by hand, with no direction anywhere, counts as theirs.
export const theyWroteLast = (lead) => {
  const last = [...personTouches(lead)].reverse().find((t) => t.direction);
  return last ? last.direction === 'in' : lead.status === 'replied';
};

/**
 * pure — when a lead's address bounced, closing it (mail-upkeep.js: […]): {at, address} of the
 * dead address, or null. Such a lead is not done with — its person, or the next one up, has a right address to find
 * (Design note, 2026-11-19: […]). A lead moved to a new address since
 * is no longer bounced.
 */
export const bouncedLead = (lead) => {
  if (lead?.status !== 'lost') return null;
  const touches = lead.touches ?? [];
  const at = touches.findLastIndex((t) => /^address bounced\b/i.test(String(t.note ?? '')));
  if (at === -1 || touches.slice(at + 1).some((t) => t.contactFrom || t.status && t.status !== 'lost')) return null;
  return { at: touches[at].at, address: lead.contact ?? null };
};

// pure — the one item due on this lead, or null. `next` names whom to write to at the lead's company once it ran out of touches.
const dueOn = (lead, now, suppressed, next = () => null) => {
  const days = Math.floor((now - lastAt(lead)) / DAY_MS);
  // A bounce is not a no: the right address is found and the lead moved to it (before do-not-contact, which the dead
  // address is on).
  const bounced = bouncedLead(lead);
  if (bounced) return { kind: 'bounced', days, address: bounced.address };
  if (lead.contact && suppressed(lead.contact)) return { kind: 'suppressed', days };
  // Before anything else is done with a lead, someone says what it is: nobody is worked as a buyer by default.
  if (kindOf(lead) === UNSORTED) return { kind: 'sort', days };
  // A reply is answered in hours, with what the house said it would send.
  // A machine's reply (out of office) is nobody to answer: the lead goes on as if it had not come.
  const said = saidOf(lead);
  if (theyWroteLast(lead) && said?.says !== 'auto') return { kind: 'answer', days, hours: Math.floor((now - lastAt(lead)) / HOUR_MS), promised: promiseOf(lead), ...(said ? { said: said.says, ...(said.want ? { want: said.want } : {}) } : {}) };
  // The follow-up sequence is a sales cadence: it runs for buyers only. Anyone else is answered, never chased.
  if (lead.status === 'contacted' && days >= FOLLOW_UP_DAYS && kindOf(lead) === 'buyer') {
    if (contactTouches(lead) < MAX_TOUCHES) return { kind: 'follow-up', days, touches: contactTouches(lead) };
    // Silence from the top is not a closed company: the next person up at it is named, when the house holds one.
    const after = next(lead);
    return after ? { kind: 'next-up', days, next: after, domain: domainOfAddress(lead.contact) } : { kind: 'close-out', days };
  }
  if (days >= STALE_DAYS) return { kind: 'stale', days };
  if (lead.status === 'cold' && !lead.contact) return { kind: 'unreachable', days };
  return null;
};

/**
 * What is due on the ledger, most urgent first.
 * @param {{leads: object[], now: number, suppressed?: (contact: string) => boolean, held?: Map<string, object[]>}} state
 *   held: everyone the house holds at each company, top first (top-first.js peopleByCompany)
 * @returns {Array<{kind: string, leadId: string, name: string, days: number, hours?: number, promised?: ?string, touches?: number, with?: string}>}
 */
export const upkeepDue = ({ leads, now, suppressed = () => false, held = new Map() }) => {
  const open = leads.filter((l) => OPEN.has(l.status) || bouncedLead(l));
  // Everyone a lead points at now, or pointed at before it moved on: none of them is named next again.
  const onLedger = new Set(leads.flatMap((l) => [l.contact, ...formerContacts(l)]).map(normalizeEmail).filter(Boolean));
  const next = (lead) => nextUp(lead, held, onLedger, suppressed);
  const items = open.flatMap((lead) => {
    const due = dueOn(lead, now, suppressed, next);
    return due ? [{ ...due, leadId: lead.id, name: lead.name || lead.contact || 'unnamed', leadKind: kindOf(lead) }] : [];
  });
  const firstByEmail = new Map();
  for (const lead of open) {
    const email = normalizeEmail(lead.contact);
    if (!email) continue;
    const first = firstByEmail.get(email);
    if (first) items.push({ kind: 'duplicate', leadId: lead.id, name: lead.name || email, days: 0, with: first.id });
    else firstByEmail.set(email, lead);
  }
  return items.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.days - a.days);
};

/** What each kind of item asks of the Mercator, in one line. pure. */
export const UPKEEP_ASK = Object.freeze({
  bounced: 'the address BOUNCED: find the right one — the same person, or the next one up at the company — on their own pages or with sales/find-address, then move the lead to it with sales/lead {lead, person: {name, role}, email, emailSource}; the new address is checked before anything is sent, then write the email again',
  suppressed: 'on the do-not-contact list: close it (lost, say why) and write nothing more',
  sort: 'not sorted yet: say what they are to the house with sales/kind (several at once in one filing), from what their own words show',
  answer: 'they replied: answer it today — send exactly what you promised, then one clear next step',
  // Said beside an answer item when the reply was read (reply-reading.js): what they asked for comes first.
  'answer:deck': 'they ASKED FOR THE DECK: answer today — send it (the promised link), in two or three lines, with one clear next step',
  'answer:call': 'they are OPEN TO A CALL: answer today — offer the booking link and two times, nothing else',
  'answer:more': 'they ASKED A QUESTION: answer it plainly today, from the company\'s own facts, then one clear next step',
  'follow-up': 'no reply yet: one short follow-up that adds something new (sales/draft-email with followUp: true), or close it',
  'next-up': `no reply after ${MAX_TOUCHES} emails: move this lead to the next person at their company, named here, top first — sales/lead {lead, person: {name, role}, email, emailSource} — then write to them`,
  'close-out': `no reply after ${MAX_TOUCHES} emails: close it as lost (no reply)`,
  duplicate: 'the same person as another lead: keep one, remove the other',
  stale: 'untouched for two weeks: move it, or close it and say why',
  unreachable: 'no way to reach them: find a real address on their own pages, or remove it',
});
