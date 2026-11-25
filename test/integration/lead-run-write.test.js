/**
 * THE RUN WRITES THE RESEARCH AND THE FIRST EMAIL (sales/lead-run-write.js) — Design note, 2026-11-22, on the first pipeline
 * review, where a lead typically waited 8.6 hours between being filed and being researched: […]
 *
 * A real house on tmp disk, the real seat, the real acts and stores (RULE 0). The house's model is a real server on
 * loopback answering the screener, the writer and the claims reader from what each is shown; the address checker is
 * Hunter's verifier stood in on loopback; pages are handed to the run as the house's reader would return them.
 * Under proof: a lead filed earlier is researched and its email staged by the next run; one the page shows is no
 * match is researched and gets NO email; an email a check refuses is written again with the refusal in hand; a
 * company gathered and never read goes from its page to a staged email in the one run; nothing is sent.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import http from 'node:http';
import os from 'os';
import path from 'path';
import process from 'node:process';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { addCandidates, fileSalesFacts, reviewSalesFacts, setSegmentState, readProspects, readAddressChecks } from '../../backend/services/sales/sales-store.js';
import { makeSalesSheet } from '../../backend/services/sales/sales-facts.js';
import { checkBeforeSending } from '../../backend/services/sales/address-check.js';
import { readOutbox } from '../../backend/services/sales/email-outbox.js';
import { readResearch } from '../../backend/services/sales/research-store.js';
import { readPipelineReview } from '../../backend/services/sales/pipeline-review-read.js';
import { startLeadRun } from '../../backend/services/sales/lead-run.js';
import { salesIntents } from '../../backend/services/intents/sales-acts.js';
import { croDesignation } from '../../backend/services/revenue/cro-designation.js';
import { lockedCampaign, leadIn, screened } from '../helpers/sales-formula-kit.js';
import { startLocalProvider } from '../helpers/local-provider.js';
import { getConfig, setConfig } from '../../backend/services/llm-provider.js';
import { usePositionHouse, ownLane, POSITION_HOUSE as HOUSE } from '../helpers/position-house.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const LANE = 'mercwrite';
const ENV = ['WORKSPACES_ROOT', 'NEUMA_LEAD_SOURCE_HUNTER', 'HUNTER_API_KEY', 'TOMBA_API_KEY', 'TOMBA_API_SECRET', 'APOLLO_API_KEY'];
const saved = {};
let dir; let position; let model; let hunter; let priorConfig; let segment;
const asked = { write: [], mend: [], refusedOnce: 0 };

const PAGES = {
  'https://outbox.example/': '<html><head><title>Outbox</title></head><body><p>Outbox builds a field app for working crews. This month we shipped an offline mode for the field app, so crews keep working with no signal.</p></body></html>',
  'https://nomatch.example/': '<html><head><title>No Match</title></head><body><p>No Match is a bakery in Portland. We bake sourdough every morning and deliver to cafes across the city before six.</p></body></html>',
  'https://again.example/': '<html><head><title>Again</title></head><body><p>Again builds scheduling software for roofing crews. We opened our second office this quarter and doubled the crews on the platform.</p></body></html>',
  'https://fresh.example/': '<html><head><title>Fresh</title></head><body><p>Fresh builds an inspection app for building crews. We launched photo reports for inspectors this spring.</p><p>Write to our founder: ada@fresh.example</p></body></html>',
};
const fetchPage = async (url) => (PAGES[url] ? { ok: true, url, html: PAGES[url] } : { ok: false, why: 'the address does not exist' });

// The house's model, answering each question from what it is shown.
const writing = (company, parts) => JSON.stringify({ what: `${company} builds software for working crews.`, when: '', where: '', need: 'Their crews need hands-on help adopting what they build.', fit: { verdict: 'yes', why: 'a founder building a software product for crews' }, subject: 'Building With Your Crews', why: 'Crews adopting it in the field learn fastest one to one.', askIndex: 0, ask: 'Shall I send the session outline?', ...parts });
const respond = (body) => {
  const system = String(body.messages?.[0]?.content ?? '');
  const shown = String(body.messages?.at(-1)?.content ?? '');
  if (system.startsWith('You are the CLAIMS READER')) return shown.includes('60 minute') ? '1 | sessions of 60 minutes, one to one' : 'NO CLAIMS';
  if (system.startsWith('You screen one company')) return JSON.stringify({ name: 'Fresh', what: 'An inspection app for building crews.', country: 'US', scores: { F1: { score: 5, why: 'its page says it builds an inspection app' } } });
  // Asked to mend the one line that holds a number, this model hands it back as it was: the whole answer is then asked for again.
  if (system.startsWith('You rewrite a line of an email')) { asked.mend.push(shown); return shown; }
  if (system.includes('You read ONE company\'s own page')) {
    asked.write.push({ system, shown });
    if (shown.includes('nomatch.example')) return JSON.stringify({ what: 'No Match is a bakery in Portland.', now: 'Baking sourdough every morning and delivering to cafes across the city', when: '', where: 'Portland', need: 'Nothing we offer: it builds no software.', fit: { verdict: 'no', why: 'a bakery that builds no software product' }, subject: '', hook: '', why: '', offer: '', askIndex: 0, ask: '' });
    if (shown.includes('again.example')) {
      const fixed = shown.includes('YOUR LAST ANSWER WAS REFUSED');
      if (!fixed) asked.refusedOnce += 1;
      return writing('Again', { now: 'Opened a second office this quarter and doubled the crews on the platform', hook: 'You opened a second office this quarter and doubled the crews on the platform.', offer: fixed ? 'A 60 minute session with the founder, one to one, on what your roofing crews use.' : 'Our 90 minute session doubles output for your roofing crews.' });
    }
    if (shown.includes('fresh.example')) return writing('Fresh', { now: 'Launched photo reports for inspectors this spring', hook: 'Fresh launched photo reports for inspectors this spring, built for building crews.', offer: 'A 60 minute session with the founder, one to one, on what inspectors need next.' });
    return writing('Outbox', { now: 'Shipped an offline mode for the field app this month', hook: 'Your Outbox field app shipped an offline mode this month.', offer: 'A 60 minute session with the founder, one to one, on finishing what your crews use.' });
  }
  return '{"country": "US"}';
};

const connection = () => ({ walletAddress: HOUSE, companion: { neumaId: LANE, name: LANE } });
const actAs = async (type, payload) => {
  const intent = salesIntents.find((i) => i.name === type);
  const checked = await intent.validate(payload, { connection: connection() });
  if (!checked.ok) return { status: 'error', error: checked.reason };
  const out = await intent.execute(checked.value, { emit: () => {} });
  return out.ok ? { status: 'ok', content: out.detail } : { status: 'error', error: out.reason };
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-run-write-'));
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.WORKSPACES_ROOT = dir;
  position = usePositionHouse(dir);
  await workspace.create(LANE);
  await ownLane(LANE);
  model = await startLocalProvider({ respond });
  hunter = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: { status: 'valid', score: 96, mx_records: true, smtp_check: true } })); });
  await new Promise((resolve) => { hunter.listen(0, '127.0.0.1', resolve); });
  process.env.NEUMA_LEAD_SOURCE_HUNTER = `http://127.0.0.1:${hunter.address().port}`;
  process.env.HUNTER_API_KEY = 'the-houses-hunter-key';
  priorConfig = getConfig();
  setConfig({ provider: 'lm-studio', endpoint: model.endpoint, model: 'test-model', apiKey: '' });
  await croDesignation.designate(HOUSE, LANE);
  const sheet = makeSalesSheet({ by: LANE, now: new Date().toISOString(), facts: [
    { company: 'ignis', claim: 'One-to-one sessions with the founder, 60 minutes', figure: { value: 60, unit: 'minutes' }, source: 'https://ignislabs.ai/sessions' },
    { company: 'ignis', claim: 'A session costs 250 US dollars an hour', figure: { value: 250, unit: 'USD' }, source: 'https://ignislabs.ai/sessions' },
    { company: 'ignis', claim: 'A marine electrician built and launched his own product after the sessions', source: 'https://ignislabs.ai/testimonials' },
  ] });
  await fileSalesFacts(HOUSE, sheet);
  await reviewSalesFacts(HOUSE, { sheetId: sheet.id, verdict: 'approved', note: '' });
  segment = await lockedCampaign({ house: HOUSE, lane: LANE, actAs });
  await setSegmentState(HOUSE, segment.id, 'approved', 'operator');
  // Three leads filed earlier, each with a confirmed address, none researched: the backlog.
  const ledger = await leadLedgerFor(HOUSE);
  for (const [name, contact] of [['Otto Berg, Owner at Outbox', 'otto@outbox.example'], ['Nina Ruiz, Owner at No Match', 'nina@nomatch.example'], ['Abe Stone, Founder at Again', 'abe@again.example']]) {
    await screened(HOUSE, LANE, await ledger.add(leadIn(segment, LANE, name, contact)), segment);
  }
  await checkBeforeSending(HOUSE, ['otto@outbox.example', 'nina@nomatch.example', 'abe@again.example'], { by: LANE });
  await addCandidates(HOUSE, segment.id, [{ source: 'apollo-discover', domain: 'fresh.example', name: 'Fresh' }], LANE);
}, 60000);

afterAll(async () => {
  if (priorConfig) setConfig(priorConfig);
  await model?.close();
  await new Promise((resolve) => { if (hunter) hunter.close(resolve); else resolve(); });
  position?.restore();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a lead run writes the research and the first email of every lead, the moment it can', () => {
  test('the leads that waited are written first, then a company goes from its page to a staged email in the one run; nothing is sent', async () => {
    expect((await readAddressChecks(HOUSE)).filter((c) => c.status === 'valid')).toHaveLength(3);
    const started = await startLeadRun(HOUSE, { segmentId: segment.id, want: 1 }, { intents: salesIntents, fetchPage, width: 1 });
    expect(started.ok, started.reason).toBe(true);
    const ended = await started.done;
    const lines = ended.last.join('\n');
    expect(lines, lines).toContain('3 lead(s) filed earlier still wait for their research or first email: each is written now');
    // Written from the page: the card, the fit, the email — in seconds, staged for the operator.
    expect(lines).toMatch(/EMAIL outbox\.example — Otto Berg <otto@outbox\.example>: researched and staged for your review in \d+ s/);
    // No match by its own page: researched, kept, and no email.
    expect(lines).toMatch(/NOT A MATCH nomatch\.example <nina@nomatch\.example> — a bakery that builds no software product: researched, no email/);
    // A number no approved fact states: caught before it is staged, handed back with the number named, written again.
    expect(lines).toMatch(/EMAIL again\.example — Abe Stone <abe@again\.example>: researched and staged for your review in \d+ s \(answer 2\)/);
    expect(asked.refusedOnce).toBe(1);
    expect(asked.mend).toEqual(['Our 90 minute session doubles output for your roofing crews.']);
    expect(asked.write.find((a) => a.shown.includes('YOUR LAST ANSWER WAS REFUSED')).shown).toMatch(/YOUR LAST ANSWER WAS REFUSED: your email holds 90, and no approved fact states it\. The only numbers an email may hold are: 60, 250\. Say the same thing about them WITHOUT the number/);
    // The new company: read, screened, its founder's address confirmed, filed, researched and written — one run.
    expect(lines).toMatch(/LEAD Fresh — [^<]*<ada@fresh\.example>/);
    expect(lines).toMatch(/EMAIL Fresh — [^<]*<ada@fresh\.example>: researched and staged for your review in \d+ s/);
    expect(ended.counts).toMatchObject({ leads: 1, researched: 4, written: 3, notMatch: 1 });
    expect(ended.words).toContain('3 email(s) researched and staged for review, 1 researched and not a match');

    // The model was shown the campaign's plan, the only facts it may state, the person and the page.
    const first = asked.write.find((a) => a.shown.includes('outbox.example'));
    expect(first.system).toMatch(/THE CAMPAIGN: Builder sessions — Founders booking one-to-one build sessions/);
    expect(first.system).toMatch(/THE ONLY THINGS YOU MAY SAY ABOUT IGNIS[^]*1\. One-to-one sessions with the founder, 60 minutes\n {2}2\. A session costs 250 US dollars an hour\n/);
    expect(first.shown).toMatch(/^THE PERSON: Otto Berg, Owner <otto@outbox\.example>\nTHEIR COMPANY: outbox\.example \(outbox\.example\)\nTHEIR PAGE \(https:\/\/outbox\.example\/\):\n/);

    // On record exactly as the seat's own acts leave it.
    const research = await readResearch(HOUSE);
    expect(research.cards.get('otto@outbox.example')).toMatchObject({ name: 'Otto Berg', role: 'Owner', now: 'Shipped an offline mode for the field app this month', sources: ['https://outbox.example/'], by: LANE });
    expect([...research.fits.values()].map((f) => [f.email, f.verdict]).sort()).toEqual([['abe@again.example', 'yes'], ['ada@fresh.example', 'yes'], ['nina@nomatch.example', 'no'], ['otto@outbox.example', 'yes']]);
    const drafts = (await readOutbox(HOUSE)).drafts;
    expect(drafts.map((d) => [d.to[0], d.state]).sort()).toEqual([['abe@again.example', 'waiting'], ['ada@fresh.example', 'waiting'], ['otto@outbox.example', 'waiting']]);
    const otto = drafts.find((d) => d.to[0] === 'otto@outbox.example');
    expect(otto).toMatchObject({ subject: 'Ignis AI Labs: Building With Your Crews', by: LANE, formula: { hook: 'Your Outbox field app shipped an offline mode this month.', askIndex: 0 } });
    expect(otto.text).toBe('Hi Otto,\n\nYour Outbox field app shipped an offline mode this month. Crews adopting it in the field learn fastest one to one.\n\nA 60 minute session with the founder, one to one, on finishing what your crews use.\n\nShall I send the session outline?\n\nThe Mercator');
    const leads = await (await leadLedgerFor(HOUSE)).load();
    expect(leads.every((l) => l.status === 'cold')).toBe(true);
    expect(leads.find((l) => l.contact === 'nina@nomatch.example').touches.at(-1).note).toMatch(/^not a fit for "Builder sessions": a bakery that builds no software product/);

    // THE BENCHMARK sees it: every lead with an email, and the wait between a lead and its research gone.
    const [review] = await readPipelineReview(HOUSE, { segmentId: segment.id });
    expect(review.whole.reachedEmail).toBe(3);
    const fresh = review.rows.find((r) => r.email === 'ada@fresh.example');
    expect(fresh.grades).toMatchObject({ validate: 'meets', email: 'meets' });
    expect(fresh.times.research).toBeLessThan(30);
    expect(fresh.times.email).toBeLessThan(30);

    // A second run finds nothing left to write: nobody is researched or written to twice.
    const again = await (await startLeadRun(HOUSE, { segmentId: segment.id, want: 1 }, { intents: salesIntents, fetchPage, width: 1 })).done;
    expect(again.counts.written ?? 0).toBe(0);
    expect((await readOutbox(HOUSE)).drafts).toHaveLength(3);
    expect((await readProspects(HOUSE)).filter((p) => p.stage === 'promoted')).toHaveLength(4);
  }, 120000);
});
