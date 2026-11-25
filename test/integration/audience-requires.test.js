/**
 * WHAT AN AUDIENCE REQUIRES, SET ON THE DESK AND PROVED BY A RUN (routes/lead-audience-routes.js, sales/lead-run.js
 * PROVE, intents/sales-prove-acts.js leaveAudience) — Design note, 2026-11-21: funds that invest in nothing crypto were filed
 * as leads of the crypto-funds audience (Kleiner Perkins, GV, Bessemer scored 5 for […]), and
 * […]
 *
 * The operator sets a hard condition on the audience; it stands at once. The next lead run proves every company
 * already filed, from its own page, by the page's own words: the crypto fund stays; the general fund — and its lead,
 * nobody written to yet — MOVES to the audience it belongs to. A real house on tmp disk, the real seat, routes,
 * stores and acts (RULE 0); pages are handed to the run as the house's reader would return them.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { fileSegment, setSegmentState, addProspects, settleProspect, listScreened, readProspects, readSegments } from '../../backend/services/sales/sales-store.js';
import { makeSegment } from '../../backend/services/sales/segment-shape.js';
import { makeProspect } from '../../backend/services/sales/prospect-shape.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { leadOrigins } from '../../backend/services/sales/campaign-shape.js';
import { firstEmailScreen } from '../../backend/services/sales/lead-screen.js';
import { startLeadRun } from '../../backend/services/sales/lead-run.js';
import { salesIntents } from '../../backend/services/intents/sales-acts.js';
import { screenMessages } from '../../backend/services/sales/lead-run-shape.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const SIGN = 'It invests in crypto, blockchain or web3 projects';
const PAGES = {
  'https://cryptofund.example/': '<html><head><title>Crypto Fund</title></head><body><p>We are an early-stage venture fund. We invest in crypto networks and the teams building them, from the first check.</p></body></html>',
  'https://bigvc.example/': '<html><head><title>Big VC</title></head><body><p>We are a venture capital firm with 450 active portfolio companies. We back founders building enduring software companies.</p></body></html>',
  'https://later.example/': '<html><head><title>Later</title></head><body><p>We are a growth fund with a portfolio of consumer brands across the country, backed since the first round.</p></body></html>',
};

describe('the operator says what an audience requires; a run proves every company already filed and moves the ones that fail', () => {
  let me, app, crypto, general;
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const engine = async () => (await request(app).get('/api/v1/revenue/lead-engine').use(as)).body;
  const put = (id, required) => request(app).put(`/api/v1/revenue/lead-engine/segments/${id}/required`).use(as).send({ required });
  const lead = async (segment, domain, name, { emailed = false } = {}) => {
    const now = new Date().toISOString();
    const [prospect] = (await addProspects(me.address, [makeProspect({ segment, domain, name, country: 'US', source: `https://${domain}/`, scores: segment.positiveCriteria.map((criterion) => ({ criterion, score: 5, reasoning: 'a VC with a portfolio' })), by: 'merc', now })])).added;
    await listScreened(me.address, segment.id, [prospect.id], 'lead-run:merc');
    const filed = await (await leadLedgerFor(me.address)).add({ name: `Pat Partner, Partner at ${name}`, contact: `pat@${domain}`, channelId: 'email', kind: 'buyer', status: emailed ? 'contacted' : 'cold', addedBy: 'merc', source: `lead engine [${segment.id}] ${segment.name}` });
    await settleProspect(me.address, prospect.id, { type: 'promoted', leadId: filed.id, by: 'merc' });
    return { prospect, lead: filed };
  };

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'audience-requires-test-key';
    useTempRealm();
    const tmp = await createTempDir('audience-requires');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    await workspace.create('merc');
    await fs.writeFile(path.join(tmp, 'workspaces', 'merc', 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
    await fs.mkdir(path.join(tmp, 'workspaces', 'merc', 'identity'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'workspaces', 'merc', 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: `0x${'c'.repeat(40)}` }));
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
    expect((await request(app).put('/api/v1/revenue/seat').use(as).send({ laneId: 'merc' })).status).toBe(200);
    const now = new Date().toISOString();
    const make = (name, first) => makeSegment({ name, offer: 'A stake in what we are building', company: 'ignis', customerProblem: 'They look for the next thing to back', targetRole: 'Partner', targetGeography: 'United States', countries: ['US'],
      positiveCriteria: [first, 'Has a public portfolio page'], why: 'They invest in this', by: 'merc', now });
    crypto = make('Crypto funds', 'Active crypto fund or VC with a portfolio of DeFi or token projects');
    general = make('General funds', 'Active venture fund with a portfolio of software companies');
    for (const s of [crypto, general]) { await fileSegment(me.address, s); await setSegmentState(me.address, s.id, 'approved', 'operator'); }
  }, 60000);

  afterAll(() => {
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('the screener is told a sign with several parts needs every part shown', () => {
    const [system] = screenMessages({ segment: crypto, company: { name: 'X', domain: 'x.example' }, text: 'a page', funding: false });
    expect(system.content).toContain('Score 3 when the page shows the core in its own words and only a detail is not on this page');
    expect(system.content).toContain('Score 0-2 WHEN THE FIELD ITSELF IS MISSING');
    expect(system.content).toContain('is NOT met by a fund with a portfolio whose page names nothing crypto');
  });

  test('set on the desk: it stands at once, the audience stays approved; what cannot stand is refused with why', async () => {
    expect((await request(app).put(`/api/v1/revenue/lead-engine/segments/${crypto.id}/required`).send({ required: [] })).status).toBe(401);
    expect((await put('s-nope', [{ sign: SIGN, evidence: ['crypto'] }])).status).toBe(404);
    expect((await put(crypto.id, [{ sign: SIGN, evidence: [] }])).body.error).toMatch(/evidence: the words of which one must stand in the company's own quote/);
    expect((await put(crypto.id, [{ sign: SIGN, evidence: ['crypto'], otherwise: crypto.id }])).body.error).toMatch(/is not another audience of this house/);
    const set = await put(crypto.id, [{ sign: SIGN, evidence: ['Crypto', 'blockchain', 'web3', 'DeFi'], otherwise: general.id }]);
    expect(set.body).toEqual({ ok: true, required: [{ sign: SIGN, evidence: ['crypto', 'blockchain', 'web3', 'defi'], otherwise: general.id }] });
    const shown = (await engine()).segments.find((s) => s.id === crypto.id);
    expect(shown).toMatchObject({ state: 'approved', required: [{ sign: SIGN, otherwise: general.id, otherwiseName: 'General funds' }] });
  });

  test('the next run proves each filed company from its own page: the crypto fund stays, the general fund and its unwritten lead move, one already written to is left alone', async () => {
    // Filed before the audience required anything: scored 5 for […], each already a lead.
    await put(crypto.id, []);
    const stays = await lead(crypto, 'cryptofund.example', 'Crypto Fund');
    const moves = await lead(crypto, 'bigvc.example', 'Big VC');
    const written = await lead(crypto, 'later.example', 'Later', { emailed: true });
    await put(crypto.id, [{ sign: SIGN, evidence: ['crypto', 'blockchain', 'web3', 'defi'], otherwise: general.id }]);
    // Until it is proved, no first email is written to any of them.
    const [seg] = (await readSegments(me.address)).filter((s) => s.id === crypto.id);
    expect(firstEmailScreen({ lead: moves.lead, prospect: (await readProspects(me.address)).find((p) => p.id === moves.prospect.id), segment: seg, segments: await readSegments(me.address) })).toMatch(/was scored before "Crypto funds" required: It invests in crypto, blockchain or web3 projects — prove it either way/);

    const fetchPage = async (url) => (PAGES[url] ? { ok: true, url, html: PAGES[url] } : { ok: false, why: 'the address does not exist' });
    const run = await startLeadRun(me.address, { segmentId: crypto.id, want: 5, screenOnly: true }, { intents: salesIntents, fetchPage, width: 1 });
    expect(run.ok, run.reason).toBe(true);
    const ended = await run.done;
    expect(ended.last.join('\n')).toContain('2 companies were filed before their audience required something: each is proved from its own page first');
    expect(ended.counts).toMatchObject({ proved: 2, unmet: 1 });
    expect(ended.last.join('\n')).toMatch(/NOT THIS AUDIENCE Big VC: DOES NOT — no fit for "Crypto funds"; MOVED to \[s-[a-f0-9]+\] "General funds"/);

    const pool = await readProspects(me.address);
    const of = (id) => pool.find((p) => p.id === id);
    // The crypto fund: proved by its own sentence, still the crypto audience's lead.
    expect(of(stays.prospect.id)).toMatchObject({ segmentId: crypto.id, stage: 'promoted', proofs: [{ sign: SIGN, met: true, quote: 'We invest in crypto networks and the teams building them, from the first check.', source: 'https://cryptofund.example/' }] });
    // The general fund: its page names nothing crypto. It and its lead now stand under the audience it belongs to — not thrown away.
    expect(of(moves.prospect.id)).toMatchObject({ segmentId: general.id, stage: 'promoted', leadId: moves.lead.id, proofs: [{ sign: SIGN, met: false }] });
    const leads = await (await leadLedgerFor(me.address)).load();
    expect(leads.find((l) => l.id === moves.lead.id)).toMatchObject({ status: 'cold', touches: expect.arrayContaining([expect.objectContaining({ note: expect.stringMatching(/^moved to "General funds": does not meet what "Crypto funds" requires/) })]) });
    const origins = leadOrigins({ campaigns: [], segments: await readSegments(me.address), prospects: pool, leads });
    expect(origins.get(moves.lead.id)).toMatchObject({ audienceId: general.id, audience: 'General funds' });
    expect(origins.get(stays.lead.id)).toMatchObject({ audienceId: crypto.id });
    // One already written to is a conversation under way: the run does not touch it.
    expect(of(written.prospect.id)).toMatchObject({ segmentId: crypto.id, stage: 'promoted' });
    expect(of(written.prospect.id).proofs ?? []).toEqual([]);
    expect(leads.find((l) => l.id === written.lead.id).status).toBe('contacted');
    // Proved once: the next run has nothing left to prove.
    const again = await (await startLeadRun(me.address, { segmentId: crypto.id, want: 5, screenOnly: true }, { intents: salesIntents, fetchPage, width: 1 })).done;
    expect(again.counts.proved ?? 0).toBe(0);
  }, 60000);
});
