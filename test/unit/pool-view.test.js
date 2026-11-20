/**
 * THE POOL, SEEN WHOLE (pool-view.js, the desk's companies sheet) — Design note, 2026-11-16: […] A
 * wide net fills the pool; the seat and the operator each see every company with what is known about
 * it — the addresses Hunter holds, its size, its site, its people — and narrow it down. Pure, over the
 * record shapes the house really keeps.
 */
import { describe, expect, it } from 'vitest';
import { poolFilter, filterPool, poolCounts, poolLine, POOL_PAGE_MAX } from '../../backend/services/sales/pool-view.js';
import { peopleByCompany } from '../../backend/services/sales/top-first.js';
import { companyRows, hunterShort, hasPeople, companiesLine } from '../../frontend/app/RelinkShell/company-line/audience-companies-view.js';

const at = (personal, generic) => ({ personal, generic, total: personal + generic });
const pool = [
  { id: 'c1', name: 'Revolut', domain: 'revolut.com', segmentId: 's1', state: 'waiting', size: '10001+', hunterEmails: at(7512, 62), trafficRank: 900, gatheredAt: '2026-11-16T10:00:00Z', source: 'hunter-discover' },
  { id: 'c2', name: 'Sui', domain: 'sui.io', segmentId: 's1', state: 'waiting', size: '51-200', hunterEmails: at(32, 3), trafficRank: 12000, gatheredAt: '2026-11-16T11:00:00Z', source: 'hunter-discover',
    siteRead: { alive: true, description: 'The layer 1 for builders', emails: [{ email: 'hello@sui.io' }] } },
  { id: 'c3', name: 'Quiet DAO', domain: 'quiet.xyz', segmentId: 's1', state: 'waiting', size: '1-10', hunterEmails: at(0, 4), gatheredAt: '2026-11-16T12:00:00Z', source: 'hunter-discover',
    siteRead: { alive: false, why: 'no answer' } },
  { id: 'c4', name: 'Monad Foundation', domain: 'monad.foundation', segmentId: 's1', state: 'scored', size: '1-10', hunterEmails: at(15, 2), source: 'hunter-discover', gatheredAt: '2026-11-16T09:00:00Z' },
  { id: 'c5', name: 'Elsewhere', domain: 'else.io', segmentId: 's2', state: 'waiting', size: '1-10', hunterEmails: at(5, 0), source: 'base-tokens', gatheredAt: '2026-11-16T09:00:00Z' },
];
const held = peopleByCompany([{ domain: 'sui.io', people: [{ name: 'Bea', role: 'CTO', email: 'bea@sui.io' }, { name: 'Ari', role: 'Co-Founder & CEO', email: 'ari@sui.io' }] }]);
const page = (raw) => filterPool(pool, poolFilter(raw), held);

describe('the seat sees the whole pool and filters it down', () => {
  it('by default: waiting companies, the most addresses at Hunter first', () => {
    const { matched, page: rows } = page({});
    expect(matched).toBe(4);
    expect(rows.map((c) => c.name)).toEqual(['Revolut', 'Sui', 'Elsewhere', 'Quiet DAO']);
  });

  it('by audience, named people, size, words, site, people pulled, source — and sorted other ways', () => {
    expect(page({ segment: 's1', minPeople: 1 }).page.map((c) => c.name)).toEqual(['Revolut', 'Sui']);
    expect(page({ sizes: ['1-10'], state: 'all' }).page.map((c) => c.name)).toEqual(['Monad Foundation', 'Elsewhere', 'Quiet DAO']);
    expect(page({ words: 'layer 1' }).page.map((c) => c.name)).toEqual(['Sui']);
    expect(page({ site: 'dead' }).page.map((c) => c.name)).toEqual(['Quiet DAO']);
    expect(page({ site: 'unread', minAddresses: 10 }).page.map((c) => c.name)).toEqual(['Revolut']);
    expect(page({ pulled: true }).page.map((c) => c.name)).toEqual(['Sui']);
    expect(page({ source: 'base-tokens' }).page.map((c) => c.name)).toEqual(['Elsewhere']);
    expect(page({ sort: 'traffic' }).page.map((c) => c.name).slice(0, 2)).toEqual(['Revolut', 'Sui']);
    expect(page({ sort: 'newest' }).page[0].name).toBe('Quiet DAO');
  });

  it('a page at a time, never more than the cap', () => {
    expect(page({ limit: 2, offset: 2 })).toMatchObject({ matched: 4, page: [{ name: 'Elsewhere' }, { name: 'Quiet DAO' }] });
    expect(poolFilter({ limit: 5000 }).limit).toBe(POOL_PAGE_MAX);
    expect(poolFilter({ sort: 'nonsense', state: 'gone', site: 'maybe' })).toMatchObject({ sort: 'addresses', state: 'waiting', site: 'any' });
  });

  it('the whole pool counted, and each company with everything known about it on one line', () => {
    expect(poolCounts(pool, held)).toEqual({ all: 5, waiting: 4, withAddresses: 5, withPeople: 4, read: 2, dead: 1, pulled: 1, kept: 0, passed: 0 });
    expect(poolLine(pool[1], held)).toBe('[c2] Sui — sui.io — 51-200 people — 35 addresses at Hunter (32 named people, 3 general) — traffic #12,000 — site ALIVE: "The layer 1 for builders", publishes hello@sui.io — 2 pulled — top: Ari, Co-Founder & CEO (ari@sui.io)');
    expect(poolLine(pool[2], held)).toBe('[c3] Quiet DAO — quiet.xyz — 1-10 people — 4 addresses at Hunter (no named person, 4 general) — NO SITE (no answer)');
    expect(poolLine(pool[3], held)).toContain('— site not read yet — SCORED');
  });
});

describe('the operator\'s sheet shows what Hunter holds at each company', () => {
  const rows = companyRows({ gathered: pool.filter((c) => c.segmentId === 's1') });

  it('the most addresses first, the count and the named people in their own column', () => {
    expect(rows.map((r) => [r.domain, hunterShort(r)])).toEqual([
      ['revolut.com', '7,574 · 7,512 NAMED'], ['sui.io', '35 · 32 NAMED'], ['monad.foundation', '17 · 15 NAMED'], ['quiet.xyz', '4 · NONE NAMED'],
    ]);
    expect(rows.filter(hasPeople).map((r) => r.domain)).toEqual(['revolut.com', 'sui.io', 'monad.foundation']);
    expect(hunterShort(companyRows({ gathered: [{ domain: 'x.io', name: 'X' }] })[0])).toBeNull();
  });

  it('the fold\'s line says how many have named people at Hunter', () => {
    expect(companiesLine(rows)).toContain('3 WITH NAMED PEOPLE AT HUNTER');
  });
});
