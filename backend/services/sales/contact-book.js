// THE CONTACT BOOK — every person the house knows, in one record each (Founder,
// 2026-11-16: […]).
//
// The book is not a second store that could drift: it is READ from what the
// house already keeps, every time it is asked for (SHINKEI — each count is the
// length of the list it names):
//   - the people a seat read on a company's own pages     (prospects.people)
//   - the people a contact-data provider returned         (contact lookups)
//   - everyone on the lead list                            (the lead ledger)
//   - addresses that bounced                               (do-not-contact, reason bounced)
// One person is one record: by address when one is known, else by name at
// their company. A record grows stronger as evidence arrives, and HOW SURE
// the address is, is said plainly:
//   none       no address known yet
//   published  read on a public page (the page is kept)
//   verified   a provider holds it as verified
//   confirmed  they wrote to the house from it — the strongest proof there is
//   bounced    a message to it failed: never written to again
// The fold is PURE; contactBook reads.

import { normalizeEmail } from './suppress-shape.js';
import { readProspects, readSegments, readSuppressions, readContactPeople, readCandidates } from './sales-store.js';
import { leadLedgerFor, kindOf, sourceOf } from '../leads/lead-ledger.js';

export const EMAIL_STATES = Object.freeze(['none', 'published', 'verified', 'confirmed', 'bounced']);
const RANK = Object.freeze({ none: 0, published: 1, verified: 2, confirmed: 3, bounced: 4 });
const text = (v, max = 160) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const isAddress = (v) => /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(String(v ?? ''));
const domainOf = (email) => String(email ?? '').split('@')[1] ?? '';
// A lead the lead engine made is named […].
const LEAD_NAME = /^(.+?), (.+?) at (.+)$/;

// pure — one sighting of a person, in the book's shape.
const sighting = (s) => ({
  name: text(s.name, 120), title: text(s.title, 120), company: text(s.company, 120), domain: text(s.domain, 120).toLowerCase(),
  email: isAddress(s.email) ? normalizeEmail(s.email) : null, reach: s.reach ?? null, state: s.state ?? 'none',
  source: s.source ?? null, at: s.at ?? null, confirmedAt: s.confirmedAt ?? null,
  lead: s.lead ?? null, forCompany: s.forCompany ?? null,
});

// pure — two sightings of one person, merged: every field kept, the stronger proof wins, the lead stays attached.
const merge = (a, b) => ({
  ...a,
  name: a.name.length >= b.name.length ? a.name : b.name,
  title: a.title || b.title, company: a.company || b.company, domain: a.domain || b.domain, email: a.email || b.email, reach: a.reach || b.reach,
  state: RANK[b.state] > RANK[a.state] ? b.state : a.state,
  source: RANK[b.state] > RANK[a.state] && b.source ? b.source : (a.source ?? b.source),
  sources: [...new Set([...(a.sources ?? []), ...(b.sources ?? [])])],
  at: [a.at, b.at].filter(Boolean).sort()[0] ?? null,
  confirmedAt: a.confirmedAt ?? b.confirmedAt, lead: a.lead ?? b.lead, forCompany: a.forCompany ?? b.forCompany,
});

const keyOf = (c) => (c.email ? `e:${c.email}` : `n:${c.name.toLowerCase()}|${c.domain || c.company.toLowerCase()}`);

/**
 * pure — the book, from the house's own records.
 * @param {{leads: object[], prospects: object[], lookups: object[], suppressions: object[], segments: object[], candidates?: object[]}} read
 * @returns {object[]} one record per person, strongest proof first within each company
 */
