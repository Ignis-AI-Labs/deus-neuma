/**
 * THE HOUSE'S OWN COMPANY INDEX — Design note, 2026-11-16: […]
 *
 * Rule 0: a real SQLite file on tmp disk, loaded by the real loader from real files in the two
 * shapes the house loads (the free company dataset's own columns, a rank,domain traffic list), and
 * searched by the real query. The rows are real companies' public facts.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { csvCells, csvOpen, isoOf, domainOf, companyRow, wordsQuery, searchSql, trafficWords, candidateOfCompany, loadCompanies, loadTraffic, searchIndex, indexStats, industriesOf, closeIndex, INDEX_ATTRIBUTION } from '../../backend/services/sales/company-index.js';
import { gatherCompanyIndex, LEAD_SOURCES, INDEX_EMPTY, candidateLine } from '../../backend/services/sales/lead-sources.js';

const COMPANIES = `country,founded,id,industry,linkedin_url,locality,name,region,size,website
united states,2015,tnHcNHbCv8MKeLh92946LAkX6PKg,computer software,linkedin.com/company/peopledatalabs,san francisco,people data labs,california,11-50,peopledatalabs.com
united states,2012,a1,financial services,linkedin.com/company/coinbase,san francisco,coinbase,california,1001-5000,coinbase.com
united kingdom,2011,a2,financial services,linkedin.com/company/wise,london,wise,england,5001-10000,wise.com
germany,2013,a3,financial services,linkedin.com/company/n26,berlin,n26,berlin,1001-5000,n26.com
united states,2020,a4,computer software,linkedin.com/company/quiet-harbor,"portland, maine","quiet harbor software, inc.",maine,1-10,quietharbor.example
united states,,a5,restaurants,linkedin.com/company/no-site,austin,a diner with no site,texas,1-10,
united states,2019,a6,computer software,,denver,"a name that
runs onto a second line",colorado,11-50,twolines.example
`;
const TRAFFIC = '1,google.com\n188,coinbase.com\n901,wise.com\n4400,n26.com\n323181,peopledatalabs.com\nnot a line\n';

let dir; const PRIOR = process.env.NEUMA_COMPANY_INDEX;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-company-index-'));
  process.env.NEUMA_COMPANY_INDEX = path.join(dir, 'companies.sqlite');
  await fs.writeFile(path.join(dir, 'companies.csv'), COMPANIES);
  await fs.writeFile(path.join(dir, 'top.csv'), TRAFFIC);
});
afterAll(async () => {
  closeIndex();
  if (PRIOR === undefined) delete process.env.NEUMA_COMPANY_INDEX; else process.env.NEUMA_COMPANY_INDEX = PRIOR;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('reading the files (pure)', () => {
  test('a line splits into its cells, quotes and all; a record that runs on is known', () => {
    expect(csvCells('a,"b, c","d ""e""",')).toEqual(['a', 'b, c', 'd "e"', '']);
    expect(csvCells('a|b,c|d', '|')).toEqual(['a', 'b,c', 'd']);
    expect([csvOpen('x,"open'), csvOpen('x,"closed"')]).toEqual([true, false]);
  });
  test('a country is its code, a website is its domain, and a company with no site is no row', () => {
    expect(['united states', 'United Kingdom', 'south korea', 'germany', 'gb', 'atlantis'].map(isoOf)).toEqual(['US', 'GB', 'KR', 'DE', 'GB', '']);
    expect(['https://www.Acme.example/about', 'acme.example', 'not a site', '', 'localhost'].map(domainOf)).toEqual(['acme.example', 'acme.example', null, null, null]);
    expect(companyRow({ name: 'no site', website: '' })).toBe(null);
    expect(companyRow({ name: ' Acme  Labs ', website: 'www.acme.example', size: '11-50', founded: '2015', country: 'united states', industry: 'Computer Software', linkedin_url: 'linkedin.com/company/acme', size2: 'x' }))
      .toMatchObject({ domain: 'acme.example', name: 'Acme Labs', size: '11-50', founded: 2015, iso: 'US', industry: 'computer software' });
    expect(companyRow({ name: 'odd', website: 'odd.example', size: 'huge', founded: 'soon' })).toMatchObject({ size: '', founded: null });
  });
  test('a search is words as prefixes plus exact filters, most visited first', () => {
    expect(wordsQuery('DeFi, wallets & "pay"')).toBe('"defi"* OR "wallets"* OR "pay"*');
    expect(wordsQuery('  ')).toBe('');
    const q = searchSql({ words: 'software', countries: ['us'], sizes: ['1-10', '11-50'], foundedFrom: 2015, live: true });
    expect(q.sql).toMatch(/company_words MATCH \?.*c\.iso IN \(\?\).*c\.size IN \(\?, \?\).*c\.founded >= \?.*t\.rank IS NOT NULL.*ORDER BY \(t\.rank IS NULL\), t\.rank/);
    expect(q.values).toEqual(['"software"*', 'US', '1-10', '11-50', 2015]);
    expect(searchSql({}).sql).not.toMatch(/WHERE/);
    expect([trafficWords(188), trafficWords(null)]).toEqual(['traffic rank 188 of the million most visited sites', 'not among the million most visited sites']);
  });
});

describe('the index on disk', () => {
  test('before anything is loaded it says so, and a gather tells the seat how it gets loaded', async () => {
    expect(indexStats()).toMatchObject({ loaded: false, companies: 0 });
    expect(await gatherCompanyIndex({ query: { words: 'software' } })).toEqual({ candidates: [], looked: 0, stopped: INDEX_EMPTY });
  });

  test('the company file and the traffic list load; a second load replaces, never doubles', async () => {
    expect(await loadCompanies(path.join(dir, 'companies.csv'))).toEqual({ read: 7, kept: 6, skipped: 1 });
    expect(await loadTraffic(path.join(dir, 'top.csv'))).toEqual({ ranked: 5 });
    expect(await loadCompanies(path.join(dir, 'companies.csv'))).toMatchObject({ kept: 6 });
    expect(indexStats()).toMatchObject({ loaded: true, companies: 6, ranked: 5, companiesWithTraffic: 4, source: INDEX_ATTRIBUTION });
    expect(industriesOf()).toEqual([{ industry: 'computer software', n: 3 }, { industry: 'financial services', n: 3 }]);
    await fs.writeFile(path.join(dir, 'empty.csv'), 'a,b\n1,2\n');
    await expect(loadCompanies(path.join(dir, 'empty.csv'))).rejects.toThrow(/no row of this file has a name and a website/);
  });

  test('a search returns the most visited first, filters exactly, and can keep only sites with traffic', () => {
    expect(searchIndex({ industries: ['financial services'] }).rows.map((r) => [r.domain, r.rank])).toEqual([['coinbase.com', 188], ['wise.com', 901], ['n26.com', 4400]]);
    expect(searchIndex({ industries: ['financial services'], countries: ['US', 'DE'] }).rows.map((r) => r.domain)).toEqual(['coinbase.com', 'n26.com']);
    expect(searchIndex({ words: 'software' }).rows.map((r) => r.domain)).toEqual(['peopledatalabs.com', 'quietharbor.example', 'twolines.example']);
    expect(searchIndex({ words: 'software', live: true }).rows.map((r) => r.domain)).toEqual(['peopledatalabs.com']);
    expect(searchIndex({ words: 'software', sizes: ['1-10'] }).rows.map((r) => r.name)).toEqual(['quiet harbor software, inc.']);
    expect(searchIndex({ words: 'harbor portland' }).rows.map((r) => r.domain)).toEqual(['quietharbor.example']);
    expect(searchIndex({ words: 'software', foundedFrom: 2019 }).rows.map((r) => r.domain)).toEqual(['quietharbor.example', 'twolines.example']);
    expect(searchIndex({ industries: ['financial services'] }, { count: 2, known: new Set(['coinbase.com']) }).rows.map((r) => r.domain)).toEqual(['wise.com', 'n26.com']);
  });

  test('the lead engine gathers from it: candidates carry size, country, founding year and traffic, in the audience\'s countries', async () => {
    expect(LEAD_SOURCES['company-index']).toMatchObject({ kind: 'companies', key: null, local: true, max: 500 });
    const found = await gatherCompanyIndex({ count: 50, known: { domains: new Set(['n26.com']) }, segment: { countries: ['US'] }, query: { industries: ['financial services'] } });
    expect(found.stopped).toBe(null);
    expect(found.candidates).toEqual([expect.objectContaining({ source: 'company-index', domain: 'coinbase.com', name: 'Coinbase', country: 'US', size: '1001-5000', founded: 2012, trafficRank: 188, linkedin: 'https://linkedin.com/company/coinbase', site: 'https://coinbase.com' })]);
    expect(candidateLine(found.candidates[0])).toBe('Coinbase — coinbase.com — 1001-5000 people · San Francisco, US · founded 2012 · traffic rank 188 of the million most visited sites — financial services');
    expect(candidateOfCompany({ domain: 'quiet.example', name: 'quiet', industry: '', size: '', founded: null, locality: '', country: '', iso: '', linkedin: '', rank: null }).signal).toBe('not among the million most visited sites');
    // A search names its own countries over the audience's; a wrong industry is answered with the real ones.
    expect((await gatherCompanyIndex({ segment: { countries: ['US'] }, query: { industries: ['financial services'], countries: ['GB'] } })).candidates.map((c) => c.domain)).toEqual(['wise.com']);
    expect((await gatherCompanyIndex({ query: { industries: ['fintech'] } })).stopped).toMatch(/no company matches\. The index files industries under exact names.*The most common: computer software, financial services/);
    expect((await gatherCompanyIndex({ query: { words: 'x', sizes: ['tiny'] } })).stopped).toMatch(/"tiny" is not a size the index knows — sizes are: 1-10, 11-50/);
  });
});
