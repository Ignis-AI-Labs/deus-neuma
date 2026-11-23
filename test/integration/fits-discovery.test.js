/**
 * DISCOVERY FROM YOUR FITS (sales/fits-discovery.js) — measured on the sales bench: a keyword search finds an audience
 * by a label, while every company the house has CONFIRMED a fit names more of its own kind on its own pages.
 *
 * A real house on tmp disk, the real seat and its real gather act (RULE 0); pages are handed in as the house's reader
 * would return them. Under proof: the pages of a fit that LIST companies are found and read; every company they link
 * out to is taken once, by its own site, with who named it — never a network, a tool, the fit itself or a company
 * the house already holds; another audience's fits can be read instead; and an audience with no fit yet says so.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'node:process';
import { fileSegment, setSegmentState, addProspects, addCandidates, readCandidates, readSearches } from '../../backend/services/sales/sales-store.js';
import { makeSegment } from '../../backend/services/sales/segment-shape.js';
import { makeProspect } from '../../backend/services/sales/prospect-shape.js';
import { listPages, namedOn, gatherFromFits } from '../../backend/services/sales/fits-discovery.js';
import { salesIntents } from '../../backend/services/intents/sales-acts.js';
import { LEAD_SOURCES } from '../../backend/services/sales/lead-sources.js';
import { croDesignation } from '../../backend/services/revenue/cro-designation.js';
import { connectionsOn } from '../helpers/connections-kit.js';
import { usePositionHouse, ownLane, POSITION_HOUSE as HOUSE } from '../helpers/position-house.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const LANE = 'mercfits';
const saved = {};
let dir; let position; let switches; let funds; let projects;
const HOME = '<html><body><nav><a href="/portfolio">Portfolio</a><a href="/team">Team</a><a href="/news#top">News</a><a href="https://x.com/fundone">X</a><a href="/about">Our ecosystem</a></nav><p>We invest in crypto.</p><a href="https://featured.example">Featured</a></body></html>';
const PORTFOLIO = `<html><body><h1>Portfolio</h1>
  <a href="https://app.moonwell.example/markets">Moonwell</a><a href="https://www.aerodrome.example"><img alt="Aerodrome" src="a.png"></a><a href="https://docs.seamless.example/intro">Visit</a>
  <a href="https://twitter.com/moonwell">Twitter</a><a href="https://github.com/aerodrome">GitHub</a><a href="https://held.example">Held Already</a><a href="https://fundone.example/team">Us</a>
  <a href="https://moonwell.example">Moonwell again</a><a href="https://jobs.fundone.example/open">Jobs</a><a href="https://fundone.xyz/writing">Writing</a><a href="https://apply.workable.com/fundone">Apply</a><a href="https://beam.ansible.co.uk/x">Ansible</a><a href="mailto:hi@fundone.example">Mail</a><a href="https://t.me/x">TG</a></body></html>`;
const PAGES = { 'https://fundone.example/': HOME, 'https://fundone.example/portfolio': PORTFOLIO, 'https://fundone.example/about': '<html><body><a href="https://partner.example">Partner Co</a></body></html>',
  'https://fundtwo.example/': '<html><body><a href="https://solo.example">Solo Project</a></body></html>' };
const fetchPage = async (url) => (PAGES[url] ? { ok: true, url, html: PAGES[url] } : { ok: false, why: 'the address does not exist' });
const connection = { walletAddress: HOUSE, companion: { neumaId: LANE, name: LANE } };

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fits-discovery-'));
  saved.WORKSPACES_ROOT = process.env.WORKSPACES_ROOT;
  process.env.WORKSPACES_ROOT = dir;
  position = usePositionHouse(dir);
  switches = connectionsOn(['lead-sources']);
  await workspace.create(LANE);
  await ownLane(LANE);
  await croDesignation.designate(HOUSE, LANE);
  const make = (name, first) => makeSegment({ name, offer: 'A stake in what we are building', company: 'ignis', customerProblem: 'They look for the next thing to back', targetRole: 'Partner', targetGeography: 'United States', countries: ['US'], positiveCriteria: [first], why: 'They are who we sell to', by: LANE, now: new Date().toISOString() });
  funds = make('Crypto funds', 'Invests in crypto');
  projects = make('Token projects', 'Has a token');
  for (const s of [funds, projects]) { await fileSegment(HOUSE, s); await setSegmentState(HOUSE, s.id, 'approved', 'operator'); }
  const fit = (domain, score) => makeProspect({ segment: funds, domain, name: domain.split('.')[0], country: 'US', source: `https://${domain}/`, scores: [{ criterion: 'Invests in crypto', score, reasoning: 'its own page says it invests in crypto' }], by: LANE, now: new Date().toISOString() });
  // Two confirmed fits and one that is not; a company the house already holds.
  await addProspects(HOUSE, [fit('fundone.example', 5), fit('fundtwo.example', 4), fit('notafit.example', 1)]);
  await addCandidates(HOUSE, funds.id, [{ source: 'apollo-discover', domain: 'held.example', name: 'Held Already' }], LANE);
}, 60000);

afterAll(() => {
  switches?.restore();
  position?.restore();
  if (saved.WORKSPACES_ROOT === undefined) delete process.env.WORKSPACES_ROOT; else process.env.WORKSPACES_ROOT = saved.WORKSPACES_ROOT;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the companies a confirmed fit names are gathered from its own pages', () => {
  test('the pages that list companies are found; the companies on them are taken by their own site, once, and nothing that is not a company', () => {
    expect(listPages(HOME, 'https://fundone.example/')).toEqual(['https://fundone.example/portfolio', 'https://fundone.example/about']);
    expect(namedOn(PORTFOLIO, 'https://fundone.example/portfolio')).toEqual([{ domain: 'moonwell.example', name: 'Moonwell' }, { domain: 'aerodrome.example', name: 'Aerodrome' }, { domain: 'seamless.example', name: 'seamless' }, { domain: 'held.example', name: 'Held Already' }, { domain: 'ansible.co.uk', name: 'Ansible' }]);
  });

  test('gathered for the same audience: what its fits name, the strongest fit first, never one the house holds; kept on record as a search', async () => {
    const act = salesIntents.find((i) => i.name === 'sales/gather');
    expect(LEAD_SOURCES['from-fits']).toMatchObject({ kind: 'companies', key: null });
    const got = await gatherFromFits({ wallet: HOUSE, segment: funds, known: { domains: new Set(['held.example']) }, fetchPage });
    expect(got).toMatchObject({ looked: 2, stopped: null, asked: 'the companies named by the fits of "Crypto funds"' });
    expect(got.candidates.map((c) => [c.domain, c.name, c.via, c.sourceUrl])).toEqual([
      ['moonwell.example', 'Moonwell', 'fundone.example', 'https://fundone.example/portfolio'], ['aerodrome.example', 'Aerodrome', 'fundone.example', 'https://fundone.example/portfolio'],
      ['seamless.example', 'seamless', 'fundone.example', 'https://fundone.example/portfolio'], ['ansible.co.uk', 'Ansible', 'fundone.example', 'https://fundone.example/portfolio'], ['partner.example', 'Partner Co', 'fundone.example', 'https://fundone.example/about'],
      ['featured.example', 'Featured', 'fundone.example', 'https://fundone.example/'], ['solo.example', 'Solo Project', 'fundtwo.example', 'https://fundtwo.example/'],
    ]);
    expect(got.candidates[0]).toMatchObject({ source: 'from-fits', site: 'https://moonwell.example', signal: 'named by fundone, a confirmed fit of "Crypto funds"' });
    // Another audience's fits, for THIS audience: a funds audience's portfolios feed a projects audience.
    const cross = await gatherFromFits({ wallet: HOUSE, segment: projects, from: funds.id, count: 2, fetchPage });
    expect(cross.candidates.map((c) => c.domain)).toEqual(['moonwell.example', 'aerodrome.example']);
    expect((await gatherFromFits({ wallet: HOUSE, segment: projects, fetchPage })).stopped).toMatch(/^"Token projects" has no confirmed fit yet to read from: run it first, or name another audience/);
    expect((await gatherFromFits({ wallet: HOUSE, segment: projects, from: 's-nope', fetchPage })).stopped).toBe('"s-nope" is not one of this house\'s audiences');
    // The seat's own act takes the source (its pages read over the real network here, so these .example fits name nobody).
    const checked = await act.validate({ segment: projects.id, source: 'from-fits', from: funds.id }, { connection });
    expect(checked.ok, checked.reason).toBe(true);
    const out = await act.execute(checked.value, { emit: () => {} });
    expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(/^Nothing new was gathered from from-fits: the 0 fit\(s\) read name no company the house does not already hold/) });
    expect((await readSearches(HOUSE)).at(-1)).toMatchObject({ segmentId: projects.id, source: 'from-fits', gathered: 0, spent: 0 });
    expect((await readCandidates(HOUSE)).filter((c) => c.source === 'from-fits')).toEqual([]);
  }, 60000);
});
