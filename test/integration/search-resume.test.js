/**
 * A PAID SEARCH CONTINUES WHERE IT STOPPED (sales/company-search.js gatherApolloCompanies, sales/search-memory.js) —
 * on the wire: a real HTTP server stands in for the provider's company search (the NEUMA_LEAD_SOURCE_APOLLO door) and
 * keeps every request it was sent. Asked from page 6, pages 6 and 7 are asked for and nothing before them; what comes
 * back says which pages it took, so the next search continues after them.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import process from 'node:process';
import { gatherApolloCompanies } from '../../backend/services/sales/company-search.js';
import { searchPast, searchVerdict } from '../../backend/services/sales/search-memory.js';

describe('a paid company search continues from the page after the last one taken', () => {
  let server; const asked = []; const prior = process.env.NEUMA_LEAD_SOURCE_APOLLO;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const page = Number(new URL(req.url, 'http://x').searchParams.get('page'));
      asked.push({ page, key: req.headers['x-api-key'] });
      res.setHeader('content-type', 'application/json');
      // 795 companies in all: eight pages, the last one short.
      const n = page < 8 ? 100 : 95;
      res.end(JSON.stringify({ pagination: { total_entries: 795, total_pages: 8 }, organizations: Array.from({ length: n }, (_, i) => ({ name: `Fund ${page}-${i}`, website_url: `https://fund-${page}-${i}.example`, primary_domain: `fund-${page}-${i}.example` })) }));
    });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    process.env.NEUMA_LEAD_SOURCE_APOLLO = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    if (prior === undefined) delete process.env.NEUMA_LEAD_SOURCE_APOLLO; else process.env.NEUMA_LEAD_SOURCE_APOLLO = prior;
    await new Promise((resolve) => { server.close(resolve); });
  });

  test('from page 6 it asks for 6 and 7 only; the last pages end it; its record lets the next search refuse a repeat', async () => {
    const query = { keywords: ['crypto fund', 'web3 fund'] };
    const got = await gatherApolloCompanies({ count: 200, query, apiKey: 'the-operators-key', startPage: 6 });
    expect(asked.map((a) => a.page)).toEqual([6, 7]);
    expect(asked.every((a) => a.key === 'the-operators-key')).toBe(true);
    expect(got).toMatchObject({ spent: 2, matched: 795, pages: 2, fromPage: 6, asked: 'crypto fund, web3 fund' });
    expect(got.candidates).toHaveLength(200);
    expect(got.candidates[0].domain).toBe('fund-6-0.example');
    // Asked for more than is left, it stops at the last page and pays for no page that does not exist.
    asked.length = 0;
    const rest = await gatherApolloCompanies({ count: 500, query, apiKey: 'the-operators-key', startPage: 8 });
    expect(asked.map((a) => a.page)).toEqual([8]);
    expect(rest).toMatchObject({ spent: 1, pages: 1, fromPage: 8 });
    expect(rest.candidates).toHaveLength(95);
    // The record of those three searches: every page taken, so the same search is refused before a credit is spent.
    const record = [{ spent: 5 }, { spent: 2, pages: 2, fromPage: 6 }, { spent: 1, pages: 1, fromPage: 8 }].map((r, i) => ({ segmentId: 's-1', source: 'apollo-discover', asked: 'web3 fund, crypto fund', matched: 795, gathered: 100, at: `2026-11-2${i}T10:00:00.000Z`, ...r }));
    expect(searchVerdict(searchPast(record, { segmentId: 's-1', source: 'apollo-discover', asked: got.asked }), { perPage: 100, resumes: true }).refusal).toMatch(/^every page of this search has been taken \(8 of 8;/);
  });
});
