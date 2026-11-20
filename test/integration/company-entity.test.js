/**
 * WHAT A COMPANY IS, before a funding campaign writes to it (company-entity.js, sales/entity, the funding gates in
 * sales/prospect, sales/lead and the email formula). 2026-11-19: […] — a Thai robotics company —
 * was scored a fit for a FUNDING audience because "Ventures" is in its name, and a raise email was staged to a company
 * that will never write a SAFE. Founder: […]
 * Real stores, the seat's real acts through the real sweep (made-up .example domains: no real site is ever asked), the
 * quote checked against a real page served on loopback
 * (the web guard refuses this machine by design, so the page is handed over by a plain request, as company-reader's
 * test does); nothing mocked (RULE 0).
 */
/* global URL, fetch */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import http from 'node:http';
import os from 'os';
import path from 'path';
import process from 'node:process';
import { makeEntity, verifyQuote, isFundingCampaign, entityRefusal } from '../../backend/services/sales/company-entity.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { fileSegment, setSegmentState, openCampaign, setSegmentCampaign, addProspects, readProspects, reviewEmailPlan, noteAddressCheck } from '../../backend/services/sales/sales-store.js';
import { makeSegment } from '../../backend/services/sales/segment-shape.js';
import { makeProspect } from '../../backend/services/sales/prospect-shape.js';
import { makeCampaign } from '../../backend/services/sales/campaign-shape.js';
import { stageDraft, readOutbox } from '../../backend/services/sales/email-outbox.js';
import { formulaEmail } from '../../backend/services/sales/formula-gates.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { croDesignation } from '../../backend/services/revenue/cro-designation.js';
import { rigFor } from '../helpers/sales-mail-kit.js';
import { usePositionHouse, ownLane, POSITION_HOUSE } from '../helpers/position-house.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const ARV = 'AI and Robotics Ventures builds AI and robotics across aerial, ground, and subsea ecosystems.';

describe('the record, read from its own words (pure, and its page)', () => {
  test('"Ventures" in a name is not evidence; its own words decide; the page is on its own site', () => {
    expect(() => makeEntity({ domain: 'arv.example', name: 'AI and Robotics Ventures', entityType: 'vc-fund', quote: ARV, source: 'https://arv.example/about' }))
      .toThrow(/for an investor, its own words must say it invests[\s\S]*its name is not evidence[\s\S]*product-company/);
    expect(makeEntity({ domain: 'arv.example', name: 'AI and Robotics Ventures', entityType: 'product-company', quote: ARV, source: 'https://arv.example/about' }).entityType).toBe('product-company');
    // A name that says "fund" proves nothing either: it is taken out before the words are read.
    expect(() => makeEntity({ domain: 'seedfund.example', name: 'Seed Fund Partners', entityType: 'vc-fund', quote: 'Seed Fund Partners is a team of twelve in Jakarta.', source: 'https://seedfund.example/' })).toThrow(/must say it invests/);
    expect(makeEntity({ domain: 'fund.example', name: 'Fund Capital', entityType: 'vc-fund', quote: 'We invest at pre-seed and seed in AI infrastructure teams.', source: 'https://www.fund.example/about' }).entityType).toBe('vc-fund');
    expect(() => makeEntity({ domain: 'fund.example', entityType: 'vc-fund', quote: 'We invest at pre-seed and seed in AI teams.', source: 'https://crunchbase.example/fund' })).toThrow(/source: the https page on its OWN site/);
    expect(() => makeEntity({ domain: 'fund.example', entityType: 'bank', quote: 'We invest at pre-seed and seed.', source: 'https://fund.example/' })).toThrow(/entityType: what the company IS/);
  });

  test('which campaigns raise money: the email plan says so, else the name or goal does', () => {
    expect(isFundingCampaign({ name: 'Neuma raise', goal: 'Close the seed round with AI funds' })).toBe(true);
    expect(isFundingCampaign({ name: 'Neuma UA', goal: 'Users for the harness' })).toBe(false);
    expect(isFundingCampaign({ name: 'Liquidity', goal: 'Bring capital into the pools' })).toBe(false);
    expect(isFundingCampaign({ name: 'Partners', goal: 'x', emailPlan: { approved: { objective: 'funding' } } })).toBe(true);
    expect(isFundingCampaign({ name: 'Raise awareness', goal: 'x', emailPlan: { proposed: { objective: 'customers' } } })).toBe(false);
    expect(entityRefusal(null, 'arv.example')).toMatch(/^say what arv\.example IS first, from its own site: sales\/entity/);
  });

  test('the quote must stand on its page: there, checked; not there, refused; a page that cannot be read, kept unchecked', async () => {
    const pages = { '/fund.example/about': '<html><body><h1>Fund Capital</h1><p>We invest at pre-seed and seed in AI infrastructure teams.</p></body></html>' };
    const server = http.createServer((req, res) => { const p = pages[req.url]; res.writeHead(p ? 200 : 404, { 'content-type': 'text/html' }); res.end(p ?? 'gone'); });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const fetchPage = async (url) => { const u = new URL(url); const r = await fetch(`${base}/${u.hostname}${u.pathname}`); return r.status === 200 ? { ok: true, url, html: await r.text() } : { ok: false, why: `it answered ${r.status}` }; };
    try {
      expect(await verifyQuote({ source: 'https://fund.example/about', quote: 'We invest at pre-seed and seed in AI infrastructure teams.' }, { fetchPage })).toEqual({ ok: true, verified: true, why: null });
      expect(await verifyQuote({ source: 'https://fund.example/about', quote: 'We invest in late-stage growth rounds.' }, { fetchPage })).toMatchObject({ ok: false, why: expect.stringMatching(/the quote is not on https:\/\/fund\.example\/about/) });
      expect(await verifyQuote({ source: 'https://fund.example/team', quote: 'We invest at seed.' }, { fetchPage })).toMatchObject({ ok: true, verified: false, why: expect.stringMatching(/could not be read to check the quote \(it answered 404\)/) });
    } finally {
      await new Promise((resolve) => { server.close(resolve); });
    }
  });
});

