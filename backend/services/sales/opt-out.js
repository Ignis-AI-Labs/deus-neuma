// OPT-OUT — every sales email carries its way out, and who sends it from where (Design note, 2026-11-23: […]; then: […]).
// CAN-SPAM in the US asks every commercial email for a working opt-out and the sender's postal address; PECR in the
// UK for who sends it and a way out. The footer (email/opt-out-footer.js) says to reply […]; the mail watch closes
// the address on that word (reply-rules.js asksToStop). The address printed is the legal entity's: the company the
// lead is sold for, or the nearest company above it in the house's tree that has one (a product of a company sends
// as that company).

import { listCompanies, sendingEntity } from '../marketing/companies.js';
import { leadLedgerFor, kindOf, UNSORTED } from '../leads/lead-ledger.js';
import { normalizeEmail } from './suppress-shape.js';
import { companyOfRecipients } from './email-ledger.js';
import { optOutFooter } from '../email/opt-out-footer.js';

/** The company a footer speaks for: the one the leads are sold for, else the house's only or first top company. pure. */
export const footerCompany = (companies, soldFor) => sendingEntity(companies, companies.find((c) => c.id === soldFor)
  ?? (companies.length === 1 ? companies[0] : companies.find((c) => !c.parentId) ?? null));

const SOLD_TO = new Set([UNSORTED, 'buyer']);

/**
 * What an email to `to` carries to opt out, or null when it goes to nobody the house sells to (an invoice, a reply
 * to a vendor). Sales mail is any to a buyer or a lead not yet sorted. pure.
 * @param {{leads: object[], companies: object[], soldFor?: ?string}} read soldFor: the company the leads are sold for
 * @param {string[]} to
 * @returns {?{footer: string, postal: ?string, company: ?string}}
 */
export const optOutOf = ({ leads, companies, soldFor = null }, to) => {
  const wanted = new Set([].concat(to).map(normalizeEmail).filter(Boolean));
  if (!leads.some((l) => wanted.has(normalizeEmail(l.contact)) && SOLD_TO.has(kindOf(l)))) return null;
  const company = footerCompany(companies, soldFor);
  const postal = company?.legalEntity?.postalAddress ?? null;
  return { footer: optOutFooter({ name: company?.legalEntity?.name ?? company?.name ?? null, postal }), postal, company: company?.id ?? null };
};

// impure — the company the recipients are sold for, asked only when the house has more than one to choose from.
const soldForOf = (wallet, companies, to) => (companies.length > 1 ? companyOfRecipients(wallet, [].concat(to)).catch(() => null) : null);

/** optOutOf for one email, read from the house's records. impure. */
export const salesOptOut = async (wallet, to) => {
  if (!wallet) return null;
  const [leads, companies] = await Promise.all([leadLedgerFor(wallet).then((l) => l.load()), listCompanies(wallet).catch(() => [])]);
  return optOutOf({ leads, companies, soldFor: await soldForOf(wallet, companies, to) }, to);
};

/** The outbox's drafts, each waiting one with the footer it will carry (null: none), so the operator reads what leaves. impure. */
export const withFooters = async (wallet, drafts) => {
  const waiting = drafts.filter((d) => d.state === 'waiting');
  if (!waiting.length) return drafts;
  const [leads, companies] = await Promise.all([leadLedgerFor(wallet).then((l) => l.load()), listCompanies(wallet).catch(() => [])]);
  const footers = new Map(await Promise.all(waiting.map(async (d) => [d.id, optOutOf({ leads, companies, soldFor: await soldForOf(wallet, companies, d.to) }, d.to)?.footer ?? null])));
  return drafts.map((d) => (footers.has(d.id) ? { ...d, footer: footers.get(d.id) } : d));
};