export const foldContacts = ({ leads = [], prospects = [], lookups = [], suppressions = [], segments = [], candidates = [] }) => {
  const companyName = new Map([...candidates.map((c) => [c.domain, c.name]), ...prospects.map((p) => [p.domain, p.name])]);
  const houseCompany = (segmentId) => segments.find((s) => s.id === segmentId)?.company ?? null;
  const seen = [];
  for (const p of prospects) {
    for (const person of p.people ?? []) {
      seen.push(sighting({ name: person.name, title: person.role, company: p.name, domain: p.domain, email: person.email, state: person.email ? 'published' : 'none', source: person.sourceUrl, at: p.foundAt, forCompany: houseCompany(p.segmentId) }));
    }
  }
  for (const look of lookups) {
    for (const person of look.people ?? []) {
      seen.push(sighting({ name: person.name, title: person.role, company: companyName.get(look.domain) ?? look.domain, domain: look.domain, email: person.email, state: person.basis === 'verified' ? 'verified' : 'published', source: person.sourceUrl ?? look.source, at: look.at }));
    }
  }
  for (const lead of leads) {
    const named = LEAD_NAME.exec(lead.name ?? '');
    const email = isAddress(lead.contact) ? lead.contact : null;
    const wrote = (lead.touches ?? []).find((t) => t.direction === 'in');
    seen.push(sighting({
      name: named ? named[1] : lead.name, title: named ? named[2] : '', company: named ? named[3] : '', domain: email ? domainOf(normalizeEmail(email)) : '',
      email, reach: email ? null : text(lead.contact, 200) || null,
      state: wrote && email ? 'confirmed' : email ? 'published' : 'none', confirmedAt: wrote && email ? wrote.at : null,
      source: lead.source || null, at: lead.createdAt,
      lead: { id: lead.id, kind: kindOf(lead), status: lead.status, channel: sourceOf(lead) },
    }));
  }
  const by = new Map();
  for (const s of seen) {
    if (!s.name && !s.email) continue;
    const key = keyOf(s);
    const one = { ...s, sources: s.source ? [s.source] : [] };
    by.set(key, by.has(key) ? merge(by.get(key), one) : one);
  }
  // A person first seen by name alone, later given an address, is one person: fold the name-only record in.
  for (const [key, c] of [...by]) {
    if (!c.email) continue;
    const twin = `n:${c.name.toLowerCase()}|${c.domain || c.company.toLowerCase()}`;
    if (by.has(twin)) { by.set(key, merge(c, by.get(twin))); by.delete(twin); }
  }
  const bounced = new Set(suppressions.filter((s) => s.reason === 'bounced' && s.kind === 'email').map((s) => s.value));
  return [...by.values()]
    .map((c) => ({ ...c, state: c.email && bounced.has(c.email) ? 'bounced' : c.state, company: c.company || companyName.get(c.domain) || '' }))
    // By company (people with no company known stand last), the strongest proof first within each.
    .sort((a, b) => Number(!a.company) - Number(!b.company) || a.company.localeCompare(b.company) || RANK[b.state] - RANK[a.state] || a.name.localeCompare(b.name));
};

/** pure — the book counted: people, companies, and how sure each address is. */
export const contactStats = (contacts) => ({
  people: contacts.length,
  companies: new Set(contacts.map((c) => c.company || c.domain).filter(Boolean)).size,
  ...Object.fromEntries(EMAIL_STATES.map((s) => [s, contacts.filter((c) => c.state === s).length])),
});

/** pure — the book in one line, as the sales seat reads it. */
export const contactLine = (contacts) => {
  const n = contactStats(contacts);
  return n.people ? `The contact book: ${n.people} ${n.people === 1 ? 'person' : 'people'} at ${n.companies} compan${n.companies === 1 ? 'y' : 'ies'} — ${n.confirmed} confirmed (they wrote from the address), ${n.verified} verified by a provider, ${n.published} read on a page, ${n.none} with no address yet, ${n.bounced} bounced. Every person you read goes in with name, role, company and the page; give their address with the page it stands on whenever one is published.`
    : 'The contact book is empty. Every person you read on a company\'s pages goes in with name, role and the page (people, in sales/prospect).';
};

/** impure — one house's contact book. */
export const contactBook = async (wallet) => {
  const [leads, prospects, lookups, suppressions, segments, candidates] = await Promise.all([
    leadLedgerFor(wallet).then((l) => l.load()), readProspects(wallet), readContactPeople(wallet), readSuppressions(wallet), readSegments(wallet), readCandidates(wallet),
  ]);
  return foldContacts({ leads, prospects, lookups, suppressions, segments, candidates });
};
