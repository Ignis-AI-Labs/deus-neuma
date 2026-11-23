// ONE SEARCH ACROSS THE HOUSE'S RECORDS — people, deals, invoices and companies, by any word they carry (Blob: "global
// search"). Every word asked must be somewhere in a record for it to match; the record's name counts first. A person
// is found by their name, address, tags, the house's own fields and the note on top; a deal by its buyer and next
// step; an invoice by its number, buyer and company; a company by its name and site.
// The match is pure (searchRecords); searchHouse reads.

import { leadLedgerFor, kindOf } from './lead-ledger.js';
import { readDeals } from '../revenue/deal-store.js';
import { readInvoices } from '../invoices/invoice-store.js';
import { listCompanies } from '../marketing/companies.js';

const words = (q) => String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
const text = (...parts) => parts.flat().filter((v) => v !== null && v !== undefined).map(String).join(' ').toLowerCase();

/** Each kind of record as searched: its words, and what a hit shows. pure. */
const SHAPES = Object.freeze({
  person: (l) => ({ id: l.id, name: l.name || l.contact, sub: [l.contact, kindOf(l), l.status, ...(l.tags ?? [])].filter(Boolean).join(' · '),
    hay: text(l.name, l.contact, l.tags, Object.values(l.fields ?? {}), l.about, l.source) }),
  deal: (d) => ({ id: d.id, name: d.buyer, sub: [d.stage, d.value ? `${d.value.amount} ${d.value.currency}` : null, d.nextStep].filter(Boolean).join(' · '),
    hay: text(d.id, d.buyer, d.nextStep, d.companyId, d.spin?.problem) }),
  invoice: (v) => ({ id: v.id, name: `${v.number} · ${v.buyer}`, sub: [v.status, `${v.total} ${v.currency}`, v.company].filter(Boolean).join(' · '),
    hay: text(v.id, v.number, v.buyer, v.company) }),
  company: (c) => ({ id: c.id, name: c.name, sub: [c.site?.url, c.legalEntity?.name].filter(Boolean).join(' · '),
    hay: text(c.id, c.name, c.site?.url, c.legalEntity?.name) }),
});

/**
 * The records every asked word is in, a kind at a time, names that match first. pure.
 * @param {{people?: object[], deals?: object[], invoices?: object[], companies?: object[]}} records
 * @param {string} q
 * @param {{limit?: number}} [opts] - per kind
 * @returns {{words: string[], hits: Array<{kind: string, id: string, name: string, sub: string}>, more: Record<string, number>}}
 */
export const searchRecords = ({ people = [], deals = [], invoices = [], companies = [] }, q, { limit = 20 } = {}) => {
  const asked = words(q);
  const hits = [];
  const more = {};
  if (!asked.length) return { words: asked, hits, more };
  for (const [kind, list] of [['person', people], ['deal', deals], ['invoice', invoices], ['company', companies]]) {
    const found = list.map(SHAPES[kind]).filter((r) => asked.every((w) => r.hay.includes(w)))
      .sort((a, b) => Number(!asked.every((w) => String(a.name).toLowerCase().includes(w))) - Number(!asked.every((w) => String(b.name).toLowerCase().includes(w))));
    hits.push(...found.slice(0, limit).map(({ hay, ...r }) => ({ kind, ...r })));
    if (found.length > limit) more[kind] = found.length - limit;
  }
  return { words: asked, hits, more };
};

/** searchRecords over one house's records. A store that cannot be read counts as empty, and is said. impure. */
export const searchHouse = async (wallet, q, opts) => {
  const unread = [];
  const read = (what, p) => p.catch(() => { unread.push(what); return []; });
  const [people, deals, invoices, companies] = await Promise.all([
    read('people', leadLedgerFor(wallet).then((l) => l.load())),
    read('deals', readDeals(wallet).then((r) => r.deals)),
    read('invoices', readInvoices(wallet).then((r) => r.invoices)),
    read('companies', listCompanies(wallet)),
  ]);
  return { ...searchRecords({ people, deals, invoices, companies }, q, opts), unread };
};
