// THE COMMERCE REVIEW — the CLO's watch widened from code and releases to the
// house's commercial acts (the house economy's Stage 4: […]). One leg of
// the daily legal watch (legal-scheduler.js): it reads what the house's
// companies did and files a matter for each thing that needs a legal reading:
//   - TERMS: a company won a deal and delivers to buyers — its customer terms;
//   - TAX: a company issued invoices — sales tax or VAT where its buyers are;
//   - INFLOW: money landed at an invoice or raise wallet that no invoice paid
//     and no investor closed, a week on — receiving money for others can be
//     money transmission;
//   - REFUND: a buyer asks for money back — money out is the operator's;
//   - SANCTIONS: a buyer or an investor whose name is on the public list
//     (sanctions-list.js), or no screening at all while that connection is off.
// It flags; it never holds an act (the claims check's law). Every matter
// names its counsel question (docs/legal/COUNSEL_NOTES.md, 2026-10-30).
// The findings are pure; the read is impure.

import { listCompanies } from '../company-line/company-store.js';
import { readDeals } from '../revenue/deal-store.js';
import { readInvoices, readPayTo } from '../invoices/invoice-store.js';
import { readRaise } from '../raise/raise-store.js';
import { readReceipts } from '../money-in/money-in-store.js';
import { replyCandidatesOf } from '../social/reply-candidates.js';
import { refreshSanctions, readSanctions, screen } from './sanctions-list.js';
import { readNeverList } from './never-list.js';
import { neverSign } from '../sales/never-countries.js';
import { readProspects } from '../sales/sales-store.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';

const WEEK_MS = 7 * 86_400_000;
const REFUND = /\b(refund|refunded|money back|chargeback|charged (me )?twice)\b/i;
const base = { area: 'commerce', source: 'commerce-review', repo: null, filedBy: 'commerce-review' };
const lower = (a) => String(a ?? '').toLowerCase();

/**
 * The matters the house's commercial record calls for. pure.
 * @param {{companies: object[], deals: object[], invoices: object[], raises: Array<{company: object, state: ?object}>,
 *   receipts: object[], replies: object[], payTo: ?object, sanctions: ?{list: object[], fetchedAt: string}, nowMs: number,
 *   unscreened?: ?string}} record - unscreened: why there is no list (the connection off, or the fetch's failure)
 */
