/**
 * SEVERAL LEAD RUNS AT ONCE (backend/services/sales/lead-run.js) — Design note, 2026-11-21: […]
 * One run an audience, as many as the model answers at once less the place kept for the operator's own chat; each
 * stops on its own; each stands in the ACTIVE list. A real house on tmp disk, the real seat, routes and stores, and a
 * model served from this machine that holds its answers until every run is seen working together (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import http from 'node:http';
import process from 'node:process';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { useTempRealm } from '../helpers/temp-realm.js';
import { fullAuth } from '../helpers/audit-auth.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import revenueRouter from '../../backend/routes/revenue-routes.js';
import { fileSegment, setSegmentState, addCandidates, readProspects } from '../../backend/services/sales/sales-store.js';
import { makeSegment } from '../../backend/services/sales/segment-shape.js';
import { startLeadRun, leadRunsOf, runRoom } from '../../backend/services/sales/lead-run.js';
import { lineWidth } from '../../backend/services/substrate-lease.js';
import { activeWork } from '../../backend/services/active-work.js';
import { salesIntents } from '../../backend/services/intents/sales-acts.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { setCredential } from '../../backend/services/provider-credentials.js';
import { setRoute } from '../../backend/services/neuma-routes-store.js';

const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();

describe('several lead runs work at once, one an audience, within the places the model has', () => {
  let me, app, llm, priorConfig, open;
  const waiting = [];
  let asked = 0;
  const prompts = [];
  const as = (req) => req.set('Authorization', `Bearer ${me.token}`);
  const audiences = [];

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'lead-run-parallel-test-key';
    useTempRealm();
    const tmp = await createTempDir('lead-run-parallel');
    setWorkspacesRoot(path.join(tmp, 'workspaces'));
    me = await fullAuth();
    await workspace.create('merc');
    await fs.writeFile(path.join(tmp, 'workspaces', 'merc', 'owner.json'), JSON.stringify({ wallet: me.address, claimedAt: 1 }));
    await fs.mkdir(path.join(tmp, 'workspaces', 'merc', 'identity'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'workspaces', 'merc', 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: `0x${'e'.repeat(40)}` }));
    app = express();
    app.use(express.json());
    app.use('/api/v1/revenue', revenueRouter);
    expect((await request(app).put('/api/v1/revenue/seat').use(as).send({ laneId: 'merc' })).status).toBe(200);
    // The model: every answer waits until the test opens the gate, so the runs are seen working side by side.
    // Audience 2's company shows only the side sign: a fit by the average, not what the audience IS.
    const answerFor = (prompt) => JSON.stringify({ name: 'A shop', what: 'An online shoe shop.', country: 'US', scores: /builders club/.test(prompt)
      ? { F1: { score: 2, why: 'it sells shoes, and only mentions a builders club' }, F2: { score: 5, why: 'its founder is not a developer' } }
      : { F1: { score: 0, why: 'its page sells running shoes' }, F2: { score: 0, why: 'nothing says who founded it' } } });
    llm = http.createServer((req, res) => {
      if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'screen-model', type: 'llm', max_context_length: 32768, loaded_context_length: 32768 }] })); return; }
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        asked += 1;
        prompts.push(JSON.parse(raw).messages.at(-1).content);
        const answer = answerFor(JSON.parse(raw).messages.at(-1).content);
        const send = () => {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
          res.end('data: [DONE]\n\n');
        };
        if (open) send(); else waiting.push(send);
      });
    });
    await new Promise((resolve) => llm.listen(0, '127.0.0.1', resolve));
    priorConfig = getConfig();
    setConfig({ provider: 'lm-studio', endpoint: `http://127.0.0.1:${llm.address().port}`, apiKey: '', model: 'screen-model' });
    await setCredential('lm-studio', { apiKey: 'fixture-only', endpoint: getConfig().endpoint });
    await setRoute('merc', { provider: 'lm-studio', model: 'screen-model' });
    // One audience more than may run together, each with one gathered company of its own.
    const now = new Date().toISOString();
    for (let i = 0; i <= runRoom(); i += 1) {
      const segment = makeSegment({ name: `Audience ${i + 1}`, offer: 'One-to-one sessions to build with AI tools', company: 'ignis', customerProblem: 'They cannot build what they know',
        targetRole: 'Founder', targetGeography: 'United States', countries: ['US'], positiveCriteria: ['Building a software product', 'Founder is not a developer'], why: 'Raw AI tools leave them stuck', by: 'merc', now });
      await fileSegment(me.address, segment);
      await setSegmentState(me.address, segment.id, 'approved', 'operator');
      await addCandidates(me.address, segment.id, [{ source: 'apollo-discover', domain: `shop${i + 1}.example`, name: `Shop ${i + 1}` }], 'merc');
      audiences.push(segment);
    }
  });

  afterAll(async () => {
    open = true;
    waiting.splice(0).forEach((send) => send());
    await new Promise((resolve) => llm.close(resolve));
    setConfig(priorConfig);
    setWorkspacesRoot(PRIOR_ROOT);
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY; else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  test('a run for each audience up to the model\'s places; the next is refused with why; one is stopped alone; all end with their own counts', async () => {
    const fetchPage = async (url) => (/^https:\/\/shop\d+\.example\/$/.test(url) ? { ok: true, url, html: `<html><head><title>Shop</title></head><body><p>Running shoes for every distance, shipped across the country, with free returns for a month.${url.includes('shop2.') ? ' Home of the weekend builders club.' : ''}</p></body></html>` } : { ok: false, why: 'the address does not exist' });
    const start = (segment) => startLeadRun(me.address, { segmentId: segment.id, want: 5, screenOnly: true }, { intents: salesIntents, fetchPage, width: 1 });
    const room = runRoom();
    expect(room).toBe(Math.max(1, lineWidth() - 1));
    const started = [];
    for (const segment of audiences.slice(0, room)) { const s = await start(segment); expect(s.ok, s.reason).toBe(true); started.push(s); }
    // The same audience twice is refused; so is one more run than the model has places for.
    expect((await start(audiences[0])).reason).toBe(`a lead run is already working "Audience 1" — stop it, or wait for it to finish; another audience can run beside it`);
    expect((await start(audiences[room])).reason).toBe(`${room} lead run(s) are working, and that is every place your model has for them (it answers ${lineWidth()} at once; one is kept for your own chat) — stop one, or wait for one to finish`);
    // Every one of them is working, each waiting on the model for its own company.
    await expect.poll(() => waiting.length, { timeout: 20000 }).toBe(room);
    expect(leadRunsOf(me.address).filter((r) => r.active)).toHaveLength(room);
    expect(activeWork(me.address).map((w) => w.kind)).toEqual(Array(room).fill('LEAD RUN'));
    const standing = (await request(app).get('/api/v1/revenue/lead-engine/run').use(as)).body;
    expect(standing).toMatchObject({ room, run: { active: true } });
    expect(standing.runs.map((r) => r.segment).sort()).toEqual(audiences.slice(0, room).map((s) => s.name).sort());
    // One is stopped by its id; the others keep working.
    const first = started[0].run;
    const stopped = await request(app).post('/api/v1/revenue/lead-engine/run/stop').use(as).send({ id: first.id });
    expect(stopped.status).toBe(200);
    expect((await started[0].done)).toMatchObject({ id: first.id, active: false, ended: 'stopped' });
    expect(leadRunsOf(me.address).filter((r) => r.active)).toHaveLength(room - 1);
    expect((await request(app).post('/api/v1/revenue/lead-engine/run/stop').use(as).send({ id: first.id })).status).toBe(409);
    // A place is free again: the audience that was refused now starts.
    if (room > 1) { const late = await start(audiences[room]); expect(late.ok, late.reason).toBe(true); started.push(late); }
    open = true;
    waiting.splice(0).forEach((send) => send());
    const ended = await Promise.all(started.slice(1).map((s) => s.done));
    for (const run of ended) expect(run).toMatchObject({ active: false, counts: { looked: 1, screened: 1, leads: 0 } });
    // No company was screened twice between them: the model was asked once a company, and no record was written twice.
    expect(asked).toBe(started.length); // one question a company, the stopped run's included
    const drops = (await readProspects(me.address)).filter((p) => p.stage === 'dropped');
    expect(new Set(drops.map((p) => `${p.segmentId}:${p.domain}`)).size).toBe(drops.length);
    // A fit only on the side signs was read from its own page by the run: it is settled there and then, with why, and
    // does not stand waiting for the next run to read it a second time.
    if (room > 1) {
      expect(ended[0].counts).toMatchObject({ weak: 1, nofit: 0, fit: 0 });
      expect((await readProspects(me.address)).find((p) => p.domain === 'shop2.example')).toMatchObject({ stage: 'dropped', match: 2 });
      expect((await readProspects(me.address)).filter((p) => p.stage === 'found' && p.match >= 2 && !p.listApproved)).toEqual([]);
    }
    expect(activeWork(me.address)).toEqual([]);
    expect(leadRunsOf(me.address)).toHaveLength(room + (room > 1 ? 1 : 0));

    // Where each audience stands, read from the house's records: the ones screened say so, with their next step in words.
    const stands = (await request(app).get('/api/v1/revenue/lead-engine/run/standing').use(as)).body.audiences;
    expect(stands).toHaveLength(audiences.length);
    expect(stands.find((a) => a.id === audiences[1].id)).toMatchObject({ name: 'Audience 2', waiting: 0, screened: 1, fit: 0, firstSign: 'Building a software product', next: { kind: 'gather' }, sources: [{ source: 'apollo-discover', name: 'Apollo search', waiting: 0, scored: 1, fit: 0 }] });
    expect((await request(app).get('/api/v1/revenue/lead-engine/run/standing')).status).toBe(401);
    // The sales member reads the same picture through its own act: every run, and where every audience stands with its next step.
    const act = salesIntents.find((i) => i.name === 'sales/run');
    const seat = { walletAddress: me.address, companion: { neumaId: 'merc', name: 'merc' } };
    const told = await act.execute((await act.validate({ status: true }, { connection: seat })).value, {});
    expect(told.detail).toContain('WHERE EACH AUDIENCE STANDS:');
    expect(told.detail).toMatch(new RegExp(`- \\[${audiences[1].id}\\] Audience 2: 0 wait to be screened \\(0 look likely\\), 1 screened, 0 a fit \\(0 in 100\\), 0 lead\\(s\\)\\. NEXT: NOTHING WAITS TO BE SCREENED`));

    // EVERY RUN IS KEPT, WHOLE: its start, its end with what it found, and every line it said — on disk, not only on the desk.
    const history = (await request(app).get('/api/v1/revenue/lead-engine/runs').use(as)).body.runs;
    expect(history).toHaveLength(started.length);
    for (const s of started) {
      const kept = history.find((r) => r.id === s.run.id);
      expect(kept).toMatchObject({ segmentId: s.run.segmentId, segment: s.run.segment, want: 5, by: 'merc', startedAt: s.run.startedAt, endedAt: expect.any(String), counts: expect.objectContaining({ leads: 0 }) });
    }
    expect(history.find((r) => r.id === first.id).ended).toBe('stopped');
    const done = await started[1].done;
    await expect.poll(async () => (await request(app).get(`/api/v1/revenue/lead-engine/runs/${done.id}/lines`).use(as)).body.lines.length, { timeout: 5000 }).toBeGreaterThanOrEqual(done.last.length);
    const lines = (await request(app).get(`/api/v1/revenue/lead-engine/runs/${done.id}/lines`).use(as)).body.lines;
    expect(lines.map((l) => l.line)).toEqual(done.last.map((l) => l.slice(9))); // the same words, each with its full moment
    expect(lines.at(-1).line).toMatch(/1 looked at · 0 dead or unreadable · 1 screened/);
    expect((await request(app).get('/api/v1/revenue/lead-engine/runs')).status).toBe(401);
    // A finished run is cleared off the desk on a press — one, then the rest — and its record stays where it was.
    const one = await request(app).post('/api/v1/revenue/lead-engine/run/clear').use(as).send({ id: first.id });
    expect(one.body).toMatchObject({ ok: true, cleared: 1 });
    expect(one.body.runs.map((r) => r.id)).not.toContain(first.id);
    expect((await request(app).post('/api/v1/revenue/lead-engine/run/clear').use(as).send({ id: first.id })).body.cleared).toBe(0);
    expect((await request(app).post('/api/v1/revenue/lead-engine/run/clear').use(as).send({})).body).toMatchObject({ cleared: started.length - 1, runs: [], run: null });
    expect((await request(app).get('/api/v1/revenue/lead-engine/runs').use(as)).body.runs).toHaveLength(started.length);
    // A run still working is never cleared.
    open = false;
    const again = await start(audiences[0]);
    expect(again.ok, again.reason).toBe(true);
    expect((await request(app).post('/api/v1/revenue/lead-engine/run/clear').use(as).send({})).body).toMatchObject({ cleared: 0, runs: [expect.objectContaining({ id: again.run.id, active: true })] });
    open = true;
    waiting.splice(0).forEach((send) => send());
    await again.done;
  }, 60000);

  test('the likeliest companies are read first, and a pool that has run thin is left rather than read to the end', async () => {
    // An audience with 170 gathered companies, none of them what it is; one gathered LAST whose own description says what the audience is.
    const now = new Date().toISOString();
    const segment = makeSegment({ name: 'Thin pool', offer: 'One-to-one sessions to build with AI tools', company: 'ignis', customerProblem: 'They cannot build what they know',
      targetRole: 'Founder', targetGeography: 'United States', countries: ['US'], positiveCriteria: ['Building a software product', 'Founder is not a developer'], why: 'Raw AI tools leave them stuck', by: 'merc', now });
    await fileSegment(me.address, segment);
    await setSegmentState(me.address, segment.id, 'approved', 'operator');
    const companies = [...Array.from({ length: 170 }, (_, i) => ({ source: 'hunter-discover', domain: `runner${i + 1}.example`, name: `Runner ${i + 1}`, description: 'Running shoes for every distance.' })),
      { source: 'hunter-discover', domain: 'likely.example', name: 'Likely', description: 'A studio building a software product for field crews.' }];
    await addCandidates(me.address, segment.id, companies, 'merc');
    open = true;
    const before = prompts.length;
    const fetchPage = async (url) => ({ ok: true, url, html: '<html><head><title>Shop</title></head><body><p>Running shoes for every distance, shipped across the country, with free returns for a month.</p></body></html>' });
    const started = await startLeadRun(me.address, { segmentId: segment.id, want: 100, screenOnly: true }, { intents: salesIntents, fetchPage, width: 1 });
    expect(started.ok, started.reason).toBe(true);
    const ended = await started.done;
    // Gathered last, read first: what was gathered about it says what the audience is.
    expect(prompts[before]).toContain('COMPANY: Likely (likely.example)');
    expect(ended.last.join('\n')).toContain('the likeliest are read first: 1 of the 171 waiting say something of what this audience is in what was gathered about them; the other 170 come after');
    // 150 screened in a row with no fit: the other 21 are not read, and the run says why and what to do.
    expect(ended.counts).toMatchObject({ looked: 150, screened: 150, fit: 0, leads: 0 });
    expect(ended.ended).toBe('the companies left are not this audience: only 0 of the last 150 screened were a fit, so it stopped rather than read 21 more like them — gather narrower for this audience, then run it again');
    expect(ended.last.join('\n')).toContain('THE POOL HAS RUN THIN: only 0 of the last 150 companies screened were a fit — the rest are not read');
  }, 120000);
});
