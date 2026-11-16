// contact-book-view.js — how the contact book reads: people under their company, and how sure each address is. Pure.

/** How sure an address is, in the operator's words, weakest to strongest (bounced apart). */
export const STATE_WORDS = Object.freeze({
  none: ['NO ADDRESS YET', null],
  published: ['READ ON A PAGE', null],
  verified: ['VERIFIED BY A PROVIDER', null],
  confirmed: ['CONFIRMED — THEY WROTE FROM IT', 'on'],
  bounced: ['BOUNCED — NEVER WRITTEN TO AGAIN', 'alert'],
});

/** The book's line: people, companies, then how many addresses stand at each strength. */
export const bookLine = (stats) => (stats?.people ? [
  `${stats.people} PEOPLE`, `${stats.companies} COMPAN${stats.companies === 1 ? 'Y' : 'IES'}`,
  ...(stats.confirmed ? [{ text: `${stats.confirmed} CONFIRMED`, tone: 'on' }] : []),
  ...(stats.verified ? [`${stats.verified} VERIFIED`] : []),
  ...(stats.published ? [`${stats.published} READ ON A PAGE`] : []),
  ...(stats.none ? [`${stats.none} NO ADDRESS`] : []),
  ...(stats.bounced ? [{ text: `${stats.bounced} BOUNCED`, tone: 'alert' }] : []),
] : ['NOBODY YET']);

const hit = (c, q) => [c.name, c.title, c.company, c.domain, c.email, c.reach].some((v) => String(v ?? '').toLowerCase().includes(q));

/** The people, under the company each belongs to: companies with a confirmed address first, then the largest. */
export const contactGroups = (contacts = [], query = '') => {
  const q = String(query).trim().toLowerCase();
  const by = new Map();
  for (const c of q ? contacts.filter((x) => hit(x, q)) : contacts) {
    const key = c.company || c.domain || '';
    const g = by.get(key) ?? by.set(key, { key, company: c.company || c.domain || 'NO COMPANY KNOWN', domain: c.domain || '', people: [] }).get(key);
    g.people.push(c);
  }
  return [...by.values()].map((g) => ({ ...g, confirmed: g.people.filter((p) => p.state === 'confirmed').length, reachable: g.people.filter((p) => p.email && p.state !== 'bounced').length }))
    .sort((a, b) => b.confirmed - a.confirmed || b.people.length - a.people.length || a.company.localeCompare(b.company));
};

/** One company's line. */
export const companyLine = (g) => [`${g.people.length} ${g.people.length === 1 ? 'PERSON' : 'PEOPLE'}`, `${g.reachable} WITH AN ADDRESS`, ...(g.confirmed ? [{ text: `${g.confirmed} CONFIRMED`, tone: 'on' }] : [])];

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** The whole book as a spreadsheet file's text (one person a row). */
export const contactsCsv = (contacts = []) => [
  ['name', 'title', 'company', 'domain', 'email', 'address is', 'other way to reach', 'filed as', 'lead status', 'came from', 'first seen', 'source'].map(cell).join(','),
  ...contacts.map((c) => [c.name, c.title, c.company, c.domain, c.email, c.state, c.reach, c.lead?.kind, c.lead?.status, c.lead?.channel, c.at, c.source].map(cell).join(',')),
].join('\r\n');