export const commerceFindings = ({ companies, deals, invoices, raises, receipts, replies, payTo, sanctions, nowMs, unscreened = null, never = null, leads = [] }) => {
  const name = (id) => companies.find((c) => c.id === id)?.name ?? id;
  const won = deals.filter((d) => d.stage === 'won');
  const terms = [...new Set(won.map((d) => d.companyId))].map((id) => ({
    ...base, companyId: id, externalId: `terms:${id}`, severity: 'medium',
    title: `Customer terms for ${name(id)}, before it delivers to a buyer`,
    summary: `${name(id)} has won a deal. The work it delivers needs terms the buyer agreed to: the scope, who owns AI-made work, warranties and their limits, refunds, and that the work is AI-performed. Counsel question 6.`,
  }));
  const tax = [...new Set(invoices.filter((v) => v.status !== 'void').map((v) => v.companyId))].map((id) => ({
    ...base, companyId: id, externalId: `tax:${id}`, severity: 'medium',
    title: `Sales tax or VAT on ${name(id)}'s invoices`,
    summary: `${name(id)} issues invoices. Whether it owes sales tax or VAT, and what each invoice must carry, depends on where it and its buyers are — a CPA's and counsel's answer (counsel questions 4 and 5).`,
  }));
  const wallets = new Set([payTo?.address, ...raises.map((r) => (r.state?.account?.kind === 'wallet' ? r.state.account.address : null))].filter(Boolean).map(lower));
  const explained = new Set([
    ...invoices.map((v) => v.paid?.receipt).filter(Boolean),
    ...raises.flatMap((r) => (r.state?.investors ?? []).map((i) => i.closed?.received?.ref).filter(Boolean)),
  ]);
  const inflow = receipts.filter((r) => wallets.has(lower(r.to)) && !explained.has(r.key) && nowMs - Date.parse(r.timestamp) > WEEK_MS).map((r) => ({
    ...base, externalId: `inflow:${r.key}`, severity: 'medium',
    title: `${r.amount} ${r.asset} landed at ${r.to} that no invoice or raise explains`,
    summary: `Money arrived on ${r.timestamp.slice(0, 10)} at a wallet the house is paid at, and a week on no invoice was paid by it and no investor closed on it. Find who sent it and why: money received for someone else can be money transmission. Counsel question 5.`,
  }));
  const refunds = replies.filter((c) => REFUND.test(String(c.text ?? ''))).map((c) => ({
    ...base, externalId: `refund:${c.postId}`, severity: 'high',
    title: `A buyer asks for money back${c.username ? ` (@${c.username})` : ''}`,
    summary: 'A reply to the house asks for a refund. Read it against the customer terms; a refund is money out, and money out is always the operator\'s to send. Counsel question 6.',
  }));
  const names = [
    ...won.map((d) => ({ kind: 'buyer', id: d.id, name: d.buyer })),
    ...raises.flatMap((r) => (r.state?.investors ?? []).flatMap((i) => [{ kind: 'investor', id: i.id, name: i.name }, ...(i.firm ? [{ kind: 'investor firm', id: i.id, name: i.firm }] : [])])),
  ];
  const sanctionMatters = !names.length ? [] : !sanctions
    ? [unscreened && unscreened !== 'off' ? {
      ...base, externalId: 'sanctions-unread', severity: 'medium',
      title: `The sanctions list could not be read — ${names.length} buyers and investors not screened`,
      summary: `The Sanctions list connection is on, but the list could not be fetched (${unscreened}). Nothing is screened until it is. Counsel question 7.`,
    } : {
      ...base, externalId: 'sanctions-off', severity: 'low',
      title: `Sanctions screening is off — ${names.length} buyers and investors not screened`,
      summary: 'Turn on the Sanctions list connection (Settings → Security → Connections) so every buyer and investor is checked against the public list before the house invoices, delivers or closes. Counsel question 7.',
    }]
    : screen(names, sanctions.list).map((hit) => ({
      ...base, externalId: `sanctions:${hit.kind}:${hit.id}`, severity: 'critical',
      title: `Possible sanctions match: ${hit.name} (${hit.kind}) — listed as ${hit.listed.name}${hit.listed.program ? `, ${hit.listed.program}` : ''}`,
      summary: `The name matches entry ${hit.listed.id} on the public sanctions list (as read ${sanctions.fetchedAt.slice(0, 10)}). A name is not a person: confirm who this is before the house invoices, delivers or closes — and do neither until it is cleared. Counsel question 7.`,
    }));
  // THE NEVER-LIST, kept in step with the sales office (never-list.js): a house whose list nobody reviewed, and any
  // lead that stands in a listed place — the sales office reads the same record, so one here slipped past a sign.
  const neverMatters = !never ? [] : [
    // Owed once the house has leads at all: a house that sells to nobody yet is not asked.
    ...(never.reviewed || !leads.length ? [] : [{
      ...base, externalId: 'never-list-unreviewed', severity: 'medium',
      title: 'The house has no never-list of its own: only the baseline stands',
      summary: `The sales office writes to nobody in ${never.countries.map((c) => c.name).join(', ')} — the places under comprehensive United States sanctions, a floor for a house that has said nothing yet. Work out the list for the country your operator is in and the law that reaches them, and propose it: legal/never-list {home, countries: [{code, why, source}]}. Counsel question 7.`,
    }]),
    ...leads.flatMap((l) => { const sign = neverSign({ country: l.country, domain: l.domain, emails: [l.email] }, never.codes); return sign ? [{
      ...base, externalId: `never-lead:${l.id}`, severity: 'critical',
      title: `A lead stands in a place on the never-list: ${l.name} (${sign.name})`,
      summary: `${l.name} <${l.email}>: ${sign.why}. No first email is written to it (the sales office reads the same list), but it is on the lead ledger: confirm where it is, and close it or correct its record.`,
    }] : []; }),
  ];
  return [...terms, ...tax, ...inflow, ...refunds, ...sanctionMatters, ...neverMatters];
};

/**
 * The house's commerce review: the list brought up to date (when its
 * connection is on), the record read, the findings made. impure.
 * @returns {Promise<{matters: object[], sanctions: object}>}
 */
export const reviewCommerce = async (wallet, nowMs = Date.now()) => {
  const refreshed = await refreshSanctions(nowMs);
  const { companies } = await listCompanies(wallet).catch(() => ({ companies: [] }));
  const [{ deals }, { invoices }, payTo, receipts, replies, sanctions, raises] = await Promise.all([
    readDeals(wallet).catch(() => ({ deals: [] })), readInvoices(wallet).catch(() => ({ invoices: [] })), readPayTo(wallet).catch(() => null),
    readReceipts(wallet).catch(() => []), replyCandidatesOf(wallet).load().catch(() => []),
    refreshed.off ? Promise.resolve(null) : readSanctions(),
    Promise.all(companies.map(async (company) => ({ company, state: await readRaise(wallet, company.id).catch(() => null) }))),
  ]);
  const unscreened = refreshed.off ? 'off' : (!sanctions ? refreshed.error ?? 'no copy kept' : null);
  // The sales office's open leads, each with the company it came from: read against the never-list.
  const [never, prospects, ledger] = await Promise.all([readNeverList(wallet).catch(() => null), readProspects(wallet).catch(() => []), leadLedgerFor(wallet).then((l) => l.load()).catch(() => [])]);
  const companyOf = new Map(prospects.filter((p) => p.leadId).map((p) => [p.leadId, p]));
  const leads = ledger.filter((l) => !['closed', 'lost'].includes(l.status) && String(l.contact).includes('@')).map((l) => ({ id: l.id, name: l.name, email: String(l.contact).toLowerCase(), country: companyOf.get(l.id)?.country ?? null, domain: companyOf.get(l.id)?.domain ?? '' }));
  return { matters: commerceFindings({ companies, deals, invoices, raises, receipts, replies, payTo, sanctions, nowMs, unscreened, never, leads }), sanctions: refreshed };
};
