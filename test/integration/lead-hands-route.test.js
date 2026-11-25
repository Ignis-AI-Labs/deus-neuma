/**
 * THE OPERATOR'S HANDS ON THE COMPANIES IN VALIDATE (POST /lead-engine/prospects/:id/hand, /candidates/pass) — Founder,
 * 2026-11-18: […] A real app, a real signed session, a real house on temp disk (RULE 0): a company on the lead list is
 * removed — its lead closed and what was staged to it withdrawn; a listed one is taken off the approved list; one is
 * moved under another audience (the list approval stays with the old one); one not scored yet is passed over.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import process from 'node:process';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { fileSegment, setSegmentState, addProspects, settleProspect, readProspects, addCandidates, readCandidates } from '../../backend/services/sales/sales-store.js';
import { makeSegment } from '../../backend/services/sales/segment-shape.js';
import { makeProspect } from '../../backend/services/sales/prospect-shape.js';
import { stageDraft, readOutbox } from '../../backend/services/sales/email-outbox.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const NOW = new Date().toISOString();
const audience = (name) => makeSegment({ name, offer: 'A pool for your token', company: 'umbrae', customerProblem: 'Thin liquidity', targetRole: 'Founder', targetGeography: 'United States', countries: ['US'], positiveCriteria: ['Has a token'], why: 'They need depth', by: 'merc', now: NOW });
const company = (segment, domain) => makeProspect({ segment, domain, name: domain.split('.')[0], source: `https://${domain}/`, by: 'merc', now: NOW,
  scores: [{ criterion: 'Has a token', score: 5, reasoning: 'their site names it' }], people: [{ name: 'Ari', role: 'Founder', sourceUrl: `https://${domain}/team` }] });

describe('the operator removes, takes off, moves and passes over companies', () => {
  let me, app, ua, fund;
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const hand = (id, body) => as(request(app).post(`/api/v1/revenue/lead-engine/prospects/${id}/hand`)).send(body);

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'lead-hands-test-key';
    useTempRealm();
    setWorkspacesRoot(path.join(await createTempDir('lead-hands'), 'workspaces'));
    me = await fullAuth();
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
    ua = audience('Umbrae UA'); fund = audience('Umbrae Funding');
    for (const s of [ua, fund]) { await fileSegment(me.address, s); await setSegmentState(me.address, s.id, 'approved', 'operator'); }
  }, 60000);

  afterAll(() => {
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('a company on the lead list is removed: its lead closed, what was staged to it withdrawn; it cannot be removed twice', async () => {
    const school = company(ua, 'magicschool.ai');
    await addProspects(me.address, [school]);
    const lead = await (await leadLedgerFor(me.address)).add({ name: 'Ari, Founder at MagicSchool', contact: 'ari@magicschool.ai', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: 'merc' });
    await settleProspect(me.address, school.id, { type: 'promoted', leadId: lead.id, by: 'merc' });
    const staged = await stageDraft(me.address, { to: ['ari@magicschool.ai'], subject: 'A pool', text: 'Hello Ari, the words of a staged email.', by: 'merc' });
    const res = await hand(school.id, { move: 'drop', reason: 'schools are not our buyers' });
    expect(res.body).toEqual({ ok: true, move: 'drop', prospect: school.id, closed: { lead: lead.id, withdrawn: [staged.id] } });
    expect((await readProspects(me.address)).find((p) => p.id === school.id)).toMatchObject({ stage: 'dropped', dropReason: 'schools are not our buyers' });
    const closed = (await (await leadLedgerFor(me.address)).load()).find((l) => l.id === lead.id);
    expect(closed).toMatchObject({ status: 'lost' });
    expect(closed.touches.at(-1).note).toBe('removed by the operator: schools are not our buyers');
    expect((await readOutbox(me.address)).drafts.find((d) => d.id === staged.id)).toMatchObject({ state: 'withdrawn' });
    expect((await hand(school.id, { move: 'drop' })).status).toBe(409);
  });

  test('one on the approved list is taken off it; one is moved under another audience and leaves its list approval behind', async () => {
    const sui = company(ua, 'sui.io'); const virtuals = company(ua, 'virtuals.io');
    await addProspects(me.address, [sui, virtuals]);
    const { approveList } = await import('../../backend/services/sales/sales-store.js');
    const listed = await approveList(me.address, ua.id, 'operator', [sui.id, virtuals.id]);
    expect(listed.ok, JSON.stringify(listed)).toBe(true);
    expect((await hand(sui.id, { move: 'unlist' })).body).toMatchObject({ ok: true, move: 'unlist' });
    expect((await readProspects(me.address)).find((p) => p.id === sui.id)).toMatchObject({ listApproved: false, segmentId: ua.id });
    expect((await hand(sui.id, { move: 'unlist' })).body.error).toMatch(/is not on an approved list/);
    expect((await hand(virtuals.id, { move: 'move', segmentId: fund.id })).body).toMatchObject({ ok: true, move: 'move' });
    expect((await readProspects(me.address)).find((p) => p.id === virtuals.id)).toMatchObject({ segmentId: fund.id, listApproved: false });
    expect((await hand(virtuals.id, { move: 'move', segmentId: fund.id })).body.error).toMatch(/already stands under that audience/);
    expect((await hand(virtuals.id, { move: 'move', segmentId: 's-nothere' })).body.error).toMatch(/is not an audience of this house/);
    expect((await hand(virtuals.id, { move: 'paint' })).status).toBe(400);
  });

  test('a company not scored yet is passed over at the filter', async () => {
    await addCandidates(me.address, ua.id, [{ domain: 'hellorates.com', name: 'HelloRates', source: 'hunter-discover' }], 'merc');
    const res = await as(request(app).post('/api/v1/revenue/lead-engine/candidates/pass')).send({ segmentId: ua.id, domain: 'hellorates.com' });
    expect(res.body).toEqual({ ok: true, passed: 'hellorates.com' });
    expect((await readCandidates(me.address)).find((c) => c.domain === 'hellorates.com')).toMatchObject({ shortlist: 'passed' });
  });
});
