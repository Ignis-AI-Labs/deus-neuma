// sales-sources-view — WHICH PARTNER HELPED MOST (Design note, 2026-11-18: […]). Every company names the partner that found it, every lead the partner that found its
// company and the one that gave its address (backend sales/lead-provenance.js); this marks them on the rows and counts
// how far each partner's finds went down the line, over the campaign in view. Pure.

import { partnerOf, WEB } from '../../../../backend/services/sales/lead-provenance.js';
import { rowsIn, leadsIn, ALL } from './sales-pipeline-view.js';

const WRITTEN = new Set(['contacted', 'replied', 'qualified', 'won', 'lost']);
const REPLIED = new Set(['replied', 'qualified', 'won']);
const n = (v) => Number(v || 0).toLocaleString('en-US');
const low = (v) => String(v ?? '').trim().toLowerCase();

/** pure — the partner that found a gathered company. */
export const partnerOfCompany = (candidate) => partnerOf(candidate?.source) ?? candidate?.source ?? WEB;

/** pure — (segmentId, domain) → the partner that found that company; one the seat found reading the web is WEB. */
export const companyPartners = (engine) => {
  const at = new Map();
  for (const c of engine?.candidates ?? []) {
    if (!c?.domain) continue;
    at.set(`${c.segmentId}|${low(c.domain)}`, partnerOfCompany(c));
    if (!at.has(low(c.domain))) at.set(low(c.domain), partnerOfCompany(c));
  }
  return (segmentId, domain) => at.get(`${segmentId}|${low(domain)}`) ?? at.get(low(domain)) ?? WEB;
};

/** pure — […]: who found an audience's companies, most first. */
export const foundByLine = (gathered) => {
  const count = new Map();
  for (const c of gathered ?? []) count.set(partnerOfCompany(c), (count.get(partnerOfCompany(c)) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([who, k]) => `${who} ${n(k)}`).join(' · ');
};

/** pure — an audience's searches, newest first, each with the partner it was run at. */
export const searchesOf = (engine, segmentId) => (engine?.searches ?? [])
  .filter((s) => s.segmentId === segmentId)
  .map((s) => ({ ...s, partner: partnerOf(s.source) ?? s.source }))
  .sort((a, b) => String(b.at).localeCompare(String(a.at)));

/** pure — […]: who found a lead's company and who gave its address. */
export const foundByWords = (lead) => {
  const { company, address } = lead?.foundBy ?? {};
  if (!company && !address) return '—';
  if (company === address) return company;
  return [company ? `company ${company}` : null, address ? `address ${address}` : null].filter(Boolean).join(' · ');
};

/**
 * pure — THE FUNNEL BY PARTNER over the campaign in view: for each partner, what it gave (COMPANIES or ADDRESSES) and
 * how far those went — found, shortlisted, scored a fit, on the lead list, written to, replied, won — and, over every
 * campaign, the credits its lookups spent. The partner whose finds reached the furthest stands first.
 */
export const sourceRows = (engine, view = ALL) => {
  const tally = new Map();
  const row = (partner, gave) => {
    const id = `${partner}|${gave}`;
    if (!tally.has(id)) tally.set(id, { id, partner, gave, found: gave === 'COMPANIES' ? 0 : null, shortlisted: gave === 'COMPANIES' ? 0 : null, fit: gave === 'COMPANIES' ? 0 : null, leads: 0, written: 0, replied: 0, won: 0, credits: null });
    return tally.get(id);
  };
  const partnerAt = companyPartners(engine);
  for (const r of rowsIn(engine, view)) {
    for (const c of r.gathered) {
      const t = row(partnerOfCompany(c), 'COMPANIES');
      t.found += 1;
      if (c.shortlist === 'kept') t.shortlisted += 1;
    }
    for (const p of [...r.pool, ...r.leads]) if (p.match >= 2) row(partnerAt(p.segmentId, p.domain), 'COMPANIES').fit += 1;
  }
  for (const l of leadsIn(engine, view)) {
    for (const [who, gave] of [[l.foundBy?.company, 'COMPANIES'], [l.foundBy?.address, 'ADDRESSES']]) {
      if (!who) continue;
      const t = row(who, gave);
      t.leads += 1;
      if (WRITTEN.has(l.status)) t.written += 1;
      if (REPLIED.has(l.status)) t.replied += 1;
      if (l.status === 'won') t.won += 1;
    }
  }
  // Credits are the house's, not a campaign's: said only while every campaign is in view.
  if (view === ALL) for (const [who, spent] of Object.entries(engine?.spentBy ?? {})) row(who, 'ADDRESSES').credits = spent;
  return [...tally.values()].sort((a, b) => b.won - a.won || b.replied - a.replied || b.written - a.written || b.leads - a.leads || (b.found ?? 0) - (a.found ?? 0));
};
