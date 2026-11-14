// LEAD UPKEEP — the maintenance half of the lead engine: what on the house's
// lead ledger needs a hand today, most urgent first. A lead that replied waits
// on an answer; a contacted lead with no reply is due a follow-up, until the
// sequence runs out and it is closed as no reply (who wrote last is read
// from each touch's direction, which the mailbox records itself); a lead
// nobody touched in two weeks has gone stale; two leads with one address are one person; a lead on
// the do-not-contact list is closed. The ledger records what IS — this reads
// it and says what is due; nothing here moves a lead.
// PURE.

import { normalizeEmail } from './suppress-shape.js';

export const FOLLOW_UP_DAYS = 3;
// The first email and two follow-ups.
export const MAX_TOUCHES = 3;
export const STALE_DAYS = 14;
const DAY_MS = 86_400_000;
const OPEN = new Set(['cold', 'contacted', 'replied', 'qualified']);
const ORDER = ['suppressed', 'answer', 'follow-up', 'close-out', 'duplicate', 'stale', 'unreachable'];

// pure — the moment the lead last moved, and how many times the house wrote
// to it: a touch marked out, or (before touches carried a direction) one
// that set the status contacted.
const lastAt = (lead) => Date.parse(lead.touches?.at(-1)?.at ?? lead.updatedAt ?? lead.createdAt);
export const isOut = (t) => t.direction === 'out' || (!t.direction && t.status === 'contacted');
const contactTouches = (lead) => (lead.touches || []).filter(isOut).length;

// pure — did they write last? The last touch with a direction says; a lead
// marked replied by hand, with no direction anywhere, counts as theirs.
export const theyWroteLast = (lead) => {
  const last = [...(lead.touches || [])].reverse().find((t) => t.direction);
  return last ? last.direction === 'in' : lead.status === 'replied';
};

// pure — the one item due on this lead, or null.
const dueOn = (lead, now, suppressed) => {
  const days = Math.floor((now - lastAt(lead)) / DAY_MS);
  if (lead.contact && suppressed(lead.contact)) return { kind: 'suppressed', days };
  if (theyWroteLast(lead)) return { kind: 'answer', days };
  if (lead.status === 'contacted' && days >= FOLLOW_UP_DAYS) {
    return contactTouches(lead) >= MAX_TOUCHES ? { kind: 'close-out', days } : { kind: 'follow-up', days, touches: contactTouches(lead) };
  }
  if (days >= STALE_DAYS) return { kind: 'stale', days };
  if (lead.status === 'cold' && !lead.contact) return { kind: 'unreachable', days };
  return null;
};

/**
 * What is due on the ledger, most urgent first.
 * @param {{leads: object[], now: number, suppressed?: (contact: string) => boolean}} state
 * @returns {Array<{kind: string, leadId: string, name: string, days: number, touches?: number, with?: string}>}
 */
export const upkeepDue = ({ leads, now, suppressed = () => false }) => {
  const open = leads.filter((l) => OPEN.has(l.status));
  const items = open.flatMap((lead) => {
    const due = dueOn(lead, now, suppressed);
    return due ? [{ ...due, leadId: lead.id, name: lead.name || lead.contact || 'unnamed' }] : [];
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
  suppressed: 'on the do-not-contact list: close it (lost, say why) and write nothing more',
  answer: 'they replied: answer it, one clear next step',
  'follow-up': 'no reply yet: one short follow-up that adds something new, or close it',
  'close-out': `no reply after ${MAX_TOUCHES} emails: close it as lost (no reply)`,
  duplicate: 'the same person as another lead: keep one, remove the other',
  stale: 'untouched for two weeks: move it, or close it and say why',
  unreachable: 'no way to reach them: find a real address on their own pages, or remove it',
});
