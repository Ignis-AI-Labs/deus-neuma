/**
 * TOMBA AND APOLLO THROUGH THE SAME PIPELINE AS HUNTER (tomba-api.js, apollo-api.js, company-search.js,
 * address-check.js FINDERS/CHECKERS, lead-spend.js accounts) — Design note, 2026-11-18: […] With only Tomba and Apollo attached (no Hunter): DISCOVER gathers companies
 * through each one's company search under PAID LEAD DATA; the people at a fit company come top first and whatever
 * was paid for and not kept is said with why; one named person's address is found through either; the address is
 * checked by Tomba before a first email; each account says what it has left. The lists are served from this machine
 * in the shapes the two providers' documentation gives (read 2026-11-18); everything else is the real stack (RULE 0).
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
import { noteSites, readSearches, readCandidates, addCandidates, noteSearch } from '../../backend/services/sales/sales-store.js';
import { peopleOfTomba, checkOfTomba, accountOfTomba } from '../../backend/services/sales/tomba-api.js';
import { judgeApollo, accountOfApollo } from '../../backend/services/sales/apollo-api.js';
import { tombaQuery, apolloSearchQuery, bareDomain, pagesFor } from '../../backend/services/sales/company-search.js';
import { refusalWords } from '../../backend/services/sales/provider-call.js';
import { checkBeforeFirstEmail } from '../../backend/services/sales/address-check.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import http from 'node:http';
import { startLeadRun, leadRunOf } from '../../backend/services/sales/lead-run.js';
import { activeWork } from '../../backend/services/active-work.js';
import { salesIntents } from '../../backend/services/intents/sales-acts.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import { setRoute } from '../../backend/services/neuma-routes-store.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { readProspects } from '../../backend/services/sales/sales-store.js';

const { processToolCalls } = __test;
const KEYS = ['DNA_ENCRYPTION_KEY', 'NEUMA_CONNECTIONS_PATH', 'NEUMA_LEAD_SOURCE_TOMBA', 'NEUMA_LEAD_SOURCE_APOLLO', 'HUNTER_API_KEY', 'TOMBA_API_KEY', 'TOMBA_API_SECRET', 'APOLLO_API_KEY'];
const SAVED = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const PRIOR_ROOT = getWorkspacesRoot();

// Tomba, as docs.tomba.io shapes its answers.
const REVEAL_PAGE = { data: { companies: [
  { website_url: 'https://www.blockchaincapital.com', name: 'Blockchain Capital', industry: 'Venture Capital', company_size: '11-50', country: 'US', total_emails: 12, description: 'A crypto venture fund' },
  { website_url: 'panteracapital.com', name: 'Pantera Capital', industry: 'Venture Capital', company_size: '51-250', country: 'US', total_emails: 30 },
] }, meta: { total: 120, pages: 3, page: 1, filters: { industry: { include: ['venture capital'] } } } };
const TOMBA_PEOPLE = { data: { emails: [
  { email: 'alan@blockchaincapital.com', full_name: '', first_name: 'Alan', last_name: 'Curtis', position: 'CEO', seniority: 'executive', department: 'executive', score: 90, linkedin: 'https://www.linkedin.com/in/alan-curtis', sources: [], verification: { status: 'valid' } },
  { email: 'bart@blockchaincapital.com', full_name: 'Bart Stephens', position: 'Founder, Managing Partner', seniority: 'executive', score: 95, sources: [{ uri: 'https://blockchaincapital.com/team' }], verification: { status: 'accept_all' } },
  { email: 'nobody@blockchaincapital.com', full_name: 'No Page', position: 'Analyst', score: 99, sources: [], verification: { status: null } },
] } };
// Apollo, as docs.apollo.io shapes its answers: profiles written http://, a person it will not unlock, one who left.
const APOLLO_PEOPLE = { people: [{ id: 'a1', title: 'Founder', has_email: true }, { id: 'a2', title: 'Partner', has_email: true }, { id: 'a3', title: 'CEO', has_email: true }] };
const MATCH = {
  a1: { person: { name: 'Mike Novogratz', title: 'Founder', email: 'mike@galaxy.com', email_status: 'verified', linkedin_url: 'http://www.linkedin.com/in/mike-novogratz', match_confidence: 'high', organization: { primary_domain: 'galaxy.com' } } },
  a2: { person: { name: 'Locked Partner', title: 'Partner', email: 'email_not_unlocked@domain.com', email_status: 'verified', linkedin_url: 'http://www.linkedin.com/in/locked', match_confidence: 'high' } },
  a3: { person: { name: 'Gone Away', title: 'CEO', email: 'gone@otherco.com', email_status: 'verified', linkedin_url: 'http://www.linkedin.com/in/gone', match_confidence: 'high', organization: { primary_domain: 'otherco.com' } } },
};

describe('the providers, read as their documentation answers (pure)', () => {
  test('Tomba: executives first; an address on no page stands only when Tomba confirmed it, with the profile; the rest is counted, not hidden', () => {
    const { people, left } = peopleOfTomba(TOMBA_PEOPLE);
    expect(people.map((p) => [p.name, p.email, p.basis, p.sourceUrl])).toEqual([
      ['Alan Curtis', 'alan@blockchaincapital.com', 'verified', 'https://www.linkedin.com/in/alan-curtis'],
      ['Bart Stephens', 'bart@blockchaincapital.com', 'published', 'https://blockchaincapital.com/team'],
    ]);
    expect(left).toBe(1);
    expect(checkOfTomba({ data: { email: { status: 'valid', webmail: true, score: 80, mx_check: true } } })).toEqual({ status: 'webmail', score: 80, mx: true, smtp: false });
    expect(accountOfTomba({ data: { pricing: { name: 'Free' }, requests: { domains: { available: 25, used: 5 }, verifications: { available: 10, used: 1 } }, secret_token: 'ts_x' } })).toEqual({ plan: 'Free', used: 5, available: 25, checks: { used: 1, available: 10 } });
  });

  test('Apollo: an http profile is upgraded and kept; a locked address, an unverified one and one at a past employer are each said with why', () => {
    expect(judgeApollo(MATCH.a1, 'galaxy.com').person).toMatchObject({ name: 'Mike Novogratz', email: 'mike@galaxy.com', sourceUrl: 'https://www.linkedin.com/in/mike-novogratz', basis: 'verified' });
    expect(judgeApollo(MATCH.a2, 'galaxy.com').why).toBe('Locked Partner: Apollo did not unlock an address');
    expect(judgeApollo(MATCH.a3, 'galaxy.com').why).toBe('Gone Away: gone@otherco.com is at otherco.com, not galaxy.com — they may have left');
    expect(judgeApollo({ person: { ...MATCH.a1.person, email_status: 'guessed' } }, 'galaxy.com').why).toBe('Mike Novogratz: Apollo has not verified mike@galaxy.com (guessed)');
    expect(accountOfApollo({ credit_usage_stats: { lead_credit: { limit: 100, consumed: 10, left_over: 90 } } })).toEqual({ plan: 'current', used: 10, available: 100 });
  });

  test('a refusal is read from the body: Tomba answers a bad key with 400; an unknown status says what the provider said', () => {
    expect(refusalWords(400, { errors: { type: 'authentication_failed', message: 'Invalid key' } }, 'Tomba')).toBe('Tomba refused the key — check it in SETTINGS, API, Lead data');
    expect(refusalWords(403, { error_details: { code: 'API_INACCESSIBLE', message: 'not on your plan' } }, 'Apollo')).toBe('Apollo: this key\'s plan may not use this part of its API (not on your plan)');
    expect(refusalWords(418, { message: 'teapot' }, 'Tomba')).toBe('Tomba answered 418: teapot');
  });

  test('the company searches are asked as each provider reads them', () => {
    expect(tombaQuery({ words: 'crypto venture funds', keywords: ['web3'], sizes: ['11-50'] }, { countries: ['US'] })).toBe('crypto venture funds web3 in United States with 11-50 employees');
    expect(tombaQuery({ words: 'x'.repeat(150) }).length).toBeLessThanOrEqual(100);
    expect(apolloSearchQuery({ keywords: ['market making'], sizes: ['11-50', '10001+'] }, { countries: ['US'] })).toBe('q_organization_keyword_tags[]=market%20making&organization_locations[]=United%20States&organization_num_employees_ranges[]=11%2C50&organization_num_employees_ranges[]=10001%2C1000000&page=1&per_page=100');
    expect([bareDomain('https://www.Acme.io/about'), bareDomain('acme.io'), bareDomain('')]).toEqual(['acme.io', 'acme.io', null]);
    expect([pagesFor(undefined, 50), pagesFor(100, 50), pagesFor(10000, 100)]).toEqual([1, 2, 5]);
  });
});

describe('Tomba and Apollo through the real stack, with no Hunter attached', () => {
  let me, app, httpServer, wss, serverWs, client, lists;
  const hits = [];
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const conn = (neumaId) => ({ ws: serverWs, companion: { name: neumaId, neumaId }, walletAddress: me.address, sessionId: `sess-${neumaId}` });
  let filed = 0;
  const act = async (neumaId, payload) => {
    const dir = path.join(workspace.pathFor(neumaId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    filed += 1;
    await fs.writeFile(path.join(dir, `act-${filed}.json`), JSON.stringify(payload));
    const [result] = await processToolCalls(serverWs, '', conn(neumaId));
    return result;
  };
  const engine = async () => (await request(app).get('/api/v1/revenue/lead-engine').use(as)).body;
  const segmentId = async () => (await engine()).segments[0].id;
  const tomba = (req) => req.get('X-Tomba-Key') === 'tk' && req.get('X-Tomba-Secret') === 'ts';
  const apollo = (req) => req.get('x-api-key') === 'apollo-key';

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'lead-providers-test-key';
    useTempRealm();
    const tmp = await createTempDir('lead-providers');
    process.env.NEUMA_CONNECTIONS_PATH = path.join(tmp, 'connections.json');
    await fs.writeFile(process.env.NEUMA_CONNECTIONS_PATH, JSON.stringify({ 'lead-sources': true }));
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    await workspace.create('merc');
    await fs.writeFile(path.join(tmp, 'workspaces', 'merc', 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
    await fs.mkdir(path.join(tmp, 'workspaces', 'merc', 'identity'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'workspaces', 'merc', 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: `0x${'f'.repeat(40)}` }));
    const list = express();
    list.use(express.json());
    list.use((req, res, next) => { hits.push(`${req.method} ${req.originalUrl}`); next(); });
    list.use('/tomba', (req, res, next) => (tomba(req) ? next() : res.status(400).json({ errors: { type: 'authentication_failed', message: 'bad key' } })));
    list.use('/apollo', (req, res, next) => (apollo(req) ? next() : res.status(401).send('Invalid access credentials.')));
    // A free Tomba plan: a later page comes back as the first.
    list.post('/tomba/reveal/search', (req, res) => res.json(REVEAL_PAGE));
    list.get('/tomba/domain-search', (req, res) => res.json(req.query.domain === 'blockchaincapital.com' && req.query.department === 'executive,management' ? TOMBA_PEOPLE : { data: { emails: [] } }));
    list.get('/tomba/email-finder', (req, res) => res.json({ data: req.query.full_name === 'Bart Stephens' ? { email: 'bart@blockchaincapital.com', score: 97, position: 'Founder', verification: { status: 'valid' }, sources: [] }
      : req.query.full_name === 'Ana Ruiz' ? { email: 'ana@galaxy.com', score: 92, position: 'Partner', verification: { status: 'valid' }, sources: [] } : { email: null } }));
    // risky…: a server that takes any address — Tomba cannot confirm it, and Apollo does not either.
    const tombaSays = (email) => (email.startsWith('gone') ? 'invalid' : email.startsWith('risky') ? 'accept_all' : 'valid');
    list.get('/tomba/email-verifier', (req, res) => (req.query.email.startsWith('busy') ? res.status(429).json({}) : res.json({ data: { email: { status: tombaSays(req.query.email), score: 98, webmail: false, mx_check: true, smtp_check: true } } })));
    list.get('/tomba/me', (req, res) => res.json({ data: { pricing: { name: 'Free' }, requests: { domains: { available: 25, used: 5 }, verifications: { available: 10, used: 1 } }, secret_token: 'ts_NEVER_SHOWN' } }));
    // A search asked with a loose word: Apollo answers with a slice of everything it holds, the biggest first.
    list.post('/apollo/mixed_companies/search', (req, res, next) => (decodeURIComponent(req.url).includes('liquidity') ? res.json({ organizations: Array.from({ length: 100 }, (_, i) => ({ name: `Big Co ${i}`, primary_domain: `bigco${i}.example` })), pagination: { page: 1, per_page: 100, total_entries: 59388, total_pages: 594 } }) : next()));
    list.post('/apollo/mixed_companies/search', (req, res) => res.json({ organizations: [{ name: 'Galaxy', primary_domain: 'galaxy.com', linkedin_url: 'http://www.linkedin.com/company/galaxy', founded_year: 2018 }], pagination: { page: 1, per_page: 100, total_entries: 1, total_pages: 1 } }));
    list.post('/apollo/mixed_people/api_search', (req, res) => res.json([req.query.q_organization_domains_list].flat()[0] === 'galaxy.com' && req.query.person_seniorities ? APOLLO_PEOPLE : { people: [] }));
    list.post('/apollo/people/match', (req, res) => res.json(req.query.id ? MATCH[req.query.id] ?? {} : req.query.name === 'Mike Novogratz' && req.query.domain === 'galaxy.com' ? MATCH.a1 : {}));
    // Apollo's address check as its documentation answers (2026-11-19): 202 with a request id, then the result is asked
    // for — pending once (404 result_pending), then each row validated or not_validated.
    const verifying = new Map();
    list.post('/apollo/enrich', (req, res) => {
      const b = req.body ?? {};
      if (b.action !== 'email_verifier' || b.action_type !== 'tool' || b.poll_only !== true || b.webhook_url) return res.status(422).json({ status: 'rejected' });
      const id = String(7000 + verifying.size);
      verifying.set(id, { email: b.input_attributes?.[0]?.email, polls: 0 });
      return res.status(202).json({ request_id: id, status: 'accepted', total_submitted: 1, accepted_count: 1, rejected_count: 0, results: [{ status: 'accepted', record_id: `r${id}`, errors: null }] });
    });
    list.get('/apollo/webhook_result/:id', (req, res) => {
      const v = verifying.get(req.params.id);
      if (!v) return res.status(404).json({ error_code: 'request_id_unknown' });
      v.polls += 1;
      if (v.polls === 1) return res.status(404).json({ error_code: 'result_pending', retry_after_seconds: 1 });
      return res.json({ request_id: req.params.id, webhook_status: 'skipped', request_type: 'email', webhook_result: { status: 'success', results: [{ id: `r${req.params.id}`, email: v.email, validation_status: /^(maybe|risky)/.test(v.email) ? 'not_validated' : 'validated', validator: 'leadmagic' }] } });
    });
    list.post('/apollo/usage_stats/credit_usage_stats', (req, res) => res.json({ credit_usage_stats: { lead_credit: { limit: 100, consumed: 10, left_over: 90 } } }));
    lists = await new Promise((resolve) => { const s = list.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${lists.address().port}`;
    for (const k of ['HUNTER_API_KEY']) delete process.env[k];
    Object.assign(process.env, { NEUMA_LEAD_SOURCE_TOMBA: `${base}/tomba`, NEUMA_LEAD_SOURCE_APOLLO: `${base}/apollo`, TOMBA_API_KEY: 'tk', TOMBA_API_SECRET: 'ts', APOLLO_API_KEY: 'apollo-key' });
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
    expect((await act('merc', { type: 'sales/segment', name: 'Crypto funds', company: 'umbrae', offer: 'A pool for the tokens they back', customerProblem: 'Thin liquidity', targetRole: 'Partner', targetGeography: 'United States', countries: ['US'], positiveCriteria: ['Backs token projects'], why: 'They need depth for their portfolio' })).status).toBe('ok');
  }, 60000);

  afterAll(async () => {
    client?.close();
    wss?.close();
    httpServer?.close();
    await new Promise((resolve) => lists.close(resolve));
    setWorkspacesRoot(PRIOR_ROOT);
    for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('DISCOVER, people, one address, the check, and the accounts — each spending under the operator\'s rule, each said', async () => {
    // Paid company search waits on PAID LEAD DATA, like every paid lookup.
    expect(await act('merc', { type: 'sales/gather', segment: await segmentId(), source: 'tomba-discover', words: 'crypto venture funds' })).toMatchObject({ status: 'denied', error: expect.stringMatching(/PAID LEAD DATA is off/) });
    expect(hits.some((h) => h.includes('/reveal/'))).toBe(false);
    expect((await request(app).post('/api/v1/revenue/lead-engine/spend').use(as).send({ mode: 'on', cap: 50 })).status).toBe(200);

    // TOMBA'S COMPANY SEARCH: page 1 by the words, page 2 by the filters Tomba read; a free plan repeats page 1, which ends it.
    const reveal = await act('merc', { type: 'sales/gather', segment: await segmentId(), source: 'tomba-discover', words: 'crypto venture funds', count: 100 });
    expect(reveal.status, reveal.error).toBe('ok');
    expect(reveal.content).toMatch(/^2 new candidate\(s\) for "Crypto funds" from tomba-discover \(2 credit\(s\) spent\)/);
    expect(reveal.content).toContain('Blockchain Capital — blockchaincapital.com — Venture Capital · 11-50 people · US · 12 addresses at Tomba');
    expect((await readCandidates(me.address)).filter((c) => c.source === 'tomba-discover').map((c) => c.domain)).toEqual(['blockchaincapital.com', 'panteracapital.com']);
    // APOLLO'S COMPANY SEARCH: by keywords, in the audience's countries.
    expect(await act('merc', { type: 'sales/gather', segment: await segmentId(), source: 'apollo-discover', words: 'funds' })).toMatchObject({ status: 'error', error: expect.stringMatching(/Apollo searches companies by keywords/) });
    const apolloFound = await act('merc', { type: 'sales/gather', segment: await segmentId(), source: 'apollo-discover', keywords: ['crypto fund'] });
    expect(apolloFound.content).toMatch(/1 new candidate\(s\) for "Crypto funds" from apollo-discover \(1 credit\(s\) spent\)/);
    expect(hits.find((h) => h.includes('/mixed_companies/search'))).toContain('q_organization_keyword_tags[]=crypto%20fund&organization_locations[]=United%20States');
    expect((await readSearches(me.address)).map((s) => [s.source, s.spent])).toEqual([['tomba-discover', 2], ['apollo-discover', 0], ['apollo-discover', 1]]);

    // The people at a fit company: Tomba top first; Apollo's paid-for people not kept are each said, with why.
    for (const domain of ['blockchaincapital.com', 'galaxy.com']) {
      await noteSites(me.address, [{ domain, site: { alive: true, description: 'A crypto fund', emails: [], socials: {} } }], 'merc');
      expect((await act('merc', { type: 'sales/prospect', segment: await segmentId(), companies: [{ domain, name: domain, source: `https://${domain}`, country: 'US', scores: [{ criterion: 'Backs token projects', score: 4, reasoning: 'its portfolio page' }], people: [] }] })).status).toBe('ok');
    }
    const atTomba = await act('merc', { type: 'sales/contacts', domain: 'blockchaincapital.com' });
    expect(atTomba.content).toMatch(/^People at blockchaincapital\.com \(tomba, 1 credit\(s\) spent\), top first:\n- 0\. Alan Curtis, CEO/);
    expect(atTomba.content).toContain('Returned by tomba and not kept: 1 more address(es) stand on no page and are not confirmed.');
    const atApollo = await act('merc', { type: 'sales/contacts', domain: 'galaxy.com', source: 'apollo' });
    expect(atApollo.content).toContain('People at galaxy.com (apollo, 3 credit(s) spent), top first:\n- 0. Mike Novogratz, Founder — mike@galaxy.com (the address exists: checked) — verified by apollo; their profile: https://www.linkedin.com/in/mike-novogratz');
    expect(atApollo.content).toContain('Returned by apollo and not kept: Locked Partner: Apollo did not unlock an address; Gone Away: gone@otherco.com is at otherco.com, not galaxy.com — they may have left.');

    // ONE NAMED PERSON: the cheapest attached finder (Tomba, with no Hunter), or Apollo named.
    expect((await act('merc', { type: 'sales/find-address', domain: 'blockchaincapital.com', name: 'Bart Stephens' })).content).toBe('Bart Stephens at blockchaincapital.com: bart@blockchaincapital.com — the address exists (Tomba checked it) (1 credit spent). File them under people in sales/prospect with this address and that page, then sales/lead.');
    expect((await act('merc', { type: 'sales/find-address', domain: 'blockchaincapital.com', name: 'No One' })).content).toMatch(/^Tomba holds no address for No One at blockchaincapital\.com \(no credit spent\)/);
    expect((await act('merc', { type: 'sales/find-address', domain: 'galaxy.com', name: 'Mike Novogratz', source: 'apollo' })).content).toMatch(/^Mike Novogratz at galaxy\.com: mike@galaxy\.com — the address exists \(Apollo checked it\) \(1 credit spent\)/);
    expect(await act('merc', { type: 'sales/find-address', domain: 'galaxy.com', name: 'Mike Novogratz', source: 'hunter' })).toMatchObject({ status: 'error', error: expect.stringMatching(/one of the providers your operator attached \(tomba, apollo\)/) });

    // THE CHECK BEFORE A FIRST EMAIL, by Tomba when Hunter is not attached — live, even for Bart's address, which Tomba
    // gave as verified from its own records (a live answer outranks a stored flag).
    expect(await checkBeforeFirstEmail(me.address, ['Bart@blockchaincapital.com'])).toEqual({ refusal: null, notes: ['bart@blockchaincapital.com exists (Tomba checked it)'] });
    expect((await checkBeforeFirstEmail(me.address, ['gone@blockchaincapital.com'])).refusal).toMatch(/^the address gone@blockchaincapital\.com does not exist \(Tomba checked it\) — nothing was sent\./);

    // What it all cost, counted once, per partner; and what each account says it has left — never its secret.
    const board = await engine();
    expect(board.spend).toMatchObject({ spent: 11, attached: ['tomba', 'apollo'], accounts: { tomba: { plan: 'Free', used: 5, available: 25, checks: { used: 1, available: 10 } }, apollo: { used: 10, available: 100 } } });
    expect(board.spentBy).toEqual({ Tomba: 6, Apollo: 5 });
    expect(JSON.stringify(board)).not.toMatch(/ts_NEVER_SHOWN|apollo-key|"tk"/);
  }, 60000);

  test('a BOUNCE stands in the pipeline and its lead moves to the right address; every staged email\'s address is checked before it is sent (Design note, 2026-11-19', async () => {
    const { leadLedgerFor } = await import('../../backend/services/leads/lead-ledger.js');
    const { stageDraft } = await import('../../backend/services/sales/email-outbox.js');
    const ledger = await leadLedgerFor(me.address);
    const lead = await ledger.add({ name: 'Blockchain Capital Team', contact: 'team@blockchaincapital.com', channelId: 'email', kind: 'buyer', status: 'contacted', addedBy: 'merc' });
    await ledger.touch(lead.id, { status: 'lost', note: 'address bounced (mail #7240)', by: 'mail-watch' });
    // The pipeline says so: the lead is BOUNCED (not just closed), and the seat is asked to find the right address.
    const before = await engine();
    expect(before.leads.find((l) => l.id === lead.id).bounced).toMatchObject({ address: 'team@blockchaincapital.com' });
    expect(before.upkeep.find((u) => u.leadId === lead.id)).toMatchObject({ kind: 'bounced', address: 'team@blockchaincapital.com' });
    // A closed lead stays with its person — except one the bounce closed: it moves to the right address, cold again.
    const moved = await act('merc', { type: 'sales/lead', lead: lead.id, person: { name: 'Bart Stephens', role: 'Founder' }, email: 'bart@blockchaincapital.com', emailSource: 'https://blockchaincapital.com/team' });
    expect(moved.status, moved.error).toBe('ok');
    const after = (await ledger.load()).find((l) => l.id === lead.id);
    expect([after.status, after.contact]).toEqual(['cold', 'bart@blockchaincapital.com']);
    expect((await engine()).leads.find((l) => l.id === lead.id).bounced).toBe(null);
    // CHECK ADDRESSES: a staged email's address asked now, before anything is sent; the outbox shows what it said.
    const staged = await stageDraft(me.address, { to: ['new@blockchaincapital.com'], subject: 'Umbrae', text: 'Hello, the words of a staged email to the team.', by: 'merc' });
    const checked = await request(app).post('/api/v1/revenue/lead-engine/outbox/check').use(as).send({ ids: [staged.id] });
    expect(checked.body).toMatchObject({ ok: true, checked: 1, refused: [] });
    expect((await engine()).checks['new@blockchaincapital.com']).toMatchObject({ status: 'valid', checker: 'Tomba' });
  }, 60000);

  test('APOLLO CHECKS ADDRESSES TOO, and each address shows how many databases confirmed it — any one is enough, every one locks it in (Design note, 2026-11-19', async () => {
    const { stageDraft } = await import('../../backend/services/sales/email-outbox.js');
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { Outbox } = await import('../../frontend/app/RelinkShell/company-line/Outbox.jsx');
    const stage = (to) => stageDraft(me.address, { to: [to], subject: 'Umbrae', text: 'Hello, the words of a staged email to the fund.', by: 'merc' });
    const check = (ids, every) => request(app).post('/api/v1/revenue/lead-engine/outbox/check').use(as).send({ ids, ...(every ? { every: true } : {}) });
    expect((await engine()).checkers).toEqual(['Tomba', 'Apollo']);

    // Any one: Tomba (the cheaper) is busy, so Apollo answers — asked, waited on through its pending result, kept.
    const busy = await stage('busy@galaxy.com');
    expect((await check([busy.id])).body).toMatchObject({ checked: 1, refused: [] });
    expect((await engine()).checks['busy@galaxy.com']).toMatchObject({ status: 'valid', checker: 'Apollo', confirmedBy: ['Apollo'], checkedBy: ['Apollo'] });
    expect(hits.filter((h) => h.startsWith('GET /apollo/webhook_result/')).length).toBeGreaterThanOrEqual(2);

    // A LIVE ANSWER OUTRANKS A STORED FLAG (2026-11-19: mika.ohiorhenuan@flowtrackfund.com, given by Apollo as verified
    // from its own records, then "could not confirm" by Apollo's live check, went on the stored flag and hard-bounced).
    const sure = await stage('mike@galaxy.com');
    const { noteAddressCheck } = await import('../../backend/services/sales/sales-store.js');
    const { checkBeforeSending } = await import('../../backend/services/sales/address-check.js');
    expect((await engine()).checks['mike@galaxy.com']).toMatchObject({ status: 'valid', live: false, foundBy: ['Apollo'], checkedBy: [] });
    // Apollo's live check answers "could not confirm": the stored flag no longer counts, and a FIRST email is refused.
    await noteAddressCheck(me.address, { email: 'mike@galaxy.com', check: { status: 'unknown', score: 0, checker: 'Apollo' }, spent: 1, by: 'test' });
    expect((await engine()).checks['mike@galaxy.com']).toMatchObject({ status: 'unknown', live: true, confirmedBy: [], checkedBy: ['Apollo'], foundBy: ['Apollo'] });
    expect((await checkBeforeSending(me.address, ['mike@galaxy.com'], { requireConfirmed: true })).refusal).toMatch(/^the address mike@galaxy\.com is not confirmed \(could not be confirmed[\s\S]*a first email goes only to an address a database confirmed LIVE/);
    // LOCK IT IN: every attached database that has not answered live checks it now — Tomba confirms it.
    const every = (await check([sure.id], true)).body;
    expect(every).toMatchObject({ ok: true, every: true, asked: 1, problems: [] });
    expect(every.addresses).toEqual([{ email: 'mike@galaxy.com', status: 'valid', confirmedBy: ['Tomba'], checkedBy: ['Apollo', 'Tomba'] }]);
    expect((await check([sure.id], true)).body.asked).toBe(0); // nobody asked twice
    expect((await checkBeforeSending(me.address, ['mike@galaxy.com'], { requireConfirmed: true })).refusal).toBe(null);
    // An address standing on a stored flag alone is asked live before it is written to (here Tomba answers).
    const { noteContacts } = await import('../../backend/services/sales/sales-store.js');
    await noteContacts(me.address, 'galaxy.com', 'apollo', [{ name: 'Rae Store', role: 'Partner', email: 'rae@galaxy.com', confidence: 100, sourceUrl: 'https://www.linkedin.com/in/rae', basis: 'verified', checked: 'valid' }], 'merc', 1);
    const tombaAsked = hits.filter((h) => h.startsWith('GET /tomba/email-verifier')).length;
    expect((await checkBeforeSending(me.address, ['rae@galaxy.com'], { requireConfirmed: true })).refusal).toBe(null);
    expect(hits.filter((h) => h.startsWith('GET /tomba/email-verifier')).length).toBe(tombaAsked + 1);
    expect((await engine()).checks['rae@galaxy.com']).toMatchObject({ status: 'valid', live: true, confirmedBy: ['Tomba'], foundBy: ['Apollo'] });

    // Apollo never says "will bounce": not confirmed is RISKY and goes; when a database says it will bounce, that wins.
    const maybe = await stage('maybe@galaxy.com');
    await check([maybe.id], true);
    expect((await engine()).checks['maybe@galaxy.com']).toMatchObject({ status: 'valid', confirmedBy: ['Tomba'], checks: [{ checker: 'Tomba', status: 'valid' }, { checker: 'Apollo', status: 'unknown' }] });
    const gone = await stage('gone@galaxy.com');
    await check([gone.id], true);
    expect((await engine()).checks['gone@galaxy.com']).toMatchObject({ status: 'invalid', checker: 'Tomba', confirmedBy: ['Apollo'] });

    // The outbox: how many databases confirmed each, every answer on hover, and the button only while one has not asked.
    const board = await engine();
    const html = renderToStaticMarkup(createElement(Outbox, { outbox: board.outbox, leads: board.leads, busy: false, onSend: () => {}, onReturn: () => {}, onEdit: () => {}, checks: board.checks, checkers: board.checkers, onCheck: () => {} }));
    // mike@: Apollo's stored flag and its live "could not confirm" both shown; only Tomba's live answer confirms it.
    expect(html).toContain('Apollo: verified it when it found the address (');
    expect(html).toContain('Apollo: could not confirm it (');
    expect(html).toContain('VALID · 1 DATABASE');
    expect(html).toContain('WILL BOUNCE · APOLLO SAID VALID');
    expect(html).toContain('Tomba: valid (');
    expect(html).toContain('Apollo: valid (');
    expect(html).toContain('Apollo: not asked yet');
    expect(html).toMatch(/CHECK WITH EVERY DATABASE \(\d+\)/);
  }, 60000);

  test('CONFIRM OR FIND: an address no database confirms is asked of every one, then its person is looked for — moved when one is confirmed, SETTLED when none is, and nobody asks again (Design note, 2026-11-19', async () => {
    const { leadLedgerFor } = await import('../../backend/services/leads/lead-ledger.js');
    const { stageDraft, readOutbox } = await import('../../backend/services/sales/email-outbox.js');
    const { checkBeforeSending } = await import('../../backend/services/sales/address-check.js');
    const { addressNextStep } = await import('../../backend/services/intents/sales-hunter-acts.js');
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { Outbox } = await import('../../frontend/app/RelinkShell/company-line/Outbox.jsx');
    expect((await request(app).post('/api/v1/revenue/lead-engine/spend').use(as).send({ mode: 'on', cap: 300 })).status).toBe(200);
    const ledger = await leadLedgerFor(me.address);
    const lead = async (name, contact) => ledger.add({ name, contact, channelId: 'email', kind: 'buyer', status: 'cold', addedBy: 'merc' });
    const stage = async (to) => { await checkBeforeSending(me.address, [to], { by: 'merc' }); return stageDraft(me.address, { to: [to], subject: 'Umbrae', text: 'Hello, the words of a staged email to the fund.', by: 'merc' }); };
    const ana = await lead('Ana Ruiz, Partner at Galaxy', 'risky.ana@galaxy.com');
    await lead('Jane Doe', 'risky.jane@galaxy.com');
    await lead('Galaxy Partners Team', 'risky.team@galaxy.com');
    const [a, j, t] = [await stage('risky.ana@galaxy.com'), await stage('risky.jane@galaxy.com'), await stage('risky.team@galaxy.com')];
    // Staged, each reads RISKY (Tomba: its server takes any address), and the seat is told the one next step.
    expect((await engine()).checks['risky.ana@galaxy.com']).toMatchObject({ status: 'accept_all', checkedBy: ['Tomba'], settled: null });
    expect(addressNextStep('risky.ana@galaxy.com', (await engine()).checks['risky.ana@galaxy.com'])).toContain('run sales/confirm-address {email: "risky.ana@galaxy.com"} once');
    const before = await engine();
    const shown = renderToStaticMarkup(createElement(Outbox, { outbox: before.outbox, leads: before.leads, busy: false, onSend: () => {}, onReturn: () => {}, onEdit: () => {}, checks: before.checks, checkers: before.checkers, onCheck: () => {}, onConfirm: () => {} }));
    // The three, and the dead address an earlier case left (gone@, which no database will confirm either).
    expect(Number(/FIND CONFIRMED ADDRESSES \((\d+)\)/.exec(shown)?.[1])).toBeGreaterThanOrEqual(3);

    // The seat runs it on Ana: Apollo is asked too (not confirmed), so Ana Ruiz is looked for — Tomba finds ana@galaxy.com,
    // it is confirmed, and the lead and its waiting email move there by themselves.
    const found = await act('merc', { type: 'sales/confirm-address', email: 'risky.ana@galaxy.com' });
    expect(found.status, found.error).toBe('ok');
    expect(found.content).toMatch(/No database could confirm risky\.ana@galaxy\.com, so Ana Ruiz was looked for: Tomba found ana@galaxy\.com, and Tomba confirmed it/);
    expect((await ledger.load()).find((l) => l.id === ana.id).contact).toBe('ana@galaxy.com');
    expect((await readOutbox(me.address)).drafts.find((d) => d.id === a.id).to).toEqual(['ana@galaxy.com']);

    // The operator presses FIND CONFIRMED ADDRESSES for the other two: Jane is looked for and not found; the team names
    // nobody to look for. Both are SETTLED — NO DATABASE CAN CONFIRM — with who was asked and why.
    const pressed = (await request(app).post('/api/v1/revenue/lead-engine/outbox/confirm').use(as).send({ ids: [j.id, t.id] })).body;
    expect(pressed.results.map((r) => [r.email, r.outcome]).sort()).toEqual([['risky.jane@galaxy.com', 'settled'], ['risky.team@galaxy.com', 'settled']]);
    const after = await engine();
    expect(after.checks['risky.jane@galaxy.com'].settled).toMatchObject({ outcome: 'unconfirmable', checkedBy: ['Tomba', 'Apollo'], findersAsked: ['Tomba', 'Apollo'], tried: [] });
    expect(after.checks['risky.team@galaxy.com'].settled).toMatchObject({ outcome: 'unconfirmable', findersAsked: [], why: expect.stringContaining('names no person') });

    // Nobody asks again: the seat is answered from the record, spending nothing; the stage receipt says stop.
    const spentBefore = (await engine()).spend.spent;
    const again = await act('merc', { type: 'sales/confirm-address', email: 'risky.jane@galaxy.com' });
    expect(again).toMatchObject({ status: 'denied', error: expect.stringMatching(/^NO DATABASE CAN CONFIRM risky\.jane@galaxy\.com \(settled \d{4}-\d{2}-\d{2}\): asked Tomba, Apollo; looked for the person with Tomba, Apollo, which found no other address\. Do not check it or look for it again/) });
    expect(addressNextStep('risky.jane@galaxy.com', after.checks['risky.jane@galaxy.com'])).toContain('NO DATABASE CAN CONFIRM');
    expect((await request(app).post('/api/v1/revenue/lead-engine/outbox/confirm').use(as).send({ ids: [j.id] })).body.results[0].outcome).toBe('settled');
    expect((await engine()).spend.spent).toBe(spentBefore);

    // The outbox says it once, for good, with what was tried on hover; the button is gone for them.
    const html = renderToStaticMarkup(createElement(Outbox, { outbox: after.outbox, leads: after.leads, busy: false, onSend: () => {}, onReturn: () => {}, onEdit: () => {}, checks: after.checks, checkers: after.checkers, onCheck: () => {}, onConfirm: () => {} }));
    expect(html).toContain('NO DATABASE CAN CONFIRM');
    expect(html).toContain('data-address-check="settled"');
    expect(html).toContain('Nobody asks again. Send it as it is, or write to someone else at the company.');
    expect(Number(/FIND CONFIRMED ADDRESSES \((\d+)\)/.exec(html)?.[1] ?? 0)).toBe(Number(/FIND CONFIRMED ADDRESSES \((\d+)\)/.exec(shown)?.[1]) - 3);
  }, 90000);
  test('a caller that needs ONE person pays for one: Apollo stops revealing at the first address that stands (the first live lead run paid for five a company)', async () => {
    const reveals = () => hits.filter((h) => h.includes('/apollo/people/match')).length;
    const before = reveals();
    const one = await act('merc', { type: 'sales/contacts', domain: 'galaxy.com', source: 'apollo', people: 1 });
    expect(one.status, one.error).toBe('ok');
    expect(reveals() - before).toBe(1);
    expect(one.content).toMatch(/People at galaxy\.com \(apollo, 1 credit\(s\) spent\), top first:/);
    expect((await act('merc', { type: 'sales/contacts', domain: 'galaxy.com', source: 'apollo' })).content).toMatch(/3 credit\(s\) spent/); // asked with no number, the seat still sees everyone
    expect(reveals() - before).toBe(1 + 3);
  }, 60000);

  test('A SEARCH TOO WIDE KEEPS NOTHING and stops after its first page; what such searches already brought is passed over in one press (Design note, 2026-11-21', async () => {
    const segment = await segmentId();
    const before = (await readCandidates(me.address)).length;
    const pagesBefore = hits.filter((h) => h.includes('/mixed_companies/search')).length;
    const wide = await act('merc', { type: 'sales/gather', segment, source: 'apollo-discover', keywords: ['liquidity'], count: 500 });
    expect(wide.status).toBe('error');
    expect(wide.error).toMatch(/That search matched 59,388 companies at apollo-discover — more than 10,000 is not this audience/);
    expect(wide.error).toContain('NOTHING WAS KEPT (1 credit(s) spent on the look).');
    expect((await readCandidates(me.address)).length).toBe(before); // not one of the hundred it returned
    expect(hits.filter((h) => h.includes('/mixed_companies/search')).length - pagesBefore).toBe(1); // five pages were asked for; one was paid for
    expect((await readSearches(me.address)).at(-1)).toMatchObject({ source: 'apollo-discover', matched: 59388, gathered: 0, spent: 1 });

    // Before the rule, such a search kept its first page. Two of its companies, one already read by the seat.
    await addCandidates(me.address, segment, [{ source: 'apollo-discover', domain: 'dentsu.example', name: 'Dentsu' }, { source: 'apollo-discover', domain: 'freddie.example', name: 'Freddie' }], 'merc');
    await noteSites(me.address, [{ domain: 'freddie.example', site: { alive: true, description: 'A lender.' } }], 'merc');
    await noteSearch(me.address, { segmentId: segment, source: 'apollo-discover', asked: 'venture capital', matched: 136449, gathered: 2, spent: 5, by: 'merc' });
    expect((await engine()).wide).toEqual({ searches: 1, companies: 2, left: 1, limit: 10000 });
    expect((await request(app).post('/api/v1/revenue/lead-engine/searches/pass-wide')).status).toBe(401);
    const pressed = await request(app).post('/api/v1/revenue/lead-engine/searches/pass-wide').use(as);
    expect(pressed.body).toMatchObject({ ok: true, passed: 1, wide: { searches: 1, companies: 2, left: 0 } });
    const after = await readCandidates(me.address);
    expect(after.find((c) => c.domain === 'dentsu.example')).toMatchObject({ shortlist: 'passed', shortlistWhy: 'from a search too wide to be this audience\'s: it matched 136,449 at Apollo ("venture capital")' });
    expect(after.find((c) => c.domain === 'freddie.example').shortlist).toBeUndefined(); // the seat had already read it: left for the seat
    expect((await request(app).post('/api/v1/revenue/lead-engine/searches/pass-wide').use(as)).body.passed).toBe(0);
  }, 60000);
  test('THE LEAD RUN: gathered companies are read, screened from their own page, filed through the seat\'s own acts, and each fit ends as a lead with a confirmed address — several at once, nothing by hand (Design note, 2026-11-21', async () => {
    const segment = await segmentId();
    const seg = (await engine()).segments.find((x) => x.id === segment);
    const asked = [];
    const llm = http.createServer((req, res) => {
      if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'screen-model', type: 'llm', max_context_length: 32768, loaded_context_length: 32768 }] })); return; }
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const prompt = JSON.parse(raw).messages.at(-1).content;
        asked.push(prompt);
        const fund = /invest in early crypto networks/.test(prompt);
        const scores = Object.fromEntries([...seg.positiveCriteria.map((_, n) => [`F${n + 1}`, { score: fund ? 5 : 0, why: fund ? 'its page says it invests in early crypto networks' : 'its page sells running shoes and shows no such thing' }]), ...(seg.negativeCriteria ?? []).map((_, n) => [`D${n + 1}`, { score: 0, why: 'nothing on the page shows this at all' }])]);
        const answer = JSON.stringify({ name: fund ? 'Fund Alpha' : 'Shop Co', what: fund ? 'A venture fund for early crypto networks.' : 'An online shoe shop.', country: 'US', scores });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `Here it is: ${answer}` } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise((resolve) => llm.listen(0, '127.0.0.1', resolve));
    const priorConfig = getConfig();
    setConfig({ provider: 'lm-studio', endpoint: `http://127.0.0.1:${llm.address().port}`, apiKey: '', model: 'screen-model' });
    await setCredential('lm-studio', { apiKey: 'fixture-only', endpoint: getConfig().endpoint });
    await setRoute('merc', { provider: 'lm-studio', model: 'screen-model' });
    const pages = {
      'https://fundalpha.example/': '<html><head><title>Fund Alpha</title></head><body><p>We invest in early crypto networks and the teams building them.</p><p>Write to the partners: partners@fundalpha.example</p></body></html>',
      'https://fundbeta.example/': '<html><head><title>Fund Beta</title></head><body><p>We invest in early crypto networks across Asia and the Americas.</p><p>Reach the team: team@fundbeta.example</p></body></html>',
      'https://shopco.example/': '<html><head><title>Shop Co</title></head><body><p>Running shoes for every distance, shipped across the country.</p><p>Questions? hello@shopco.example</p></body></html>',
    };
    const fetchPage = async (url) => (pages[url] ? { ok: true, url, html: pages[url] } : { ok: false, why: 'the address does not exist' });
    await addCandidates(me.address, segment, [{ source: 'apollo-discover', domain: 'fundalpha.example', name: 'Fund Alpha' }, { source: 'apollo-discover', domain: 'shopco.example', name: 'Shop Co' }, { source: 'apollo-discover', domain: 'deadco.example', name: 'Dead Co' }, { source: 'apollo-discover', domain: 'fundbeta.example', name: 'Fund Beta' }], 'merc');
    const leadsBefore = (await (await leadLedgerFor(me.address)).load()).length;
    // WAITING FOR VALIDATION: two companies the seat scored a fit by hand earlier. A run validates them first, from their own pages.
    const byHand = (domain, name) => ({ domain, name, country: 'US', source: `https://${domain}/`, scores: seg.positiveCriteria.map((criterion) => ({ criterion, score: 5, reasoning: 'scored by hand, from memory' })) });
    pages['https://handgood.example/'] = '<html><body><p>We invest in early crypto networks from our first fund, and we stay with founders for a decade.</p></body></html>';
    pages['https://handbad.example/'] = '<html><body><p>Hand-made leather bags, stitched to order in our workshop and shipped anywhere in the country.</p></body></html>';
    if (seg.state !== 'approved') {
      expect((await startLeadRun(me.address, { segmentId: segment }, { intents: salesIntents, fetchPage })).reason).toMatch(/is draft, not approved — the operator approves an audience before a run works it/);
      expect((await request(app).post(`/api/v1/revenue/lead-engine/segments/${segment}/state`).use(as).send({ state: 'approved' })).status).toBe(200);
    }

    expect((await act('merc', { type: 'sales/prospect', segment, companies: [byHand('handgood.example', 'Hand Good'), byHand('handbad.example', 'Hand Bad')] })).status).toBe('ok');
    const started = await startLeadRun(me.address, { segmentId: segment, want: 50, credits: 1 }, { intents: salesIntents, fetchPage, width: 1 });
    expect(started.ok, started.reason).toBe(true);
    expect((await startLeadRun(me.address, { segmentId: segment }, { intents: salesIntents, fetchPage })).reason).toMatch(/already working/);
    // While it works it stands in the house's ACTIVE list (the tray's ACTIVE tab reads it); ended, it has left.
    expect(activeWork(me.address)).toEqual([expect.objectContaining({ kind: 'LEAD RUN', title: expect.stringMatching(/^\d+ of 50 leads — /), open: { appId: 'positions', office: 'cro', tab: 'discover' } })]);
    const ended = await started.done;
    expect(activeWork(me.address)).toEqual([]);
    await new Promise((resolve) => llm.close(resolve));
    setConfig(priorConfig);

    // Fund Beta is a fit too, screened last: by then the run's own credit was spent confirming Fund Alpha's address, so nobody is looked up for it.
    expect(ended.counts).toMatchObject({ screened: 3, fit: 2, nofit: 1, unclear: 0, leads: 1, spentStop: 'this run\'s own limit of 1 credits was reached' });
    expect(ended.spent).toBeGreaterThanOrEqual(1);
    expect(ended.counts.noAddress).toBeGreaterThanOrEqual(1); // Fund Beta, and any fit the earlier tests left without a person
    expect(ended.counts.dead).toBe(ended.counts.looked - 3);
    expect(ended.counts.dead).toBeGreaterThanOrEqual(1);
    expect(ended.active).toBe(false);
    expect(asked).toHaveLength(5);
    // Validated first: the one its page shows to be a fund HOLDS (on the approved list by itself); the one that sells bags is OUT, with why.
    expect(ended.counts).toMatchObject({ held: 1, out: 1, left: ended.counts.checked - 2 }); // what earlier tests left has no page here: left as it stood
    expect((await readProspects(me.address)).find((p) => p.domain === 'handgood.example')).toMatchObject({ stage: 'found', listApproved: true, fit: expect.arrayContaining([expect.objectContaining({ reasoning: 'its page says it invests in early crypto networks' })]) }); // the record carries the page's scores, not the hand's
    expect((await readProspects(me.address)).find((p) => p.domain === 'handbad.example')).toMatchObject({ stage: 'dropped' });
    expect(asked.find((a) => a.includes('fundalpha.example'))).toContain('We invest in early crypto networks and the teams building them.');
    const pool = await readProspects(me.address);
    expect(pool.find((p) => p.domain === 'fundalpha.example')).toMatchObject({ name: 'Fund Alpha', match: 3, stage: 'promoted', country: 'US', source: 'https://fundalpha.example/', foundBy: 'merc' });
    expect(pool.find((p) => p.domain === 'shopco.example')).toMatchObject({ match: 1, stage: 'found' });
    expect(pool.find((p) => p.domain === 'fundalpha.example').listApproved).toBe(true);
    expect(pool.find((p) => p.domain === 'shopco.example').listApproved).toBeFalsy();
    const asks = hits.filter((h) => h.includes('fundalpha.example') && /api_search|domain-search/.test(h)).map((h) => (h.includes('/apollo/') ? 'apollo' : 'tomba'));
    expect([...new Set(asks)]).toEqual(['apollo', 'tomba']);
    const leads = await (await leadLedgerFor(me.address)).load();
    expect(leads).toHaveLength(leadsBefore + 1);
    expect(leads.at(-1)).toMatchObject({ contact: 'partners@fundalpha.example', status: 'cold', kind: 'buyer', ownerNeumaId: 'merc', source: expect.stringContaining('address: https://fundalpha.example/') });
    expect((await engine()).checks['partners@fundalpha.example']).toMatchObject({ status: 'valid' });
    expect((await readCandidates(me.address)).find((c) => c.domain === 'deadco.example')).toMatchObject({ shortlist: 'passed', shortlistWhy: 'its site is dead or cannot be reached' });
    expect((await request(app).get('/api/v1/revenue/lead-engine/run').use(as)).body.run).toMatchObject({ segment: seg.name, active: false, credits: 1, ended: 'the spending rule stopped the lookups: this run\'s own limit of 1 credits was reached' });
    expect((await readProspects(me.address)).find((p) => p.domain === 'fundbeta.example')).toMatchObject({ match: 3, stage: 'found' }); // scored, waiting for the next run
    expect(leadRunOf(me.address).words).toMatch(/^\d+ waiting validated \(1 hold, 1 out, \d+ left as they stood\) · \d+ looked at · \d+ dead or unreadable · 3 screened \(2 a fit, 0 a fit only on the side signs, 1 no fit\) · 0 could not be screened · 1 lead\(s\) with a confirmed address · \d+ a fit with no confirmed address yet/);
  }, 120000);
});
