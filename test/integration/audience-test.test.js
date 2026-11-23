/**
 * THE AUDIENCE TEST (sales/audience-test.js) — found on the sales bench: an audience for funds that back AI rejected
 * real AI funds run after run, because its first sign named narrow things a general AI fund's page does not say, and
 * nothing told the operator. Design note, 2026-11-22: […]
 *
 * A real house on tmp disk, the real seat, routes, acts and stores (RULE 0); the house's model is a real server on
 * loopback that scores a page by what the page says; pages are handed to the run as the house's reader would return
 * them. Under proof: the operator names companies that ARE the audience; exactly those are screened (a draft audience
 * too, nothing else in its pool); a narrow first sign loses its own examples and is told which part each page did not
 * show; widened, the same examples are kept; and a company that meets the first sign is kept whatever its side signs.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { fileSegment, setSegmentState, addCandidates, readProspects, readCandidates, readSegments } from '../../backend/services/sales/sales-store.js';
import { makeSegment } from '../../backend/services/sales/segment-shape.js';
import { startAudienceTest, examplesStanding, exampleDomains, readExamples } from '../../backend/services/sales/audience-test.js';
import { readRunStanding } from '../../backend/services/sales/lead-run-standing.js';
import { startLeadRun } from '../../backend/services/sales/lead-run.js';
import { salesIntents } from '../../backend/services/intents/sales-acts.js';
import { croDesignation } from '../../backend/services/revenue/cro-designation.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { usePositionHouse, ownLane, POSITION_HOUSE as HOUSE } from '../helpers/position-house.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const LANE = 'merctest';
const saved = {};
let dir; let position; let model; let priorConfig; let narrow; let wide;
const NARROW = 'Invests in AI infrastructure or open-source AI';
const WIDE = 'Invests in AI companies';
const page = (name, words) => `<html><head><title>${name}</title></head><body><p>${words}</p></body></html>`;
const PAGES = {
  'https://infra.example/': page('Infra Fund', 'We invest in AI infrastructure: the compute, the chips and the open-source AI tooling under every model.'),
  'https://general.example/': page('General AI Fund', 'We invest in AI companies at the earliest stages, and we back founders building AI-first products.'),
  'https://applied.example/': page('Applied AI Fund', 'We invest in AI companies that put models to work in healthcare, logistics and finance.'),
  'https://first.example/': page('AI First Fund', 'We invest in AI companies from the first check, across applied AI and AI-native software.'),
  'https://g2.example/': page('G2 Fund', 'We invest in AI companies at the earliest stages, and we back founders building AI-first products.'),
  'https://a2.example/': page('A2 Fund', 'We invest in AI companies that put models to work in healthcare, logistics and finance.'),
  'https://f2.example/': page('F2 Fund', 'We invest in AI companies from the first check, across applied AI and AI-native software.'),
  'https://shoes.example/': page('Shoe Shop', 'Running shoes for every distance, shipped across the country with free returns for a month.'),
};
const fetchPage = async (url) => (PAGES[url] ? { ok: true, url, html: PAGES[url] } : { ok: false, why: 'the address does not exist' });
// The house's model, scoring a page by what the page itself says: the first sign as the audience words it, the side sign never shown.
const respond = (body) => {
  const system = String(body.messages?.[0]?.content ?? '');
  const shown = String(body.messages?.at(-1)?.content ?? '');
  if (!system.startsWith('You screen one company')) return '{"country": "US"}';
  const text = shown.slice(shown.indexOf('PAGE TEXT:'));
  const asksNarrow = shown.includes(`F1. ${NARROW}`);
  const met = asksNarrow ? /AI infrastructure|open-source AI/.test(text) : /invest in AI/.test(text);
  return JSON.stringify({ name: 'A fund', what: 'A venture fund.', country: 'US', scores: { F1: { score: met ? 5 : 1, why: met ? 'its page says it invests in exactly this' : (asksNarrow ? 'its page says it invests in AI companies, but names no AI infrastructure and no open-source AI' : 'its page sells running shoes') }, F2: { score: 0, why: 'its page names no grant or program at all' } } });
};
const start = (wallet, ask) => startLeadRun(wallet, ask, { intents: salesIntents, fetchPage, width: 1 });
const EXAMPLES = ['infra.example', 'general.example', 'applied.example', 'first.example'];

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audience-test-'));
  saved.WORKSPACES_ROOT = process.env.WORKSPACES_ROOT;
  process.env.WORKSPACES_ROOT = dir;
  position = usePositionHouse(dir);
  await workspace.create(LANE);
  await ownLane(LANE);
  model = await startLocalProvider({ respond });
  priorConfig = getConfig();
  setConfig({ provider: 'lm-studio', endpoint: model.endpoint, model: 'test-model', apiKey: '' });
  await croDesignation.designate(HOUSE, LANE);
  const make = (name, first) => makeSegment({ name, offer: 'A stake in what we are building', company: 'ignis', customerProblem: 'They look for the next thing to back', targetRole: 'Partner', targetGeography: 'United States', countries: ['US'], positiveCriteria: [first, 'Runs grants or programs for builders'], why: 'They invest in this', by: LANE, now: new Date().toISOString() });
  narrow = make('AI funds, narrow', NARROW);
  wide = make('AI funds, wide', WIDE);
  for (const s of [narrow, wide]) await fileSegment(HOUSE, s);
  // The narrow one is left a DRAFT: an audience is tested before it is approved. Something else waits in its pool.
  await setSegmentState(HOUSE, wide.id, 'approved', 'operator');
  await addCandidates(HOUSE, narrow.id, [{ source: 'apollo-discover', domain: 'shoes.example', name: 'Shoe Shop' }], LANE);
}, 60000);

afterAll(async () => {
  if (priorConfig) setConfig(priorConfig);
  await model?.close();
  position?.restore();
  if (saved.WORKSPACES_ROOT === undefined) delete process.env.WORKSPACES_ROOT; else process.env.WORKSPACES_ROOT = saved.WORKSPACES_ROOT;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('an audience is tested against the companies its operator knows are right for it', () => {
  test('what was typed is read as company sites; fewer than three says nothing', async () => {
    expect(exampleDomains('https://www.Infra.example/about, general.example\n general.example ; not a site')).toEqual(['infra.example', 'general.example']);
    expect(await startAudienceTest(HOUSE, { segmentId: 's-nope', domains: EXAMPLES }, { start })).toEqual({ ok: false, reason: 'that is not one of this house\'s audiences' });
    expect((await startAudienceTest(HOUSE, { segmentId: narrow.id, domains: 'infra.example, general.example' }, { start })).reason).toMatch(/^name at least 3 companies that ARE this audience, by their site/);
    expect(examplesStanding({ segment: narrow, domains: [], candidates: [], prospects: [] })).toBeNull();
  });

  test('a narrow first sign loses its own examples, and each lost one says what its page did not show; only the examples were screened', async () => {
    const started = await startAudienceTest(HOUSE, { segmentId: narrow.id, domains: EXAMPLES }, { start });
    expect(started.ok, started.reason).toBe(true);
    const ended = await started.run && await (async () => { const { leadRunsOf } = await import('../../backend/services/sales/lead-run.js'); for (let i = 0; i < 200; i += 1) { const r = leadRunsOf(HOUSE).find((x) => x.id === started.run.id); if (r && !r.active) return r; await new Promise((resolve) => { setTimeout(resolve, 25); }); } return null; })();
    expect(ended?.counts).toMatchObject({ looked: 4, screened: 4, fit: 1 });
    // The shoe shop that waited in the pool was not touched: a test screens its examples and nothing else.
    expect((await readCandidates(HOUSE)).find((c) => c.domain === 'shoes.example')).toMatchObject({ state: 'waiting' });
    const [segments, candidates, prospects, tested] = await Promise.all([readSegments(HOUSE), readCandidates(HOUSE), readProspects(HOUSE), readExamples(HOUSE)]);
    const s = examplesStanding({ segment: segments.find((x) => x.id === narrow.id), domains: tested.get(narrow.id), candidates, prospects, segments });
    expect(s).toMatchObject({ domains: 4, judged: 4, share: 0.25, verdict: 'narrow', kept: [expect.objectContaining({ domain: 'infra.example', score: 5 })] });
    expect(s.words).toBe(`THIS AUDIENCE IS TOO NARROW: only 1 of 4 of your own examples were kept. Its first sign ("${NARROW}") asks for more than those companies' own pages say. Each one lost says below what its page did not show — that is the part to widen, in the first sign's words.`);
    expect(s.lost.map((c) => [c.domain, c.why])).toEqual(['general.example', 'applied.example', 'first.example'].map((d) => [d, 'its page says it invests in AI companies, but names no AI infrastructure and no open-source AI']));
  }, 60000);

  test('widened, the same companies are kept — each on the first sign alone, though its side sign scored nothing', async () => {
    const started = await startAudienceTest(HOUSE, { segmentId: wide.id, domains: ['g2.example', 'a2.example', 'f2.example', 'wide-only.example', 'general.example'] }, { start });
    expect(started.ok, started.reason).toBe(true);
    const { leadRunsOf } = await import('../../backend/services/sales/lead-run.js');
    for (let i = 0; i < 200 && leadRunsOf(HOUSE).find((x) => x.id === started.run.id)?.active; i += 1) await new Promise((resolve) => { setTimeout(resolve, 25); });
    const standing = (await readRunStanding(HOUSE)).find((a) => a.id === wide.id);
    expect(standing.examples).toMatchObject({ judged: 3, verdict: 'holds', words: 'THIS AUDIENCE SAYS WHAT YOU MEAN: 3 of 3 of your own examples were kept.', unread: ['wide-only.example'], elsewhere: [{ domain: 'general.example', audience: 'AI funds, narrow' }] });
    // Kept as a weak match: the first sign met, the side sign 0 (prospect-shape.js matchLevel).
    expect((await readProspects(HOUSE)).filter((p) => p.segmentId === wide.id).map((p) => [p.domain, p.match, p.fit.map((f) => f.score)])).toEqual(expect.arrayContaining([['g2.example', 2, [5, 0]]]));
  }, 60000);
});
