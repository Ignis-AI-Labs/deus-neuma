/**
 * THE CONTACT BOOK (RULE 0, nothing faked): the real fold over records in the shapes the house really keeps
 * (a scored company's people, a provider's lookup, the lead list, the do-not-contact list), and the screen's
 * own reading of it. One person is one record; how sure the address is, is said; proof makes a record stronger.
 */
import { describe, test, expect } from 'vitest';
import { foldContacts, contactStats, contactLine, EMAIL_STATES } from '../../backend/services/sales/contact-book.js';
import { makeProspect } from '../../backend/services/sales/prospect-shape.js';
import { peopleRows, narrow, contactsCsv, STATE_WORDS } from '../../frontend/app/RelinkShell/company-line/people-view.js';

const NOW = '2026-11-16T09:00:00.000Z';
const segments = [{ id: 's-1', company: 'ignis' }];
const prospects = [
  { id: 'p-1', segmentId: 's-1', name: 'Acme Protocol', domain: 'acme.example', foundAt: NOW, people: [{ name: 'Ada Lovelace', role: 'CTO', sourceUrl: 'https://acme.example/team' }, { name: 'Bo Chen', role: 'Head of Security', sourceUrl: 'https://acme.example/team', email: 'bo@acme.example' }] },
  { id: 'p-2', segmentId: 's-1', name: 'Zeta Labs', domain: 'zeta.example', foundAt: NOW, people: [] },
];
const lookups = [{ domain: 'acme.example', source: 'hunter', at: NOW, people: [
  { name: 'Ada Lovelace', role: 'Chief Technology Officer', email: 'Ada@Acme.example', sourceUrl: 'https://acme.example/contact', basis: 'published' },
  { name: 'Cy Park', role: 'Founder', email: 'cy@acme.example', sourceUrl: 'https://www.linkedin.com/in/cy', basis: 'verified' },
] }];
const lead = (extra) => ({ id: 'l-1', name: 'Bo Chen, Head of Security at Acme Protocol', contact: 'bo@acme.example', kind: 'buyer', status: 'contacted', channelId: 'email', source: 'lead engine [s-1] Crypto teams · address: https://acme.example/team', createdAt: NOW, touches: [{ at: NOW, status: 'cold' }], ...extra });
const read = (extra = {}) => foldContacts({ leads: [lead()], prospects, lookups, suppressions: [], segments, candidates: [], ...extra });

