/**
 * WHICH PARTNER FOUND IT (backend sales/lead-provenance.js, frontend company-line/sales-sources-view.js) — Founder,
 * 2026-11-18: […] Each lead names the partner that
 * found its company and the one that gave its address; the DISCOVER stage marks every audience, company and search
 * with its partner and counts how far each partner's finds went. Pure, over board-shaped records.
 */
import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiscoverStage, FilterStage } from '../../frontend/app/RelinkShell/company-line/SalesStages.jsx';
import { SentStage } from '../../frontend/app/RelinkShell/company-line/SalesStagesOut.jsx';
import { leadProvenance, spentByPartner, partnerOf } from '../../backend/services/sales/lead-provenance.js';
import { foundByLine, foundByWords, searchesOf, sourceRows, companyPartners } from '../../frontend/app/RelinkShell/company-line/sales-sources-view.js';

const candidates = [
  { id: 'c1', segmentId: 's-ua', domain: 'ipor.io', name: 'IPOR', source: 'hunter-discover', shortlist: 'kept' },
  { id: 'c2', segmentId: 's-ua', domain: 'aero.xyz', name: 'Aero', source: 'base-protocols' },
  { id: 'c3', segmentId: 's-ua', domain: 'yo.xyz', name: 'YO', source: 'hunter-discover', shortlist: 'passed' },
  { id: 'c4', segmentId: 's-fund', domain: 'blockchaincapital.com', name: 'Blockchain Capital', source: 'company-index', shortlist: 'kept' },
];
const prospects = [
  { id: 'p1', segmentId: 's-ua', domain: 'ipor.io', name: 'IPOR', match: 3, stage: 'promoted', leadId: 'l1', people: [] },
  { id: 'p2', segmentId: 's-fund', domain: 'blockchaincapital.com', name: 'Blockchain Capital', match: 3, stage: 'promoted', leadId: 'l2', people: [] },
  { id: 'p3', segmentId: 's-ua', domain: 'venice.ai', name: 'Venice', match: 2, stage: 'promoted', leadId: 'l3', people: [{ name: 'Venice AI', role: 'Business', email: 'business@venice.ai', sourceUrl: 'https://venice.ai/contact' }] },
];
const lookups = [
  { domain: 'ipor.io', source: 'hunter', people: [{ name: 'Darren C', email: 'Darren@ipor.io' }], spent: 1 },
  { domain: 'blockchaincapital.com', source: 'tomba', people: [{ name: 'Bart Stephens', email: 'bart@blockchaincapital.com' }], spent: 1 },
  { domain: 'blockchaincapital.com', source: 'apollo', people: [], spent: 5 },
  { domain: 'playsout.com', source: 'hunter-verify', people: [], spent: 0.5 },
];
const leads = [
  { id: 'l1', contact: 'darren@ipor.io', status: 'replied', origin: { campaignId: 'k-ua' } },
  { id: 'l2', contact: 'bart@blockchaincapital.com', status: 'contacted', origin: { campaignId: 'k-fund' } },
  { id: 'l3', contact: 'business@venice.ai', status: 'won', origin: { campaignId: 'k-ua' } },
  { id: 'l4', contact: 'andreas@slas.gr', status: 'replied', source: 'imported from explee · Deus Neuma · Video producers', origin: null },
];

describe('each lead names who found its company and who gave its address', () => {
  test('the partner behind every source id the pipeline records; an unknown one is said as unknown', () => {
    expect(['hunter-discover', 'hunter', 'hunter-verify', 'tomba', 'apollo', 'company-index', 'base-protocols', 'base-tokens', 'nope'].map(partnerOf))
      .toEqual(['Hunter', 'Hunter', 'Hunter', 'Tomba', 'Apollo', 'Company index', 'DefiLlama', 'GeckoTerminal', null]);
  });

  test('company through its prospect and the company gathered under the same audience; address through the lookup that returned it, else the company\'s own pages; an import names its tool', () => {
    const found = leadProvenance({ leads, prospects, candidates, lookups });
    expect(Object.fromEntries(found)).toEqual({
      l1: { company: 'Hunter', address: 'Hunter' },
      l2: { company: 'Company index', address: 'Tomba' },
      l3: { company: 'Web search', address: 'Company site' },
      l4: { company: 'Explee', address: 'Explee' },
    });
    expect(leadProvenance()).toEqual(new Map());
  });

  test('credits per partner, from the lookups on record', () => {
    expect(spentByPartner(lookups)).toEqual({ Hunter: 1.5, Tomba: 1, Apollo: 5 });
  });
});

