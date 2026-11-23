/**
 * WHAT AN AUDIENCE REQUIRES (sales/required-signs.js, sales/prove, the gates in sales/prospect, sales/lead and the
 * email formula). Design note, 2026-11-20: an audience named […]
 * scored companies on a looser […] signal, and 13 of its 16 staged emails went to companies that are on
 * neither — other chains, exchanges, the chains themselves. […]
 *
 * Real stores, the seat's real acts through the real sweep (made-up .example domains: no real site is ever asked, so a
 * quote is kept unchecked exactly as it is for a page that cannot be read); nothing mocked (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import process from 'node:process';
import { requiredSigns, proofsFor, requiredState, requiredRefusal, requiredWords } from '../../backend/services/sales/required-signs.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { fileSegment, setSegmentState, addProspects, readProspects, readSegments, listScreened } from '../../backend/services/sales/sales-store.js';
import { makeSegment, reAims } from '../../backend/services/sales/segment-shape.js';
import { makeProspect } from '../../backend/services/sales/prospect-shape.js';
import { stageDraft, readOutbox } from '../../backend/services/sales/email-outbox.js';
import { leadLedgerFor } from '../../backend/services/leads/lead-ledger.js';
import { croDesignation } from '../../backend/services/revenue/cro-designation.js';
import { rigFor } from '../helpers/sales-mail-kit.js';
import { usePositionHouse, ownLane, POSITION_HOUSE } from '../helpers/position-house.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const SIGN = 'its token, project or community is on Base or Robinhood Chain';
const MUST = [{ sign: SIGN, evidence: ['Base', 'Robinhood Chain', 'robinhood'], otherwise: 's-chains' }];
const audience = (extra = {}) => ({
  name: 'Token Projects on Base & Robinhood', offer: 'List your token\'s pool on Umbrae', company: 'umbrae', customerProblem: 'Their token needs deep liquidity where it trades',
  targetRole: 'Founder', targetGeography: 'Worldwide', countries: ['US', 'TH'], positiveCriteria: ['Has a live token'], why: 'A live token needs liquidity today',
  by: 'merc', now: '2026-11-20T00:00:00.000Z', ...extra,
});

describe('a required sign, and its proof (pure)', () => {
  const segment = makeSegment(audience({ required: MUST }));
  const co = { domain: 'limitless.example', name: 'Limitless' };

  test('an audience keeps what must be true, the words that prove it, and where a company that fails it goes', () => {
    expect(segment.required).toEqual([{ sign: SIGN, evidence: ['base', 'robinhood chain', 'robinhood'], otherwise: 's-chains' }]);
    expect(makeSegment(audience()).required).toEqual([]);
    expect(() => makeSegment(audience({ required: [{ sign: 'on Base', evidence: [] }] }))).toThrow(/required\[0\]\.sign: the condition that must be true[\s\S]*required\[0\]\.evidence: the words of which one must stand/);
    expect(requiredSigns(Array.from({ length: 6 }, () => MUST[0])).problems[0]).toMatch(/6 were given and an audience has at most 4/);
    // Adding a required sign re-aims the audience: the operator approves it again.
    expect(reAims(makeSegment(audience()), segment)).toBe(true);
    expect(requiredWords(segment, [{ id: 's-chains', name: 'Chain Partnerships' }])).toEqual([`MUST: ${SIGN} (proved by its own words holding "base" or "robinhood chain" or "robinhood") — a company that is not goes to [s-chains] "Chain Partnerships" instead`]);
  });

  test('met: its own words, from its own site, holding an evidence word — its name is never evidence', () => {
    const good = proofsFor(segment, co, [{ sign: SIGN, met: true, quote: 'Limitless is onchain on Base, backed by the Base Ecosystem Fund.', source: 'https://limitless.example/about' }]);
    expect(good).toEqual({ problems: [], proofs: [{ sign: SIGN, met: true, quote: 'Limitless is onchain on Base, backed by the Base Ecosystem Fund.', source: 'https://limitless.example/about' }] });
    expect(proofsFor(segment, co, [{ sign: SIGN, met: true, quote: 'The best place to trade prediction markets.', source: 'https://limitless.example/' }]).problems[0]).toMatch(/the quote must hold "base" or "robinhood chain" or "robinhood" in the company's own words — its name is not evidence/);
    // […] proves nothing: the name is taken out before the words are read.
    expect(proofsFor(segment, { domain: 'baselabs.example', name: 'Base Labs' }, [{ sign: SIGN, met: true, quote: 'Base Labs builds wallets for everyday users.', source: 'https://baselabs.example/' }]).problems[0]).toMatch(/its name is not evidence/);
    // "based on" and "database" are not Base.
    expect(proofsFor(segment, co, [{ sign: SIGN, met: true, quote: 'A database of markets, based on community votes.', source: 'https://limitless.example/' }]).problems).toHaveLength(1);
    expect(proofsFor(segment, co, [{ sign: SIGN, met: true, quote: 'Limitless is onchain on Base today.', source: 'https://coingecko.example/limitless' }]).problems[0]).toMatch(/source — the https page on its OWN site \(limitless\.example\)/);
  });

  test('not met is said plainly; no proof at all is refused; each is told apart', () => {
    const no = proofsFor(segment, co, [{ sign: SIGN, met: false, reasoning: 'its own site says it is deployed on Polygon and Avalanche only' }]);
    expect(no.proofs).toEqual([{ sign: SIGN, met: false, reasoning: 'its own site says it is deployed on Polygon and Avalanche only' }]);
    expect(proofsFor(segment, co, [{ sign: SIGN, met: false }]).problems[0]).toMatch(/met is false — say what you read instead/);
    expect(proofsFor(segment, co, undefined).problems[0]).toMatch(/^REQUIRED "its token, project or community is on Base or Robinhood Chain" has no proof/);
    expect(requiredState(segment, { proofs: no.proofs })).toMatchObject({ state: 'failed', route: 's-chains' });
    expect(requiredState(segment, { proofs: [] }).state).toBe('unproved');
    expect(requiredState(segment, { proofs: [{ sign: SIGN, met: true }] }).state).toBe('met');
    expect(requiredState(makeSegment(audience()), {}).state).toBe('none');
  });

  test('a required sign that is not met is NO MATCH, whatever the other signs score', () => {
    const scored = (proofs) => makeProspect({ segment, domain: 'bnb.example', name: 'BNB Chain', country: 'US', source: 'https://bnb.example/', scores: [{ criterion: 'Has a live token', score: 5, reasoning: 'its token is live and listed' }], proofs, by: 'merc', now: 'n' });
    const failed = scored([{ sign: SIGN, met: false, reasoning: 'BNB Chain is its own layer-1, not a project on Base or Robinhood' }]);
    expect(failed).toMatchObject({ match: 1, failedRequired: [SIGN], belongsTo: 's-chains' });
    expect(() => scored(undefined)).toThrow(/REQUIRED .* has no proof/);
    const met = makeProspect({ segment, domain: 'stox.example', name: 'Stox', country: 'US', source: 'https://stox.example/', scores: [{ criterion: 'Has a live token', score: 5, reasoning: 'its token is live and listed' }], proofs: [{ sign: SIGN, met: true, quote: 'Stox is live on Base and on Robinhood Chain.', source: 'https://stox.example/' }], by: 'merc', now: 'n' });
    expect(met).toMatchObject({ match: 3 });
    expect(met.failedRequired).toBeUndefined();
    expect(requiredRefusal(segment, failed, [segment, { id: 's-chains', name: 'Chain Partnerships' }])).toBe(`BNB Chain does NOT meet what "Token Projects on Base & Robinhood" requires (${SIGN}) — it is no fit for this audience and nothing is written to it for it. It belongs to [s-chains] "Chain Partnerships": score it there`);
    expect(requiredRefusal(segment, met)).toBeNull();
  });
});

describe('the gates, through the seat\'s acts', () => {
  const LANE = 'mercmust';
  let dir; let position; let ua; let chains; let filed = 0;
  const priorRoot = process.env.WORKSPACES_ROOT;
  const actAs = async (type, payload) => {
    filed += 1;
    const intents = path.join(workspace.pathFor(LANE), 'intents');
    await fsp.mkdir(intents, { recursive: true });
    await fsp.writeFile(path.join(intents, `act-${filed}.json`), JSON.stringify({ type, ...payload }));
    return (await sweepIntents(rigFor(LANE, POSITION_HOUSE).connection, { mode: 'ask', lanePolicy: null, emit: () => {} }))[0];
  };
  const company = (domain, name, extra = {}) => ({ domain, name, country: 'US', source: `https://${domain}/`, scores: [{ criterion: 'Has a live token', score: 5, reasoning: 'its token is live and listed' }], ...extra });

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'required-signs-'));
    process.env.WORKSPACES_ROOT = dir;
    position = usePositionHouse(dir);
    await workspace.create(LANE);
    await ownLane(LANE);
    await croDesignation.designate(POSITION_HOUSE, LANE);
    chains = makeSegment(audience({ name: 'Chain Partnerships', offer: 'Bring the Umbrae DLMM to your chain', customerProblem: 'Their chain needs a native liquidity venue', positiveCriteria: ['Runs its own chain'] }));
    await fileSegment(POSITION_HOUSE, chains);
    await setSegmentState(POSITION_HOUSE, chains.id, 'approved', 'operator');
    // The audience as it stood: no required sign, companies scored on the looser signal.
    ua = makeSegment(audience());
    await fileSegment(POSITION_HOUSE, ua);
    await setSegmentState(POSITION_HOUSE, ua.id, 'approved', 'operator');
  }, 60000);
  afterAll(() => {
    position?.restore();
    if (priorRoot === undefined) delete process.env.WORKSPACES_ROOT; else process.env.WORKSPACES_ROOT = priorRoot;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the seat files the audience again with what it REQUIRES: it goes back to the operator, and a route to an audience that does not exist is refused', async () => {
    const stray = await actAs('sales/segment', { ...audience({ id: ua.id }), required: [{ ...MUST[0], otherwise: 's-nowhere' }] });
    expect(stray.error).toMatch(/otherwise "s-nowhere" is not another audience of this house/);
    const refiled = await actAs('sales/segment', { ...audience({ id: ua.id }), required: [{ ...MUST[0], otherwise: chains.id }] });
    expect(refiled.status, refiled.error).toBe('ok');
    expect(refiled.content).toMatch(/is DRAFT — it waits for the operator's approval/);
    expect(refiled.content).toContain(`It REQUIRES — MUST: ${SIGN}`);
    expect(refiled.content).toContain(`goes to [${chains.id}] "Chain Partnerships" instead`);
    await setSegmentState(POSITION_HOUSE, ua.id, 'approved', 'operator');
    ua = (await readSegments(POSITION_HOUSE)).find((s) => s.id === ua.id);
    expect(ua.required[0].otherwise).toBe(chains.id);
  }, 60000);

  test('scoring: no proof is refused; one on another chain is filed NO FIT and sent to the audience it belongs to; one on Base is scored', async () => {
    const none = await actAs('sales/prospect', { segment: ua.id, companies: [company('stellar.example', 'Stellar')] });
    expect(none.error).toMatch(/companies\[0\] \(Stellar\): REQUIRED "its token, project or community is on Base or Robinhood Chain" has no proof/);
    const done = await actAs('sales/prospect', { segment: ua.id, companies: [
      company('stellar.example', 'Stellar', { proofs: [{ sign: SIGN, met: false, reasoning: 'Stellar is its own layer-1 network; its site names no Base or Robinhood deployment' }] }),
      company('limitless.example', 'Limitless', { proofs: [{ sign: SIGN, met: true, quote: 'Limitless is onchain on Base, backed by the Base Ecosystem Fund.', source: 'https://limitless.example/about' }] }),
    ] });
    expect(done.status, done.error).toBe('ok');
    expect(done.content).toContain(`Stellar (NO FIT — it does not meet what this audience requires: ${SIGN}; it belongs to [${chains.id}]: score it there)`);
    expect(done.content).toMatch(/Limitless \(strong\)/);
    const pool = await readProspects(POSITION_HOUSE);
    expect(pool.find((p) => p.domain === 'stellar.example')).toMatchObject({ match: 1, belongsTo: chains.id });
    expect(pool.find((p) => p.domain === 'limitless.example').proofs[0]).toMatchObject({ met: true });
    // A no-fit company is never put on the ledger.
    const stellar = pool.find((p) => p.domain === 'stellar.example');
    expect((await actAs('sales/lead', { id: stellar.id, person: { name: 'Sam Star', role: 'BD' }, email: 'sam@stellar.example', emailSource: 'https://stellar.example/team' })).error).toMatch(/is no match/);
  }, 60000);

  test('a company scored BEFORE the rule: nothing is done with it until it is proved; proved not met, it leaves by itself — moved with its lead to the audience it belongs to, the waiting email withdrawn', async () => {
    const now = new Date().toISOString();
    const old = makeSegment(audience({ id: ua.id })); // as it was scored then: nothing required
    const [bnb, stox] = (await addProspects(POSITION_HOUSE, [
      makeProspect({ segment: old, ...company('bnb.example', 'BNB Chain'), people: [{ name: 'Bo Bee', role: 'Growth', sourceUrl: 'https://bnb.example/team' }], by: LANE, now }),
      makeProspect({ segment: old, ...company('stox.example', 'Stox'), people: [{ name: 'Sy Tock', role: 'Founder', sourceUrl: 'https://stox.example/team' }], by: LANE, now }),
    ])).added;
    // Before any proof: the ledger gate names exactly what is owed.
    const early = await actAs('sales/lead', { id: stox.id, person: 0, email: 'sy@stox.example', emailSource: 'https://stox.example/team' });
    expect(early.error).toMatch(/^Stox was scored before "Token Projects on Base & Robinhood" required: its token, project or community is on Base or Robinhood Chain — prove it either way from its own site first: sales\/prove/);

    // BNB already became a lead with an email waiting, as the 13 did.
    const ledger = await leadLedgerFor(POSITION_HOUSE);
    const lead = await ledger.add({ name: 'Bo Bee, Growth at BNB Chain', contact: 'bo@bnb.example', channelId: 'email', kind: 'buyer', status: 'cold', addedBy: LANE, source: `lead engine [${ua.id}]` });
    const { settleProspect } = await import('../../backend/services/sales/sales-store.js');
    await settleProspect(POSITION_HOUSE, bnb.id, { type: 'promoted', leadId: lead.id, by: LANE });
    const waiting = await stageDraft(POSITION_HOUSE, { to: ['bo@bnb.example'], subject: 'Umbrae: Your Token On Our DLMM', text: 'Hello, list your pool.', by: LANE });

    const bad = await actAs('sales/prove', { segment: ua.id, companies: [{ id: stox.id, proofs: [{ sign: SIGN, met: true, quote: 'Stox is the home of tokenised stocks.', source: 'https://stox.example/' }] }] });
    expect(bad.error).toMatch(/companies\[0\] \(Stox\): REQUIRED .* the quote must hold "base" or "robinhood chain" or "robinhood"/);
    const proved = await actAs('sales/prove', { segment: ua.id, companies: [
      { id: bnb.id, proofs: [{ sign: SIGN, met: false, reasoning: 'BNB Chain is its own layer-1; it is not a project on Base or Robinhood' }] },
      { id: stox.id, proofs: [{ sign: SIGN, met: true, quote: 'Stox is live on Base and on Robinhood Chain.', source: 'https://stox.example/' }] },
    ] });
    expect(proved.status, proved.error).toBe('ok');
    expect(proved.content).toContain(`[${stox.id}] Stox: MEETS what "Token Projects on Base & Robinhood" requires.`);
    // NOT MET, and the audience says where such a company belongs: it is MOVED there, never thrown away (Design note, 2026-11-21 —
    // its lead, nobody written to yet, goes with it, and the email written for the audience it left is withdrawn.
    expect(proved.content).toContain(`[${bnb.id}] BNB Chain: DOES NOT — no fit for "Token Projects on Base & Robinhood"; MOVED to [${chains.id}] "Chain Partnerships", where its own run screens it; 1 email(s) written for "Token Projects on Base & Robinhood" withdrawn.`);
    expect((await readOutbox(POSITION_HOUSE)).drafts.find((d) => d.id === waiting.id)).toMatchObject({ state: 'withdrawn' });
    const kept = (await ledger.load()).find((l) => l.id === lead.id);
    expect(kept).toMatchObject({ status: 'cold', contact: 'bo@bnb.example' }); // still a lead to write to, under the audience it belongs to
    expect(kept.touches.at(-1).note).toMatch(/^moved to "Chain Partnerships": does not meet what "Token Projects on Base & Robinhood" requires/);
    // Proved met, the other moves on — once the house's screening has validated it, as every lead is (a lead run does it).
    expect((await actAs('sales/lead', { id: stox.id, person: 0, email: 'sy@stox.example', emailSource: 'https://stox.example/team' })).error).toMatch(/has not been VALIDATED yet .* Start a lead run for this audience: sales\/run/);
    expect(await listScreened(POSITION_HOUSE, ua.id, [stox.id], 'lead-run:test')).toBe(1);
    const after = await actAs('sales/lead', { id: stox.id, person: 0, email: 'sy@stox.example', emailSource: 'https://stox.example/team' });
    expect(after.status, after.error).toBe('ok');
    // An audience that requires nothing has nothing to prove.
    expect((await actAs('sales/prove', { segment: chains.id, companies: [{ id: 'p-x', proofs: [] }] })).error).toMatch(/requires nothing of a company beyond its scored signs/);
  }, 60000);
});