describe('the contact book', () => {
  test('one person is one record: seen on a page, returned by a provider and on the lead list, they are still one', () => {
    const book = read();
    expect(book.map((c) => [c.name, c.title, c.company, c.email, c.state])).toEqual([
      ['Cy Park', 'Founder', 'Acme Protocol', 'cy@acme.example', 'verified'],
      ['Ada Lovelace', 'Chief Technology Officer', 'Acme Protocol', 'ada@acme.example', 'published'],
      ['Bo Chen', 'Head of Security', 'Acme Protocol', 'bo@acme.example', 'published'],
    ]);
    const bo = book.find((c) => c.name === 'Bo Chen');
    expect(bo).toMatchObject({ domain: 'acme.example', forCompany: 'ignis', lead: { id: 'l-1', kind: 'buyer', status: 'contacted', channel: 'email' } });
    // Ada was first read by name alone; the provider's address joined the same record, and both pages are kept.
    expect(book.find((c) => c.name === 'Ada Lovelace').sources).toEqual(['https://acme.example/contact', 'https://acme.example/team']);
    expect(contactStats(book)).toEqual({ people: 3, companies: 1, none: 0, published: 2, verified: 1, confirmed: 0, bounced: 0 });
  });

  test('proof makes a record stronger: a reply confirms the address; a bounce ends it', () => {
    const replied = read({ leads: [lead({ status: 'replied', touches: [{ at: NOW, status: 'cold' }, { at: '2026-11-17T10:00:00.000Z', direction: 'in', status: 'replied' }] })] });
    expect(replied.find((c) => c.name === 'Bo Chen')).toMatchObject({ state: 'confirmed', confirmedAt: '2026-11-17T10:00:00.000Z' });
    expect(replied[0].name).toBe('Bo Chen'); // the strongest proof stands first in its company
    const bounced = read({ suppressions: [{ kind: 'email', value: 'cy@acme.example', reason: 'bounced' }, { kind: 'email', value: 'ada@acme.example', reason: 'asked' }] });
    expect(bounced.map((c) => [c.name, c.state])).toEqual([['Cy Park', 'bounced'], ['Ada Lovelace', 'published'], ['Bo Chen', 'published']]);
    expect(EMAIL_STATES).toEqual(['none', 'published', 'verified', 'confirmed', 'bounced']);
  });

  test('a person with no address, and a lead reached another way, are still in the book', () => {
    const book = foldContacts({
      leads: [{ id: 'l-9', name: 'Lynx Arcade', contact: 'x.com/Lynx_Protocol', kind: 'partner', status: 'contacted', channelId: 'x', source: '', createdAt: NOW, touches: [] },
        { id: 'l-8', name: 'Ana Ruiz', contact: 'ana@studio.example', kind: 'applicant', status: 'replied', channelId: 'email', source: 'mailbox: they wrote first · uid 9 "Applying"', createdAt: NOW, touches: [{ at: NOW, direction: 'in', status: 'replied' }] }],
      prospects: [{ ...prospects[0], people: [prospects[0].people[0]] }], lookups: [], suppressions: [], segments, candidates: [],
    });
    expect(book.map((c) => [c.name, c.email, c.reach, c.state, c.lead?.kind ?? null])).toEqual([
      ['Ada Lovelace', null, null, 'none', null],
      ['Ana Ruiz', 'ana@studio.example', null, 'confirmed', 'applicant'],
      ['Lynx Arcade', null, 'x.com/Lynx_Protocol', 'none', 'partner'],
    ]);
    expect(contactLine(book)).toBe('The contact book: 3 people at 2 companies — 1 confirmed (they wrote from the address), 0 verified by a provider, 0 read on a page, 2 with no address yet, 0 bounced. Every person you read goes in with name, role, company and the page; give their address with the page it stands on whenever one is published.');
    expect(contactLine([])).toMatch(/^The contact book is empty\./);
  });

  test('a seat files a person\'s published address with them, and only a real address is kept', () => {
    const filed = makeProspect({ segment: { id: 's-1', positiveCriteria: ['Fits'], negativeCriteria: [] }, domain: 'acme.example', name: 'Acme', country: 'US', source: 'https://acme.example', scores: [{ criterion: 'Fits', score: 5, reasoning: 'their site says so' }],
      people: [{ name: 'Bo Chen', role: 'Head of Security', sourceUrl: 'https://acme.example/team', email: ' Bo@Acme.example ' }, { name: 'Ada Lovelace', role: 'CTO', sourceUrl: 'https://acme.example/team', email: 'not an address' }], by: 'merc', now: NOW });
    expect(filed.people).toEqual([{ name: 'Bo Chen', role: 'Head of Security', sourceUrl: 'https://acme.example/team', email: 'bo@acme.example' }, { name: 'Ada Lovelace', role: 'CTO', sourceUrl: 'https://acme.example/team' }]);
  });

  test('the screen reads every person once, narrows on a search, and writes the book out as a spreadsheet', () => {
    const book = [...read({ leads: [lead({ touches: [{ at: NOW, direction: 'in' }] })] }), { name: 'Dee Roe', title: 'CEO', company: 'Zeta Labs', domain: 'zeta.example', email: null, reach: null, state: 'none', source: 'https://zeta.example/about', at: NOW, lead: null }];
    expect(contactStats(book)).toMatchObject({ people: 4, companies: 2, confirmed: 1, verified: 1, published: 1, none: 1 });
    const rows = peopleRows({ contacts: book, leads: [] });
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.lead).length).toBe(1);
    expect(narrow(rows, { query: 'security' }).map((r) => r.name)).toEqual(['Bo Chen']);
    expect(narrow(rows, { query: 'zeta.example' }).map((r) => r.company)).toEqual(['Zeta Labs']);
    expect(narrow(rows, { query: 'nobody at all' })).toEqual([]);
    const csv = contactsCsv(book).split('\r\n');
    expect(csv[0]).toBe('"name","title","company","domain","email","address is","other way to reach","filed as","lead status","came from","first seen","source"');
    expect(csv).toHaveLength(5);
    expect(csv.find((l) => l.startsWith('"Bo Chen"'))).toContain('"bo@acme.example","confirmed","","buyer","contacted","email"');
    expect(Object.keys(STATE_WORDS)).toEqual(EMAIL_STATES);
  });
});