describe('the gates, through the seat\'s acts', () => {
  const LANE = 'mercentity';
  let dir; let position; let funding; let raiseId; let filed = 0;
  const priorRoot = process.env.WORKSPACES_ROOT;
  const actAs = async (type, payload) => {
    filed += 1;
    const intents = path.join(workspace.pathFor(LANE), 'intents');
    await fsp.mkdir(intents, { recursive: true });
    await fsp.writeFile(path.join(intents, `act-${filed}.json`), JSON.stringify({ type, ...payload }));
    return (await sweepIntents(rigFor(LANE, POSITION_HOUSE).connection, { mode: 'ask', lanePolicy: null, emit: () => {} }))[0];
  };
  const company = (domain, name, extra = {}) => ({ domain, name, country: 'TH', source: `https://${domain}/`, scores: [{ criterion: 'Invests in AI at seed', score: 5, reasoning: 'its site says so' }], ...extra });

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'company-entity-'));
    process.env.WORKSPACES_ROOT = dir;
    position = usePositionHouse(dir);
    await workspace.create(LANE);
    await ownLane(LANE);
    await croDesignation.designate(POSITION_HOUSE, LANE);
    const now = new Date().toISOString();
    funding = makeSegment({ name: 'AI seed funds', offer: 'The Neuma seed round', company: 'ignis', customerProblem: 'They need AI teams already shipping', targetRole: 'Partner', targetGeography: 'Thailand', countries: ['TH'], positiveCriteria: ['Invests in AI at seed'], why: 'Their thesis is ours', by: LANE, now });
    await fileSegment(POSITION_HOUSE, funding);
    await setSegmentState(POSITION_HOUSE, funding.id, 'approved', 'operator');
    const raise = makeCampaign({ name: 'Neuma raise', company: 'ignis', goal: 'Close the seed round with AI funds', by: 'operator', now });
    await openCampaign(POSITION_HOUSE, raise);
    raiseId = raise.id;
    await setSegmentCampaign(POSITION_HOUSE, funding.id, raise.id, 'operator');
  }, 60000);
  afterAll(() => {
    position?.restore();
    if (priorRoot === undefined) delete process.env.WORKSPACES_ROOT; else process.env.WORKSPACES_ROOT = priorRoot;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a funding audience scores only what it knows the company IS: none said, refused; a product company, filed as NO FIT; a fund, scored', async () => {
    const none = await actAs('sales/prospect', { segment: funding.id, companies: [company('arv.example', 'AI and Robotics Ventures')] });
    expect(none.error).toMatch(/this audience serves a FUNDING campaign — say what the company IS from its own site: entityType and entityEvidence \{quote, source\} \(its name is not evidence\)/);
    const named = await actAs('sales/prospect', { segment: funding.id, companies: [company('arv.example', 'AI and Robotics Ventures', { entityType: 'vc-fund', entityEvidence: { quote: ARV, source: 'https://arv.example/about' } })] });
    expect(named.error).toMatch(/must say it invests/);
    const filed1 = await actAs('sales/prospect', { segment: funding.id, companies: [
      company('arv.example', 'AI and Robotics Ventures', { entityType: 'product-company', entityEvidence: { quote: ARV, source: 'https://arv.example/about' } }),
      company('fund.example', 'Fund Capital', { entityType: 'vc-fund', entityEvidence: { quote: 'We invest at pre-seed and seed in AI infrastructure teams.', source: 'https://fund.example/about' } }),
    ] });
    expect(filed1.status, filed1.error).toBe('ok');
    expect(filed1.content).toMatch(/AI and Robotics Ventures \(NO FIT — not an investor: product-company; its research stays for a customer campaign\)/);
    expect(filed1.content).toMatch(/Fund Capital \(strong\)/);
    const pool = await readProspects(POSITION_HOUSE);
    expect(pool.find((p) => p.domain === 'arv.example')).toMatchObject({ match: 1, notInvestor: 'product-company' });
  }, 60000);

  test('a company scored before the rule says what it is before it becomes a lead; one found not to invest leaves every funding audience, its funding email withdrawn, and the formula refuses it', async () => {
    const now = new Date().toISOString();
    const [old] = (await addProspects(POSITION_HOUSE, [makeProspect({ segment: funding, ...company('oldfund.example', 'Old Ventures'), people: [{ name: 'Pat Old', role: 'Partner', sourceUrl: 'https://oldfund.example/team' }], by: LANE, now })])).added;
    const asLead = await actAs('sales/lead', { id: old.id, person: 0, email: 'pat@oldfund.example', emailSource: 'https://oldfund.example/team' });
    expect(asLead.error).toMatch(/^say what oldfund\.example IS first, from its own site: sales\/entity/);
    // Its own site says it builds software: it is a product company, and it leaves the funding audience by itself.
    const lead = await (await leadLedgerFor(POSITION_HOUSE)).add({ name: 'Pat Old, Partner at Old Ventures', contact: 'pat@oldfund.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: LANE, source: `lead engine [${funding.id}]` });
    const waiting = await stageDraft(POSITION_HOUSE, { to: ['pat@oldfund.example'], subject: 'Neuma seed round', text: 'Hello, the raise.', by: LANE });
    const said = await actAs('sales/entity', { domain: 'oldfund.example', name: 'Old Ventures', entityType: 'product-company', quote: 'Old Ventures builds scheduling software for clinics.', source: 'https://oldfund.example/' });
    expect(said.status, said.error).toBe('ok');
    expect(said.content).toMatch(/NOT AN INVESTOR — no fit for any funding campaign: taken out of 1 funding audience; the funding email waiting for it \[m-[0-9a-f]{8}\] is withdrawn/);
    expect(said.content).toMatch(/NOT CHECKED: the page could not be read/); // a made-up domain has no page to read
    expect((await readProspects(POSITION_HOUSE)).find((p) => p.id === old.id)).toMatchObject({ stage: 'dropped', dropReason: 'not an investor (product-company) — no fit for a funding campaign' });
    expect((await readOutbox(POSITION_HOUSE)).drafts.find((d) => d.id === waiting.id)).toMatchObject({ state: 'withdrawn' });
    // The formula's gate: a funding email to it is refused before a word is written (its address checked, its plan locked in).
    await noteAddressCheck(POSITION_HOUSE, { email: 'pat@oldfund.example', check: { status: 'valid', score: 99, checker: 'Hunter' }, spent: 0, by: 'test' });
    const plan = await actAs('sales/email-plan', { campaign: raiseId, objective: 'funding', need: 'Seed funds backing AI want teams already shipping to users.', offer: 'Neuma runs AI on the user\'s own machine, live today.', asks: [{ ask: 'Shall I send the deck and the round\'s terms?', delivers: 'the deck and the round\'s terms' }], signature: 'The Mercator' });
    expect(plan.status, plan.error).toBe('ok');
    expect((await reviewEmailPlan(POSITION_HOUSE, raiseId, { verdict: 'approved', note: '', by: 'operator' })).ok).toBe(true);
    const built = await formulaEmail(POSITION_HOUSE, { lead, to: 'pat@oldfund.example', payload: {}, by: LANE });
    expect(built.refusal).toMatch(/^oldfund\.example is a company that builds or sells a product \("Old Ventures builds scheduling software for clinics\."[\s\S]*NOT AN INVESTOR: no funding email to it/);
  }, 60000);
});