describe('DISCOVER marks every audience, company and search with its partner, and counts each partner\'s funnel', () => {
  const found = leadProvenance({ leads, prospects, candidates, lookups });
  const engine = {
    campaigns: [{ id: 'k-ua', name: 'Umbrae UA', state: 'open' }, { id: 'k-fund', name: 'Umbrae Funding', state: 'open' }],
    segments: [{ id: 's-fund', name: 'Funds', state: 'approved', campaign: 'k-fund' }, { id: 's-ua', name: 'Token teams', state: 'approved', campaign: 'k-ua' }],
    candidates, prospects,
    leads: leads.map((l) => ({ ...l, foundBy: found.get(l.id) })),
    searches: [
      { segmentId: 's-ua', source: 'hunter-discover', asked: 'token projects on Base', matched: 4, gathered: 2, at: '2026-11-17T10:00:00Z' },
      { segmentId: 's-ua', source: 'base-protocols', asked: '', gathered: 1, at: '2026-11-18T10:00:00Z' },
    ],
    spentBy: spentByPartner(lookups),
  };

  test('an audience says who found its companies, most first; its searches say where each ran, newest first', () => {
    expect(foundByLine(candidates.filter((c) => c.segmentId === 's-ua'))).toBe('Hunter 2 · DefiLlama 1');
    expect(foundByLine([])).toBe('');
    expect(searchesOf(engine, 's-ua').map((s) => [s.at.slice(0, 10), s.partner])).toEqual([['2026-11-18', 'DefiLlama'], ['2026-11-17', 'Hunter']]);
    expect(companyPartners(engine)('s-fund', 'BlockchainCapital.com')).toBe('Company index');
    expect(companyPartners(engine)('s-ua', 'venice.ai')).toBe('Web search');
  });

  test('a lead says both in one line; the same tool for both is said once', () => {
    expect(engine.leads.map(foundByWords)).toEqual(['Hunter', 'company Company index · address Tomba', 'company Web search · address Company site', 'Explee']);
    expect(foundByWords({})).toBe('—');
  });

  test('every partner\'s finds and how far they went: the one that reached furthest first; credits only while every campaign is in view', () => {
    const rows = sourceRows(engine, 'all').map((r) => [r.partner, r.gave, r.found, r.shortlisted, r.fit, r.leads, r.written, r.replied, r.won, r.credits]);
    expect(rows).toEqual([
      ['Web search', 'COMPANIES', 0, 0, 1, 1, 1, 1, 1, null],
      ['Company site', 'ADDRESSES', null, null, null, 1, 1, 1, 1, null],
      ['Hunter', 'COMPANIES', 2, 1, 1, 1, 1, 1, 0, null],
      ['Hunter', 'ADDRESSES', null, null, null, 1, 1, 1, 0, 1.5],
      ['Explee', 'COMPANIES', 0, 0, 0, 1, 1, 1, 0, null],
      ['Explee', 'ADDRESSES', null, null, null, 1, 1, 1, 0, null],
      ['Company index', 'COMPANIES', 1, 1, 1, 1, 1, 0, 0, null],
      ['Tomba', 'ADDRESSES', null, null, null, 1, 1, 0, 0, 1],
      ['DefiLlama', 'COMPANIES', 1, 0, 0, 0, 0, 0, 0, null],
      ['Apollo', 'ADDRESSES', null, null, null, 0, 0, 0, 0, 5],
    ]);
    // One campaign in view: its own audiences and leads, and no credits (they are the house's).
    expect(sourceRows(engine, 'k-fund').map((r) => [r.partner, r.gave, r.leads, r.credits])).toEqual([['Company index', 'COMPANIES', 1, null], ['Tomba', 'ADDRESSES', 1, null]]);
  });

  test('on the screen: DISCOVER says who found each audience\'s companies and holds the partner sheet; FILTER and SENT mark each row', () => {
    const discover = renderToStaticMarkup(createElement(DiscoverStage, { engine, view: 'all', busy: false, onMove: () => {} }));
    expect(discover).toContain('FOUND BY');
    expect(discover).toContain('Hunter 2 · DefiLlama 1');
    expect(discover).toContain('WHO FOUND THEM');
    expect(discover).toContain('data-partner="Tomba"');
    const filter = renderToStaticMarkup(createElement(FilterStage, { engine, view: 'all' }));
    expect(filter).toContain('<td>DefiLlama</td>');
    const sent = renderToStaticMarkup(createElement(SentStage, { engine, view: 'all' }));
    expect(sent).toContain('company Company index · address Tomba');
  });
});
