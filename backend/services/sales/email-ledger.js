// THE MAILBOX AND THE LEAD LEDGER — where an email meets the lead engine. A
// send to anyone on the house's do-not-contact list is refused before any
// card, and so is one to a lead that fails the facts check (sales-facts.js); a send that leaves records itself on every lead it reached (direction
// out — a cold or contacted lead moves to contacted, a lead further along
// keeps its status); a message from a lead records itself the other way
// (direction in — a cold or contacted lead moves to replied). Lead upkeep
// reads the directions to say who wrote last. A ledger that will not move
// never costs the email: the mail stands either way.
// impure (the house's do-not-contact list and lead ledger).

import { readSuppressions, markSender, readSalesFacts } from './sales-store.js';
import { checkSalesEmail } from './sales-facts.js';
import { normalizeEmail, suppressionMatcher } from './suppress-shape.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { createLogger } from '../logger.js';

const log = createLogger('Sales.EmailLedger');
const OUT_MOVES = new Set(['cold', 'contacted']);
const IN_MOVES = new Set(['cold', 'contacted']);

/** The recipients on the house's do-not-contact list. */
export const suppressedRecipients = async (wallet, to) => {
  const blocked = suppressionMatcher(await readSuppressions(wallet));
  return to.filter((address) => blocked.email(address));
};

/**
 * Why an email may not go to the leads among `to` (the facts check), or null
 * when none of them is a lead or the email passes.
 */
export const leadEmailRefusal = async (wallet, { to, subject, text }) => {
  const wanted = new Set(to.map(normalizeEmail).filter(Boolean));
  const leads = (await (await leadLedgerFor(wallet)).load()).filter((l) => wanted.has(normalizeEmail(l.contact)));
  if (!leads.length) return null;
  const verdict = checkSalesEmail({ subject, text, approved: (await readSalesFacts(wallet)).approved });
  return verdict.ok ? null : `this email goes to a lead, and it does not pass the facts check: ${verdict.problems.join('; ')}`;
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
export const recordSent = async (wallet, { to, subject, by, from }) => {
  try {
    const leads = await touchByAddress(wallet, to, (lead) => ({
      ...(OUT_MOVES.has(lead.status) ? { status: 'contacted' } : {}),
      direction: 'out',
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
