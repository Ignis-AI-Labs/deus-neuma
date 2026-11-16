/**
 * THE LEAD SOURCES through the real stack (RULE 0, nothing mocked): the
 * house's real gather code against a real HTTP server on loopback serving the
 * lists in the shape the public APIs answer in (recorded 2026-11-15), the
 * acts settled by the REAL portal sweep for a seated Mercator, the candidates
 * on tmp disk. Off until the switch is on; free sources need no key; the
 * people lookup needs the operator's own key and never guesses an address.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { mercatorBriefingSection } from '../../backend/services/revenue/revenue-briefing.js';
import { readCandidates } from '../../backend/services/sales/sales-store.js';
import { tokensOfPools, candidateOf, protocolsOnBase, peopleOfHunter, candidateLine, LEAD_SOURCES } from '../../backend/services/sales/lead-sources.js';
import { peopleOfTomba, apolloToReveal, personOfApollo } from '../../backend/services/sales/lead-providers.js';
import { foldSpend, makeRule, spentThisMonth, spendRefusal, spendLine } from '../../backend/services/sales/lead-spend.js';
import { SPEND_CHOICES, attachedWords, spentWords, capOk } from '../../frontend/app/RelinkShell/company-line/paid-lead-view.js';
import { getService } from '../../backend/services/provider-registry.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { campaignStoreFor } from '../../backend/services/marketing/campaign-store.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';
import { houseCampaigns } from '../../backend/services/positions/campaign-links.js';

const { processToolCalls } = __test;
const SAVED = Object.fromEntries(['DNA_ENCRYPTION_KEY', 'NEUMA_CONNECTIONS_PATH', 'NEUMA_LEAD_SOURCE_GECKO', 'NEUMA_LEAD_SOURCE_LLAMA', 'NEUMA_LEAD_SOURCE_HUNTER', 'HUNTER_API_KEY', 'NEUMA_LEAD_SOURCE_TOMBA', 'TOMBA_API_KEY', 'NEUMA_LEAD_SOURCE_APOLLO', 'APOLLO_API_KEY'].map((k) => [k, process.env[k]]));
const PRIOR_ROOT = getWorkspacesRoot();

const tok = (address, symbol, name) => ({ id: `base_${address}`, type: 'token', attributes: { address, symbol, name } });
const pool = (address, name, dex, reserve, vol) => ({ attributes: { name, reserve_in_usd: String(reserve), volume_usd: { h24: String(vol) } }, relationships: { base_token: { data: { id: `base_${address}` } }, dex: { data: { id: dex } } } });
const POOLS = {
  data: [pool('0xaaa', 'LMTS / USDC 1%', 'aerodrome-slipstream', 520000, 260000), pool('0xaaa', 'LMTS / WETH 0.3%', 'uniswap-v3-base', 40000, 39), pool('0xweth', 'WETH / USDC 0.05%', 'uniswap-v3-base', 9000000, 80000000),
    pool('0xbbb', 'MEME / WETH 1%', 'uniswap-v4-base', 90000, 5000000), pool('0xccc', 'DUST / WETH 1%', 'uniswap-v2-base', 900, 100)],
  included: [tok('0xaaa', 'LMTS', 'Limitless'), tok('0xweth', 'WETH', 'Wrapped Ether'), tok('0xbbb', 'MEME', 'Meme'), tok('0xccc', 'DUST', 'Dust')],
};
const INFO = {
  '0xaaa': { data: { attributes: { name: 'Limitless Official Token', symbol: 'LMTS', websites: ['https://limitless.exchange/advanced'], twitter_handle: 'trylimitless', telegram_handle: 'try_limitless', description: 'Prediction markets.', categories: ['Prediction Markets'], holders: { count: 27311 }, gt_verified: true, is_honeypot: false } } },
  '0xbbb': { data: { attributes: { name: 'Meme', symbol: 'MEME', websites: ['https://clanker.world/clanker/0xbbb'], holders: { count: 9000 } } } },
};
const PROTOCOLS = [
  { name: 'Binance CEX', url: 'https://binance.com', category: 'CEX', chains: ['Base', 'Ethereum'], tvl: 1e11, chainTvls: { Base: 9e10 } },
  { name: 'YO Protocol', symbol: 'YO', url: 'https://app.yo.xyz', twitter: 'yield', category: 'Yield Aggregator', chains: ['Base', 'Ethereum'], tvl: 28e6, chainTvls: { Base: 20e6 }, slug: 'yo-protocol', description: 'Yield.' },
  { name: 'Aave V3', url: 'https://aave.com', category: 'Lending', chains: ['Base', 'Ethereum'], tvl: 13e9, chainTvls: { Base: 1e9 } },
  { name: 'Syntetika', symbol: '-', url: 'https://syntetika.io', twitter: 'Syntetika', category: 'Risk Curators', chains: ['Base'], tvl: 13e6, chainTvls: { Base: 13e6 }, slug: 'syntetika' },
  { name: 'Elsewhere', url: 'https://elsewhere.xyz', category: 'Dexs', chains: ['Solana'], tvl: 5e6, chainTvls: { Solana: 5e6 } },
];
const HUNTER = { data: { emails: [
  { value: 'Dima@Limitless.Exchange', first_name: 'Dima', last_name: 'Horshkov', position: 'Chief Product Officer', confidence: 94, sources: [{ uri: 'https://limitless.exchange/team' }] },
  { value: 'guess@limitless.exchange', first_name: 'No', last_name: 'Page', position: 'CEO', confidence: 99, sources: [] },
  { value: 'info@limitless.exchange', first_name: null, last_name: null, position: null, confidence: 80, sources: [{ uri: 'https://limitless.exchange/contact' }] },
] } };

// Tomba and Apollo, in the shape their own API documentation states (read 2026-11-15).
const TOMBA = { data: { emails: [
  { email: 'Roberto@Olivetree.Example', first_name: 'Roberto', last_name: 'Diaz', full_name: 'Roberto Diaz', position: 'Founder', score: 91, sources: [{ uri: 'https://olivetree.example/about' }] },
  { email: 'nopage@olivetree.example', full_name: 'No Page', position: 'CTO', score: 99, sources: [] },
] } };
const APOLLO_SEARCH = { total_entries: 4, people: [
  { id: 'p1', first_name: 'Dima', last_name_obfuscated: 'H***', title: 'Chief Product Officer', has_email: true },
  { id: 'p2', first_name: 'Ann', title: 'Engineer', has_email: true },
  { id: 'p3', first_name: 'Cy', title: 'CEO', has_email: false },
  { id: 'p4', first_name: 'No', title: '', has_email: true },
] };
const APOLLO_MATCH = {
  p1: { person: { name: 'Dima Horshkov', title: 'Chief Product Officer', email: 'Dima@Limitless.Exchange', email_status: 'verified', linkedin_url: 'https://www.linkedin.com/in/dima-h' } },
  p2: { person: { name: 'Ann Lee', title: 'Engineer', email: 'ann@limitless.exchange', email_status: 'unverified', linkedin_url: 'https://www.linkedin.com/in/ann-lee' } },
};

describe('paid lead data: the providers and the rule on spending (pure)', () => {
  test('Tomba offers a person only with a name, a role and the page the address stands on', () => {
    expect(peopleOfTomba(TOMBA)).toEqual([{ name: 'Roberto Diaz', role: 'Founder', email: 'roberto@olivetree.example', confidence: 91, sourceUrl: 'https://olivetree.example/about', basis: 'published' }]);
    expect(peopleOfTomba({})).toEqual([]);
  });

  test('Apollo reveals only people with a title and an address on file, and keeps only a verified address with a public profile', () => {
    expect(apolloToReveal(APOLLO_SEARCH)).toEqual(['p1', 'p2']);
    expect(personOfApollo(APOLLO_MATCH.p1)).toEqual({ name: 'Dima Horshkov', role: 'Chief Product Officer', email: 'dima@limitless.exchange', confidence: 100, sourceUrl: 'https://www.linkedin.com/in/dima-h', basis: 'verified' });
    expect(personOfApollo(APOLLO_MATCH.p2)).toBe(null);
    expect(personOfApollo({})).toBe(null);
  });

  test('nothing paid runs until the operator chooses; free first waits for a scored company; the cap holds the month', () => {
    expect(foldSpend([])).toEqual({ mode: 'ask', cap: 100, chosen: false, at: null });
    expect(foldSpend([{ type: 'rule', mode: 'paid-first', cap: 50, at: 't1' }, { type: 'rule', mode: 'free-first', cap: 20, at: 't2' }])).toEqual({ mode: 'free-first', cap: 20, chosen: true, at: 't2' });
    expect(() => makeRule({ mode: 'always', cap: 5 })).toThrow(/mode is one of: ask, free-first, paid-first/);
    expect(() => makeRule({ mode: 'ask', cap: 1.5 })).toThrow(/a whole number of credits a month/);
    const lookups = [{ at: '2026-11-02T10:00:00.000Z', spent: 2 }, { at: '2026-11-14T10:00:00.000Z' }, { at: '2026-10-30T10:00:00.000Z', spent: 9 }];
    expect(spentThisMonth(lookups, Date.parse('2026-11-15T00:00:00Z'))).toBe(3);
    const at = (extra) => spendRefusal({ rule: { mode: 'paid-first', cap: 10 }, spent: 3, cost: 1, scored: false, providers: ['hunter'], ...extra });
    expect(at({})).toBe(null);
    expect(at({ rule: { mode: 'ask', cap: 10 } })).toMatch(/^paid lead data is not allowed yet\. Ask your operator now[\s\S]*hunter can give me the people at each company[\s\S]*PAID LEAD DATA/);
    expect(at({ rule: { mode: 'free-first', cap: 10 } })).toMatch(/FREE FIRST: read this company's own pages/);
    expect(at({ rule: { mode: 'free-first', cap: 10 }, scored: true })).toBe(null);
    expect(at({ spent: 8, cost: 5 })).toMatch(/this month's cap is 10 credit\(s\) and 8 are spent; this lookup may spend 5/);
    expect(spendLine({ rule: { mode: 'ask', cap: 100 }, spent: 0, attached: [] })).toMatch(/no provider is attached/);
    expect(spendLine({ rule: { mode: 'free-first', cap: 100 }, spent: 4, attached: ['hunter', 'apollo'] })).toBe('PAID LEAD DATA (hunter, apollo attached; it spends your operator\'s credits): FREE FIRST. Read and score each company from its own pages; use sales/contacts only for a scored company whose pages gave no address. Spent this month: 4 of 100 credit(s).');
  });

  test('the leads screen words the choice, what is attached and what the month has spent', () => {
    expect(SPEND_CHOICES.map((c) => [c.mode, c.label])).toEqual([['ask', 'ASK ME FIRST'], ['free-first', 'FREE FIRST'], ['paid-first', 'PAID FROM THE START']]);
    expect(attachedWords({ attached: [] })).toMatch(/^NO PROVIDER ATTACHED — ADD A KEY IN SETTINGS, API, LEAD DATA/);
    expect(attachedWords({ attached: ['hunter', 'tomba'] })).toBe('ATTACHED: HUNTER · TOMBA');
    expect(spentWords({ spent: 4, rule: { cap: 100, chosen: true } })).toBe('SPENT THIS MONTH: 4 OF 100 CREDITS');
    expect(spentWords({ spent: 0, rule: { cap: 100, chosen: false } })).toMatch(/YOU HAVE NOT CHOSEN YET, SO NOTHING PAID RUNS$/);
    expect([capOk('250'), capOk('2.5'), capOk(''), capOk('-1')]).toEqual([true, false, false, false]);
  });
});

describe('the lead sources, read as they answer (pure)', () => {
  test('a token page gives each non-major token once, with its deepest pool; a profile gives the team\'s own site or nothing', () => {
    const tokens = tokensOfPools(POOLS);
    expect(tokens.map((t) => [t.symbol, t.pool.name, t.pool.liquidityUsd])).toEqual([['LMTS', 'LMTS / USDC 1%', 520000], ['MEME', 'MEME / WETH 1%', 90000], ['DUST', 'DUST / WETH 1%', 900]]);
    const row = candidateOf(tokens[0], INFO['0xaaa']);
    expect(row).toMatchObject({ source: 'base-tokens', domain: 'limitless.exchange', symbol: 'LMTS', twitter: 'trylimitless', holders: 27311, sourceUrl: 'https://www.geckoterminal.com/base/tokens/0xaaa' });
    expect(candidateLine(row)).toBe('Limitless Official Token (LMTS) — limitless.exchange — deepest pool LMTS / USDC 1% on aerodrome-slipstream, $520,000 liquidity, $260,000 traded in 24 h — 27,311 holders — Prediction Markets — X @trylimitless — Telegram try_limitless');
    // A launchpad page is not the team's site; a token with too few holders is noise; a flagged one is never offered.
    expect(candidateOf(tokens[1], INFO['0xbbb'])).toBe(null);
    expect(candidateOf(tokens[0], { data: { attributes: { ...INFO['0xaaa'].data.attributes, holders: { count: 12 } } } })).toBe(null);
    expect(candidateOf(tokens[0], { data: { attributes: { ...INFO['0xaaa'].data.attributes, is_honeypot: 'yes' } } })).toBe(null);
  });

  test('the protocol list keeps the teams that live on Base, biggest there first; an exchange and a visitor are left out', () => {
    const rows = protocolsOnBase(PROTOCOLS);
    expect(rows.map((r) => [r.name, r.domain])).toEqual([['YO Protocol', 'yo.xyz'], ['Syntetika', 'syntetika.io']]);
    expect(rows[0].signal).toBe('$20,000,000 locked on Base, 71% of all it holds');
    expect(rows[1].symbol).toBe(null);
  });

  test('a person is offered only with a name, a role and the page the address was found on', () => {
    expect(peopleOfHunter(HUNTER)).toEqual([{ name: 'Dima Horshkov', role: 'Chief Product Officer', email: 'dima@limitless.exchange', confidence: 94, sourceUrl: 'https://limitless.exchange/team' }]);
    expect(peopleOfHunter({})).toEqual([]);
  });

  test('free sources come first and need no key; the people source names the operator\'s own key', () => {
    expect(Object.entries(LEAD_SOURCES).map(([id, s]) => [id, s.kind, s.key])).toEqual([['base-protocols', 'companies', null], ['base-tokens', 'companies', null], ['hunter', 'people', 'hunter'], ['tomba', 'people', 'tomba'], ['apollo', 'people', 'apollo']]);
    for (const id of ['hunter', 'tomba', 'apollo']) expect(getService(id), id).toMatchObject({ kind: 'service', group: 'Lead data', requiresKey: true });
    // Every paid source says the most one lookup may spend.
    expect(Object.values(LEAD_SOURCES).filter((s) => s.kind === 'people').map((s) => s.cost)).toEqual([1, 1, 5]);
  });
});

describe('GATHERING through the real stack (gnosis)', () => {
  let me, app, httpServer, wss, serverWs, client, lists, hits;
  const conn = (neumaId) => ({ ws: serverWs, companion: { name: neumaId, neumaId }, walletAddress: me.address, sessionId: `sess-${neumaId}` });
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  let filed = 0;
  const act = async (neumaId, payload) => {
    const dir = path.join(workspace.pathFor(neumaId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    filed += 1;
    await fs.writeFile(path.join(dir, `act-${filed}.json`), JSON.stringify(payload));
    const [result] = await processToolCalls(serverWs, '', conn(neumaId));
    return result;
  };
  const SEGMENT = { type: 'sales/segment', name: 'Base token teams', company: 'umbrae', offer: 'A pool on a venue whose swap fees go to whoever supplies it', customerProblem: 'Their liquidity sits in one pool on one exchange', targetRole: 'Founder', targetGeography: 'United States', countries: ['US'], positiveCriteria: ['Has a token live on Base'], why: 'A second venue with a better fee split' };

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'lead-sources-test-key';
    useTempRealm();
    const tmp = await createTempDir('lead-sources');
    process.env.NEUMA_CONNECTIONS_PATH = path.join(tmp, 'connections.json');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    for (const [i, id] of ['merc', 'scout'].entries()) {
      await workspace.create(id);
      await fs.writeFile(path.join(tmp, 'workspaces', id, 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
      await fs.mkdir(path.join(tmp, 'workspaces', id, 'identity'), { recursive: true });
      await fs.writeFile(path.join(tmp, 'workspaces', id, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: `0x${String(i + 1).padStart(40, 'f')}` }));
    }
    // The lists, served from this machine exactly as the public APIs answer.
    hits = [];
    const list = express();
    list.use((req, res, next) => { hits.push(req.originalUrl); next(); });
    list.get('/gecko/networks/base/pools', (req, res) => res.json(req.query.page === '1' ? POOLS : { data: [] }));
    list.get('/gecko/networks/base/tokens/:address/info', (req, res) => (INFO[req.params.address] ? res.json(INFO[req.params.address]) : res.status(404).json({})));
    list.get('/llama/protocols', (req, res) => res.json(PROTOCOLS));
    list.get('/hunter/domain-search', (req, res) => (req.query.api_key === 'the-operators-key' ? res.json(req.query.domain === 'limitless.exchange' ? HUNTER : { data: { emails: [] } }) : res.status(401).json({})));
    list.get('/tomba/domain-search', (req, res) => (req.get('X-Tomba-Key') === 'tk' && req.get('X-Tomba-Secret') === 'ts' ? res.json(req.query.domain === 'limitless.exchange' ? TOMBA : { data: { emails: [] } }) : res.status(401).json({})));
    list.post('/apollo/mixed_people/api_search', (req, res) => (req.get('x-api-key') === 'apollo-key' ? res.json([req.query.q_organization_domains_list].flat()[0] === 'limitless.exchange' ? APOLLO_SEARCH : { people: [] }) : res.status(401).json({})));
    list.post('/apollo/people/match', (req, res) => (req.get('x-api-key') === 'apollo-key' ? res.json(APOLLO_MATCH[req.query.id] ?? {}) : res.status(401).json({})));
    lists = await new Promise((resolve) => { const s = list.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${lists.address().port}`;
    Object.assign(process.env, { NEUMA_LEAD_SOURCE_GECKO: `${base}/gecko`, NEUMA_LEAD_SOURCE_LLAMA: `${base}/llama`, NEUMA_LEAD_SOURCE_HUNTER: `${base}/hunter`, NEUMA_LEAD_SOURCE_TOMBA: `${base}/tomba`, NEUMA_LEAD_SOURCE_APOLLO: `${base}/apollo` });
    for (const k of ['HUNTER_API_KEY', 'TOMBA_API_KEY', 'APOLLO_API_KEY']) delete process.env[k];

    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => { wss.on('connection', (ws) => { serverWs = ws; resolve(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    await linked;
    expect((await request(app).put('/api/v1/revenue/seat').use(as).send({ laneId: 'merc' })).status).toBe(200);
    expect((await act('merc', SEGMENT)).status).toBe('ok');
  }, 60000);

  afterAll(async () => {
    client?.close();
    wss?.close();
    httpServer?.close();
    await new Promise((resolve) => lists.close(resolve));
    setWorkspacesRoot(PRIOR_ROOT);
    for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  const segmentId = async () => (await request(app).get('/api/v1/revenue/lead-engine').use(as)).body.segments[0].id;
  const switchOn = (on) => fs.writeFile(process.env.NEUMA_CONNECTIONS_PATH, JSON.stringify({ 'lead-sources': on }));

  test('off by default: nothing is gathered and no list is asked until the operator turns the switch on', async () => {
    expect(await act('merc', { type: 'sales/gather', segment: await segmentId(), source: 'base-protocols' })).toMatchObject({ status: 'denied', error: expect.stringMatching(/LEAD SOURCES connection is off/) });
    expect(hits).toEqual([]);
    await switchOn(true);
    expect(await act('scout', { type: 'sales/gather', segment: await segmentId(), source: 'base-protocols' })).toMatchObject({ status: 'denied', error: expect.stringMatching(/only the seated Mercator/) });
    expect(await act('merc', { type: 'sales/gather', segment: await segmentId(), source: 'the-dark-web' })).toMatchObject({ status: 'error', error: expect.stringMatching(/source is one of: base-protocols/) });
    expect(await act('merc', { type: 'sales/gather', segment: 's-nope', source: 'base-protocols' })).toMatchObject({ status: 'error', error: expect.stringMatching(/not one of your audiences/) });
    expect(hits).toEqual([]);
  });

  test('a free source fills the candidate pool, once each; the briefing and the operator\'s read carry them', async () => {
    const first = await act('merc', { type: 'sales/gather', segment: await segmentId(), source: 'base-protocols' });
    expect(first.status).toBe('ok');
    expect(first.content).toMatch(/2 new candidate\(s\) for "Base token teams" from base-protocols/);
    expect(first.content).toContain('YO Protocol (YO) — yo.xyz — $20,000,000 locked on Base, 71% of all it holds — Yield Aggregator — X @yield');
    expect((await readCandidates(me.address)).map((c) => [c.domain, c.state, c.source])).toEqual([['yo.xyz', 'waiting', 'base-protocols'], ['syntetika.io', 'waiting', 'base-protocols']]);
    // Gathered again, the same list adds nothing.
    expect(await act('merc', { type: 'sales/gather', segment: await segmentId(), source: 'base-protocols' })).toMatchObject({ status: 'error', error: expect.stringMatching(/Nothing new was gathered/) });
    const briefing = await mercatorBriefingSection(conn('merc'));
    expect(briefing).toMatch(/Candidates gathered, waiting for your score \(2;/);
    expect(briefing).toContain('Syntetika — syntetika.io — $13,000,000 locked on Base, 100% of all it holds');
    expect((await request(app).get('/api/v1/revenue/lead-engine').use(as)).body.candidates).toHaveLength(2);
  });

  test('the token source adds the team with its own site and leaves the launchpad token and the dust out', async () => {
    const got = await act('merc', { type: 'sales/gather', segment: await segmentId(), source: 'base-tokens', count: 5 });
    expect(got.status).toBe('ok');
    expect(got.content).toMatch(/1 new candidate\(s\)/);
    expect((await readCandidates(me.address)).at(-1)).toMatchObject({ domain: 'limitless.exchange', token: '0xaaa', state: 'waiting' });
    // The dust token (under the liquidity floor) was never even looked up.
    expect(hits.some((h) => h.includes('/tokens/0xccc/'))).toBe(false);
  }, 120000);

  test('scoring a candidate makes it a prospect; it then stands as scored, never gathered twice', async () => {
    const scored = await act('merc', { type: 'sales/prospect', segment: await segmentId(), companies: [{ domain: 'limitless.exchange', name: 'Limitless', source: 'https://www.geckoterminal.com/base/tokens/0xaaa', country: 'US',
      scores: [{ criterion: 'Has a token live on Base', score: 5, reasoning: 'LMTS trades on Base, deepest pool on Aerodrome' }], people: [] }] });
    expect(scored.status).toBe('ok');
    expect((await readCandidates(me.address)).find((c) => c.domain === 'limitless.exchange').state).toBe('scored');
    expect(await mercatorBriefingSection(conn('merc'))).toMatch(/waiting for your score \(2;/);
  });

  test('the sales seat manages its own campaigns: opens one, files an audience under it, edits, archives, reopens; deletes only an empty one', async () => {
    expect(await act('scout', { type: 'sales/campaign', name: 'User acquisition', company: 'umbrae', goal: 'Teams with a token on Base opening a pool' })).toMatchObject({ status: 'denied' });
    expect(await act('merc', { type: 'sales/campaign', name: 'User acquisition', company: 'nowhere', goal: 'Teams with a token on Base opening a pool' })).toMatchObject({ status: 'error', error: expect.stringMatching(/"nowhere" is not a company of this house/) });
    const opened = await act('merc', { type: 'sales/campaign', name: 'User acquisition', company: 'umbrae', goal: 'Teams with a token on Base opening a pool' });
    expect(opened.status).toBe('ok');
    const id = /\[(k-[a-f0-9]{8})\]/.exec(opened.content)[1];
    expect(await act('merc', { ...SEGMENT, id: await segmentId(), campaign: 'k-nope' })).toMatchObject({ status: 'error', error: expect.stringMatching(/is not an open campaign for umbrae/) });
    expect((await act('merc', { ...SEGMENT, id: await segmentId(), campaign: id })).status).toBe('ok');
    const read = async () => (await request(app).get('/api/v1/revenue/lead-engine').use(as)).body.campaigns.find((c) => c.id === id);
    expect(await read()).toMatchObject({ name: 'User acquisition', state: 'open', gathered: 3, scored: 1, audiences: [{ name: 'Base token teams' }] });
    expect(await mercatorBriefingSection(conn('merc'))).toMatch(/Your campaigns \(sales\/campaign opens, edits, archives or deletes one/);
    expect(await act('merc', { type: 'sales/campaign', id, move: 'delete' })).toMatchObject({ status: 'error', error: expect.stringMatching(/1 audience\(s\) still serve this campaign/) });
    expect((await act('merc', { type: 'sales/campaign', id, move: 'edit', name: 'Base pools' })).status).toBe('ok');
    expect((await act('merc', { type: 'sales/campaign', id, move: 'archive' })).content).toMatch(/it is archived/);
    expect(await read()).toMatchObject({ name: 'Base pools', state: 'closed' });
    expect((await act('merc', { type: 'sales/campaign', id, move: 'reopen' })).status).toBe('ok');
    // An empty campaign goes; the operator has the same hands through the route.
    const spare = /\[(k-[a-f0-9]{8})\]/.exec((await act('merc', { type: 'sales/campaign', name: 'Spare', company: 'umbrae', goal: 'Nothing serves this one yet' })).content)[1];
    expect((await act('merc', { type: 'sales/campaign', id: spare, move: 'delete' })).content).toBe(`Campaign [${spare}] is deleted.`);
    expect((await request(app).post(`/api/v1/revenue/lead-engine/campaigns/${id}`).use(as).send({ move: 'edit', goal: 'Base token teams opening a pool on Umbrae' })).body.campaign.goal).toBe('Base token teams opening a pool on Umbrae');
    expect((await request(app).post(`/api/v1/revenue/lead-engine/campaigns/${id}`).send({ move: 'archive' })).status).toBe(401);
  });

  test('a seat links its own campaign with another position\'s; a member with no campaign seat cannot, and nobody links a campaign that is not theirs', async () => {
    const bench = await campaignStoreFor(me.address);
    const made = await bench.add({ name: 'Umbrae Market Depth', company: 'umbrae', angles: ['Depth'] });
    const theirs = `cmo:${(made.campaign ?? made).id}`;
    const mine = (await houseCampaigns(me.address)).find((c) => c.office === 'cro').key;
    expect(await act('scout', { type: 'campaigns/link', mine, with: theirs })).toMatchObject({ status: 'denied', error: expect.stringMatching(/only a member who holds a position that runs campaigns/) });
    expect(await act('merc', { type: 'campaigns/link', mine: theirs, with: mine })).toMatchObject({ status: 'error', error: expect.stringMatching(/mine: a campaign of a position you hold \(cro\)/) });
    expect((await act('merc', { type: 'campaigns/link', mine, with: theirs, note: 'the same launch week' })).status).toBe('ok');
    expect((await houseCampaigns(me.address)).find((c) => c.key === mine).links).toMatchObject([{ key: theirs, note: 'the same launch week' }]);
    // Marketing's holder, once seated, can take the link away from its own side.
    await cmoDesignation.designate(me.address, 'scout');
    expect((await act('scout', { type: 'campaigns/link', mine: theirs, with: mine, unlink: true })).status).toBe('ok');
    expect((await houseCampaigns(me.address)).every((c) => c.links.length === 0)).toBe(true);
  });

  test('people come only from the operator\'s own key, and only once the operator has said paid data may be spent', async () => {
    const spend = async () => (await request(app).get('/api/v1/revenue/lead-engine').use(as)).body.spend;
    const rule = (mode, cap) => request(app).post('/api/v1/revenue/lead-engine/spend').use(as).send({ mode, cap });
    expect(await act('merc', { type: 'sales/contacts', domain: 'limitless.exchange' })).toMatchObject({ status: 'denied', error: expect.stringMatching(/no contact-data provider is attached/) });
    expect(await spend()).toMatchObject({ rule: { mode: 'ask', cap: 100, chosen: false }, spent: 0, attached: [], modes: ['ask', 'free-first', 'paid-first'] });
    process.env.HUNTER_API_KEY = 'the-operators-key';
    expect(await act('merc', { type: 'sales/contacts', domain: 'stranger.example' })).toMatchObject({ status: 'error', error: expect.stringMatching(/not a company you gathered or pooled/) });
    // A key alone spends nothing: until the operator chooses, the seat is told to ask them, in words.
    expect(await act('merc', { type: 'sales/contacts', domain: 'limitless.exchange' })).toMatchObject({ status: 'denied', error: expect.stringMatching(/paid lead data is not allowed yet\. Ask your operator now/) });
    expect(await mercatorBriefingSection(conn('merc'))).toContain('PAID LEAD DATA (hunter attached; it spends your operator\'s credits): NOT ALLOWED YET.');
    // FREE FIRST: a company the seat has not scored from its own pages is not paid for.
    expect((await rule('sometimes', 3)).status).toBe(400);
    expect((await rule('free-first', 3)).body.rule).toMatchObject({ mode: 'free-first', cap: 3, chosen: true });
    expect(await act('merc', { type: 'sales/contacts', domain: 'syntetika.io' })).toMatchObject({ status: 'denied', error: expect.stringMatching(/FREE FIRST: read this company's own pages/) });
    expect(hits.some((h) => /^\/(hunter|tomba|apollo)\//.test(h))).toBe(false);
    // PAID FROM THE START: the cheapest attached provider answers; an address with no page is never offered.
    expect((await rule('paid-first', 3)).status).toBe(200);
    const people = await act('merc', { type: 'sales/contacts', domain: 'limitless.exchange' });
    expect(people.status).toBe('ok');
    expect(people.content).toContain('People at limitless.exchange (hunter, 1 credit(s) spent):');
    expect(people.content).toContain('- 0. Dima Horshkov, Chief Product Officer — dima@limitless.exchange — found on https://limitless.exchange/team');
    expect(people.content).not.toContain('guess@limitless.exchange');
    expect(people.content).not.toContain('the-operators-key');
    // More providers attached: the seat names one. Tomba takes its key and secret together.
    expect(await act('merc', { type: 'sales/contacts', domain: 'limitless.exchange', source: 'tomba' })).toMatchObject({ status: 'error', error: expect.stringMatching(/one of the providers your operator attached \(hunter\)/) });
    Object.assign(process.env, { TOMBA_API_KEY: 'tk:ts', APOLLO_API_KEY: 'apollo-key' });
    const tomba = await act('merc', { type: 'sales/contacts', domain: 'limitless.exchange', source: 'tomba' });
    expect(tomba.content).toContain('- 0. Roberto Diaz, Founder — roberto@olivetree.example — found on https://olivetree.example/about');
    expect(tomba.content).not.toContain('nopage@');
    // The month's cap holds: Apollo may spend 5, 2 are spent, the cap is 3.
    expect(await act('merc', { type: 'sales/contacts', domain: 'limitless.exchange', source: 'apollo' })).toMatchObject({ status: 'denied', error: expect.stringMatching(/this month's cap is 3 credit\(s\) and 2 are spent; this lookup may spend 5/) });
    expect(hits.some((h) => h.startsWith('/apollo/'))).toBe(false);
    expect((await rule('paid-first', 10)).status).toBe(200);
    const apollo = await act('merc', { type: 'sales/contacts', domain: 'limitless.exchange', source: 'apollo' });
    expect(apollo.content).toContain('People at limitless.exchange (apollo, 2 credit(s) spent):');
    expect(apollo.content).toContain('- 0. Dima Horshkov, Chief Product Officer — dima@limitless.exchange — verified by apollo; their profile: https://www.linkedin.com/in/dima-h');
    expect(apollo.content).not.toContain('ann@limitless.exchange');
    expect(apollo.content).not.toContain('apollo-key');
    expect((await act('merc', { type: 'sales/contacts', domain: 'yo.xyz' })).content).toMatch(/hunter holds nobody at yo\.xyz/);
    // The operator reads what the month spent, counted from the lookups themselves.
    expect(await spend()).toMatchObject({ rule: { mode: 'paid-first', cap: 10 }, spent: 5, attached: ['hunter', 'tomba', 'apollo'] });
    expect((await spend()).lookups[0]).toMatchObject({ domain: 'yo.xyz', source: 'hunter', spent: 1, found: 0 });
    expect((await request(app).post('/api/v1/revenue/lead-engine/spend').send({ mode: 'ask', cap: 1 })).status).toBe(401);
  });
});
