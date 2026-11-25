// impure — the cost sheet of one house (lead-cost.js), read from its records: the plans, the lead ledger, who found
// each lead, this month's lookups, and what the books hold as paid out. Never throws for a house with no books.
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { listCompanies } from '../company-line/company-store.js';
import { readBooks } from '../accounts/books-store.js';
import { readPlans } from './lead-plans.js';
import { leadCosts } from './lead-cost.js';
import { leadProvenance } from './lead-provenance.js';
import { readProspects, readCandidates, readContactPeople, readContactLookups } from './sales-store.js';

/** Every amount the books of the house's companies hold as money OUT: {memo, amount, currency, date}. */
export const paidOut = async (wallet) => {
  const { companies } = await listCompanies(wallet).catch(() => ({ companies: [] }));
  const books = await Promise.all((companies ?? []).map((c) => readBooks(wallet, c.id).catch(() => ({ entries: [] }))));
  return books.flatMap((b) => b.entries).filter((e) => e.direction === 'out').map((e) => ({ memo: e.memo, amount: e.amount, currency: e.currency, date: e.date }));
};

/**
 * @param {string} wallet
 * @param {{leads?: object[], provenance?: Map, lookups?: object[], now?: number}} [known] what the caller already read
 */
export const readLeadCosts = async (wallet, known = {}) => {
  const plans = await readPlans(wallet);
  const now = known.now ?? Date.now();
  if (!plans.length) return leadCosts({ plans, leads: known.leads ?? [], now });
  const leads = known.leads ?? await leadLedgerFor(wallet).then((l) => l.load());
  const provenance = known.provenance ?? leadProvenance({ leads, prospects: await readProspects(wallet), candidates: await readCandidates(wallet), lookups: await readContactPeople(wallet) });
  return leadCosts({ plans, leads, provenance, lookups: known.lookups ?? await readContactLookups(wallet), booked: await paidOut(wallet), now });
};
