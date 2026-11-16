/**
 * THE POSITION MAP and the POSITIONS window's reading (RULE 0, nothing faked):
 * the map checked against the REAL intent registry, the REAL connections list
 * and the REAL seat factories in the tree; the hub rendered for real
 * (react-dom/server) over a board folded by the REAL backend fold.
 */
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { POSITIONS, positionOf, officeOfWaiting, positionMapText } from '../../backend/services/positions/position-map.js';
import { foldBoard } from '../../backend/services/positions/position-board.js';
import { companyFile, companiesText } from '../../backend/services/positions/company-file.js';
import { MODEL_FIELDS, makeModel, foldModels } from '../../backend/services/positions/business-model.js';
import { modelState, draftOf, readyToSave, changed, workItOutAsk, rowsFor } from '../../frontend/app/RelinkShell/positions/business-model-view.js';
import { setupOf, setupText } from '../../backend/services/positions/position-setup.js';
import { stepWords, helpAsk } from '../../frontend/app/RelinkShell/positions/positions-view.js';
import { doorPlan } from '../../frontend/app/RelinkShell/doors/door-plan.js';
import { intentTypes } from '../../backend/services/intents/registry.js';
import { SHED_LADDER } from '../../backend/services/envelope-budget.js';
import { finalizeTurnEnvelope } from '../../backend/services/turn-envelope.js';
import { KIND_LABEL } from '../../frontend/app/RelinkShell/waiting/waiting-view.js';
import { hubTabs, railRow, railSummary, pickPosition, pickTab, seatOptions, titleSeat } from '../../frontend/app/RelinkShell/positions/positions-view.js';
import { PositionHub } from '../../frontend/app/RelinkShell/positions/PositionHub.jsx';

const ROOT = path.resolve(import.meta.dirname, '../..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe('the position map', () => {
  test('names only acts the house really has, and no act twice', () => {
    const real = new Set(intentTypes().map((t) => t.name));
    const acts = POSITIONS.flatMap((p) => p.functions.flatMap((f) => f.acts));
    expect(acts.filter((a) => !real.has(a))).toEqual([]);
    // One act, one position, except the business model: every seat that speaks for a company may file it.
    const own = acts.filter((a) => a !== 'company/model');
    expect(new Set(own).size).toBe(own.length);
  });

  test('names only tools the catalog really offers', () => {
    const source = walk(path.join(ROOT, 'backend/services')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    for (const tool of POSITIONS.flatMap((p) => p.functions.flatMap((f) => f.tools))) expect(source).toContain(`name: '${tool}'`);
  });

  test('names only connections the list really holds and waiting kinds the desk really labels', () => {
    const ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron/connections.json'), 'utf8')).connections.map((c) => c.id);
    for (const p of POSITIONS) {
      for (const id of p.connections) expect(ids).toContain(id);
      for (const kind of p.waiting) expect(Object.keys(KIND_LABEL)).toContain(kind);
    }
  });

  test('THE GUARD: every seat a house can fill stands on the map', () => {
    const seats = walk(path.join(ROOT, 'backend/services')).filter((f) => f.endsWith('.js'))
      .flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/createHouseSeat\(\{ office: '([a-z]+)'/g)].map((m) => m[1]));
    expect(seats.length).toBeGreaterThanOrEqual(6);
    expect([...seats, 'cos'].filter((office) => !positionOf(office))).toEqual([]);
    expect(POSITIONS.map((p) => p.office).filter((office) => ![...seats, 'cos'].includes(office))).toEqual([]);
  });

  test('a waiting item goes to its kind\'s position, else to the position its asker holds, else to none', () => {
    const holders = { cos: 'kael', cro: 'merc', cmo: 'aure', clo: null, cso: null, cfo: null, cao: null };
    expect(officeOfWaiting({ kind: 'post', who: { laneId: 'merc' } }, holders)).toBe('cmo');
    expect(officeOfWaiting({ kind: 'spend' }, holders)).toBe('cfo');
    expect(officeOfWaiting({ kind: 'approval', who: { laneId: 'merc' } }, holders)).toBe('cro');
    expect(officeOfWaiting({ kind: 'approval', who: { laneId: 'stranger' } }, holders)).toBe(null);
    expect(officeOfWaiting({ kind: 'company-line', who: null }, holders)).toBe(null);
  });

  test('the holder reads its own position and nothing else; a lane with no seat reads nothing', () => {
    expect(positionMapText([])).toBe('');
    const text = positionMapText(['cro']);
    expect(text).toMatch(/^## YOUR POSITION/);
    // Named the one way every surface names it: the seat, its short form, its title, then its work.
    expect(text).toContain('CHIEF REVENUE OFFICER — CRO, the Mercator; its work is sales:');
    expect(text).toContain('"POSITIONS → CHIEF REVENUE OFFICER → <the tab>"');
    expect(text).toContain('- LEADS:');
    expect(text).toContain('sales/segment');
    expect(text).not.toContain('legal/scan');
    expect(positionMapText(['cro', 'clo'])).toContain('legal/scan');
  });

  test('the section rides the prompt only when it has words, and the shed ladder knows it', () => {
    const base = [{ id: 'core', label: 'CORE', text: 'x' }];
    expect(finalizeTurnEnvelope({ baseSections: base }).some((s) => s.id === 'positionMap')).toBe(false);
    expect(finalizeTurnEnvelope({ baseSections: base, positionMap: positionMapText(['cao']) }).find((s) => s.id === 'positionMap').label).toBe('YOUR POSITION');
    expect(SHED_LADDER).toContain('positionMap');
  });
});

describe('setting up a position', () => {
  const bare = { mailbox: false, mailboxHolder: null, mailWatch: false, leadSources: false, companiesWithoutSite: ['Umbrae'], factsFiled: false, factsApproved: false, audiences: 0, audiencesApproved: 0, salesCampaigns: 0, marketingCampaigns: 0, provider: false, accounts: 0, linkedin: false, modelsApproved: 0, modelsMissing: [], modelsWaiting: [] };
  const ready = { ...bare, modelsApproved: 1, mailbox: true, mailboxHolder: 'merc', mailWatch: true, leadSources: true, companiesWithoutSite: [], factsFiled: true, factsApproved: true, audiences: 1, audiencesApproved: 1, salesCampaigns: 1 };

  test('every step is measured: an empty seat has done nothing; a title or a mailbox held by someone else does not count', () => {
    const empty = setupOf('cro', null, bare);
    expect([empty.done, empty.total]).toEqual([0, 12]);
    expect(empty.steps.map((s) => [s.id, s.who, s.optional])).toEqual([['seat', 'operator', false], ['mailbox', 'operator', false], ['holder', 'operator', false], ['mail-watch', 'operator', false], ['lead-sources', 'operator', false], ['site', 'operator', false], ['model', 'operator', false], ['campaign', 'seat', false], ['facts', 'seat', false], ['facts-approved', 'operator', false], ['audience', 'seat', false], ['audience-approved', 'operator', false], ['provider', 'operator', true], ['paid-rule', 'operator', true]]);
    expect(setupOf('cro', 'merc', { ...ready, mailboxHolder: 'someone-else' }).open.map((s) => s.id)).toEqual(['holder', 'provider', 'paid-rule']);
    const done = setupOf('cro', 'merc', ready);
    expect([done.done, done.total, done.open.map((s) => s.id)]).toEqual([12, 12, ['provider', 'paid-rule']]);
    // A position with no steps of its own still needs its seat filled.
    expect(setupOf('clo', null, bare)).toMatchObject({ done: 0, total: 1 });
    expect(setupOf('clo', 'rugevil', bare)).toMatchObject({ done: 1, total: 1, open: [] });
  });

  test('the holder reads its own steps, then the operator\'s in the exact words to pass on; a finished position reads only the optional one', () => {
    const text = setupText(['cro'], { cro: setupOf('cro', 'merc', bare) });
    expect(text).toMatch(/^## SETTING UP YOUR POSITION — guide your operator through what only they can do\nCHIEF REVENUE OFFICER: 1 of 12 set up\./);
    expect(text).toContain('Yours to do now:\n- Open the first campaign. File sales/campaign');
    expect(text).toContain('Only your operator can do these. Tell them each one in these words, one at a time, and say why it matters:\n- Connect the mailbox the house sends from. POSITIONS, CHIEF REVENUE OFFICER, MAILBOX: enter the email address');
    expect(text).toContain('add the site address for Umbrae');
    expect(text).toContain('Never say a step is done because you were told so.');
    expect(setupText(['cro'], { cro: setupOf('cro', 'merc', ready) })).toMatch(/Optional, when they ask for more: Attach a contact-data provider/);
    expect(setupText(['cro'], { cro: setupOf('cro', 'merc', { ...ready, provider: true, spendChosen: true }) })).toBe('');
    expect(setupText(['clo'], { clo: setupOf('clo', 'rugevil', bare) })).toBe('');
    // Marketing's LinkedIn step carries the address to register, word for word.
    expect(setupOf('cmo', 'aure', bare).steps.find((s) => s.id === 'linkedin').how).toContain('http://127.0.0.1:53682/linkedin/callback');
  });

  test('the window words each step by who does it; SETUP leads the tabs while a needed step is open and steps back when all are done', () => {
    const [seat, mailbox] = setupOf('cro', 'merc', bare).steps;
    expect(stepWords(seat)).toBe('DONE — Seat a member as CHIEF REVENUE OFFICER');
    expect(stepWords(mailbox)).toBe('YOURS — Connect the mailbox the house sends from');
    expect(stepWords(setupOf('cro', 'merc', bare).steps.find((s) => s.id === 'facts'))).toBe('THE SEAT\'S — File what a buyer may be told');
    expect(setupOf('cro', 'merc', ready).steps.slice(-2).map(stepWords)).toEqual(['OPTIONAL — Attach a contact-data provider', 'OPTIONAL — Say when paid lead data may be spent']);
    const position = (state) => foldBoard({ holders: { cos: null, cro: 'merc', cmo: null, clo: null, cso: null, cfo: null, cao: null }, names: new Map([['merc', 'Sol']]), waiting: [], connections: [], setupState: state }).find((p) => p.office === 'cro');
    expect(hubTabs(position(bare))[0]).toEqual({ id: '_setup', label: 'SETUP · 1/12' });
    expect(pickTab(position(bare), undefined)).toBe('_setup');
    expect(hubTabs(position(ready)).map((t) => t.id)).toEqual(['model', 'campaigns', 'leads', 'deals', 'mailbox', '_switches', '_eyes', '_setup']);
    expect(hubTabs(position(ready)).at(-1).label).toBe('SETUP · DONE');
    expect(railRow(position(bare))).toMatchObject({ setupOpen: 11, setup: '1/12' });
  });

  test('every open step is one press from its place: a tab here, a door on the desk, a page outside, or the seat with the ask drafted', () => {
    const state = { ...bare, companiesNoSite: [{ id: 'umbrae', name: 'Umbrae' }] };
    const by = Object.fromEntries(setupOf('cro', 'merc', state).steps.map((s) => [s.id, s]));
    expect(by.mailbox.go).toEqual({ tab: 'mailbox', label: '2 · ENTER IT IN MAILBOX' });
    expect(by.mailbox.link).toEqual({ url: 'https://myaccount.google.com/apppasswords', label: '1 · GET A GOOGLE APP PASSWORD' });
    expect(by['mail-watch'].go.tab).toBe('_switches');
    expect(by['facts-approved'].go.tab).toBe('model');
    expect(by['audience-approved'].go.tab).toBe('campaigns');
    expect(by.site.door).toEqual({ kind: 'brand', companyId: 'umbrae', section: 'sources', label: 'SITE & CODE' });
    // A key is fetched first, then pasted in its own row and nowhere else: the door lands on that service's field.
    expect(by.provider).toMatchObject({ optional: true, link: { url: 'https://hunter.io/api-keys', label: '1 · GET THE KEY AT HUNTER' }, door: { kind: 'service', serviceId: 'hunter', label: '2 · PASTE IT HERE' } });
    expect(doorPlan(by.provider.door)).toEqual({ open: 'settings', settingsFocus: 'service-keys/hunter', reveal: '[data-window-id="settings"] [data-service-input="hunter"]' });
    expect(doorPlan({ kind: 'service' })).toBe(null);
    // A seat's step is handed to its holder as an ask that makes it propose first and ask for what it needs.
    for (const id of ['campaign', 'facts', 'audience']) expect(by[id]).toMatchObject({ who: 'seat', ask: expect.stringMatching(/ask me/i) });
    // Every open step past the seat reaches somewhere; a tab named is a tab the hub really has.
    const positions = foldBoard({ holders: { cos: null, cro: 'merc', cmo: 'aure', clo: null, cso: null, cfo: null, cao: null }, names: new Map([['merc', 'Sol'], ['aure', 'Aure']]), waiting: [], connections: [{ id: 'mail-watch' }, { id: 'lead-sources' }], setupState: state });
    for (const p of positions.filter((x) => ['cro', 'cmo'].includes(x.office))) {
      const tabs = hubTabs(p).map((t) => t.id);
      for (const s of p.setup.steps.filter((x) => x.id !== 'seat')) {
        expect(Boolean(s.go || s.door || s.link || s.ask), `${p.office}.${s.id}`).toBe(true);
        if (s.go) expect(tabs, `${p.office}.${s.id}`).toContain(s.go.tab);
      }
    }
    expect(helpAsk(by.mailbox)).toMatch(/^Walk me through this setup step for your position, one action at a time, and tell me what you need from me to finish it: Connect the mailbox/);
    // The hub renders the presses: the tab, the page outside, the door, and the two hands to the holder.
    const html = renderToStaticMarkup(createElement(PositionHub, { position: positions.find((x) => x.office === 'cro'), members: [], names: {}, tab: '_setup', now: 0, busy: false, pick: '', confirmClear: false, eyes: null,
      onTab: () => {}, onPick: () => {}, onSeat: () => {}, onAskClear: () => {}, onClear: () => {}, onTalk: () => {}, onOpenWaiting: () => {}, onSwitch: () => {} }));
    // What is fetched outside stands before the place it goes.
    expect(html.indexOf('1 · GET A GOOGLE APP PASSWORD')).toBeGreaterThan(0);
    expect(html.indexOf('1 · GET A GOOGLE APP PASSWORD')).toBeLessThan(html.indexOf('2 · ENTER IT IN MAILBOX'));
    expect(html.indexOf('1 · GET THE KEY AT HUNTER')).toBeLessThan(html.indexOf('2 · PASTE IT HERE'));
    expect(html).toContain('GO TO SWITCHES');
    expect(html).toContain('href="https://myaccount.google.com/apppasswords"');
    expect(html).toContain('OPEN SITE &amp; CODE');
    expect(html).toContain('HAND TO SOL');
    expect(html).toContain('ASK SOL');
  });
});

const MODEL = { sells: 'A swap venue on Base where anyone opens a pool', buyer: 'Token teams on Base; the founder decides', problem: 'Thin liquidity makes every trade of their token cost more', value: 'Their token trades with less slippage, shown on the pool page', price: 'Free to open; the venue earns 5% of each swap fee' };

describe('the business model of a company', () => {
  test('a model needs what it sells, who pays, their problem, what changes for them and the price; proof and the next aim are optional', () => {
    expect(MODEL_FIELDS.map((f) => [f.key, Boolean(f.optional)])).toEqual([['sells', false], ['buyer', false], ['problem', false], ['value', false], ['price', false], ['proof', true], ['next', true]]);
    expect(makeModel({ ...MODEL, proof: '  42 pools \n live ' })).toEqual({ ...MODEL, proof: '42 pools live', next: '' });
    // An answer too long to keep whole is refused in words, never cut short in silence.
    expect(() => makeModel({ ...MODEL, buyer: 'x'.repeat(401) })).toThrow(/too long to keep whole — shorten: buyer \(401 characters, at most 400\)/);
    expect([rowsFor(''), rowsFor('x'.repeat(91)), rowsFor('x'.repeat(400)), rowsFor('a\nb\nc')]).toEqual([2, 2, 5, 3]);
    expect(() => makeModel({ ...MODEL, value: '', price: ' ' })).toThrow(/a business model needs: value \(what changes for them\), price \(what it costs and how you earn\)/);
  });

  test('the operator\'s model stands at once; a member\'s waits, and is approved or returned', () => {
    const filed = { type: 'filed', company: 'umbrae', model: MODEL, by: 'merc', at: 't1' };
    expect(foldModels([filed]).get('umbrae')).toMatchObject({ approved: null, proposal: MODEL, by: 'merc' });
    expect(foldModels([filed, { type: 'approved', company: 'umbrae', at: 't2' }]).get('umbrae')).toMatchObject({ approved: MODEL, proposal: null });
    expect(foldModels([filed, { type: 'returned', company: 'umbrae', note: 'say the price', at: 't2' }]).get('umbrae')).toMatchObject({ approved: null, proposal: null, returned: 'say the price' });
    expect(foldModels([{ ...filed, by: 'operator' }]).get('umbrae')).toMatchObject({ approved: MODEL, proposal: null });
    // A new proposal never unseats the model that stands; an approval with nothing waiting changes nothing.
    const next = { ...MODEL, price: 'A new fee' };
    expect(foldModels([{ ...filed, by: 'operator' }, { ...filed, model: next }]).get('umbrae')).toMatchObject({ approved: MODEL, proposal: next });
    expect(foldModels([{ type: 'approved', company: 'umbrae', at: 't0' }]).get('umbrae')).toMatchObject({ approved: null, proposal: null });
  });

  test('the setup step is the operator\'s, comes before the campaign, and reaches the tab or the holder with the questions drafted', () => {
    const state = { mailbox: false, mailboxHolder: null, mailWatch: false, leadSources: false, companiesWithoutSite: [], factsFiled: false, factsApproved: false, audiences: 0, audiencesApproved: 0, salesCampaigns: 0, marketingCampaigns: 0, provider: false, accounts: 0, linkedin: false, modelsApproved: 0, modelsMissing: [], modelsWaiting: [] };
    for (const office of ['cro', 'cmo']) {
      const ids = setupOf(office, 'x', state).steps.map((s) => s.id);
      expect(ids.indexOf('model'), office).toBeLessThan(ids.indexOf('campaign'));
      expect(ids.indexOf('model'), office).toBeGreaterThan(ids.indexOf('site'));
    }
    const step = setupOf('cro', 'merc', state).steps.find((s) => s.id === 'model');
    expect(step).toMatchObject({ who: 'operator', done: false, go: { tab: 'model', label: 'COMPANY' }, askLabel: 'WORK IT OUT WITH', ask: expect.stringMatching(/one question at a time[\s\S]*a result they can check, not a feeling[\s\S]*company\/model/) });
    // Done only when a model stands, none waits, and no company already worked for lacks one.
    const of = (extra) => setupOf('cro', 'merc', { ...state, ...extra }).steps.find((s) => s.id === 'model');
    expect(of({ modelsApproved: 1 }).done).toBe(true);
    expect(of({ modelsApproved: 1, modelsMissing: ['Umbrae'] })).toMatchObject({ done: false, how: expect.stringContaining('still missing for Umbrae') });
    expect(of({ modelsApproved: 1, modelsWaiting: ['Umbrae'] })).toMatchObject({ done: false, label: 'Approve the business model filed for Umbrae' });
    // The hub words the press to the holder as working it out, not as a walk-through.
    const position = foldBoard({ holders: { cos: null, cro: 'merc', cmo: null, clo: null, cso: null, cfo: null, cao: null }, names: new Map([['merc', 'Sol']]), waiting: [], connections: [], setupState: state }).find((p) => p.office === 'cro');
    const html = renderToStaticMarkup(createElement(PositionHub, { position, members: [], names: {}, tab: '_setup', now: 0, busy: false, pick: '', confirmClear: false, eyes: null,
      onTab: () => {}, onPick: () => {}, onSeat: () => {}, onAskClear: () => {}, onClear: () => {}, onTalk: () => {}, onOpenWaiting: () => {}, onSwitch: () => {} }));
    expect(html).toContain('GO TO COMPANY');
    expect(html).toContain('>WORK IT OUT WITH SOL<');
  });

  test('the tab reads where each model stands and saves only a whole, changed one', () => {
    const company = { id: 'umbrae', name: 'Umbrae', model: null, modelProposal: null, modelReturned: null };
    expect(modelState(company)).toBe('NOT WRITTEN YET');
    expect(modelState({ ...company, model: MODEL })).toBe('APPROVED');
    expect(modelState({ ...company, modelProposal: { model: MODEL, by: 'merc' } }, { merc: 'Sol' })).toBe('WAITING ON YOU — FILED BY SOL');
    expect(modelState({ ...company, modelReturned: 'say the price' })).toBe('RETURNED — NOT WRITTEN YET');
    const empty = draftOf(company, MODEL_FIELDS);
    expect(readyToSave(empty, MODEL_FIELDS)).toBe(false);
    expect(readyToSave({ ...empty, ...MODEL }, MODEL_FIELDS)).toBe(true);
    // The form starts from what waits, before what stands.
    const waiting = { ...company, model: MODEL, modelProposal: { model: { ...MODEL, price: 'A new fee' }, by: 'merc' } };
    expect(draftOf(waiting, MODEL_FIELDS).price).toBe('A new fee');
    expect(changed(draftOf(waiting, MODEL_FIELDS), waiting, MODEL_FIELDS)).toBe(false);
    expect(changed({ ...draftOf(waiting, MODEL_FIELDS), price: 'Another' }, waiting, MODEL_FIELDS)).toBe(true);
    expect(workItOutAsk(company)).toMatch(/^Work out the business model of Umbrae with me\. Ask me one question at a time[\s\S]*company: "umbrae"/);
  });
});

describe('the company file', () => {
  const umbrae = { id: 'umbrae', name: 'Umbrae', parentId: 'ignis', site: { url: 'https://umbrae.io', links: [] }, legalEntity: null, repos: [{}] };
  const facts = { sheet: { id: 'fs-1', facts: [] }, review: { verdict: 'approved' }, approved: { id: 'fs-1', facts: [
    { n: 1, company: 'umbrae', claim: 'Liquidity providers keep 95% of every swap fee' }, { n: 2, company: 'ignis', claim: 'Sessions run 60 minutes' }] } };
  const segments = [{ id: 's-1', name: 'Base token teams', company: 'umbrae', state: 'approved' }, { id: 's-2', name: 'Founders', company: 'ignis', state: 'draft' }, { id: 's-3', name: 'Old', company: 'umbrae', state: 'retired' }];

  test('joins what stands for ONE company and leaves a sister company out', () => {
    const file = companyFile(umbrae, { facts, segments, models: foldModels([{ type: 'filed', company: 'umbrae', model: MODEL, by: 'operator', at: 't1' }]), campaigns: [{ id: 'c-1', name: 'Umbrae Market Depth', companyId: 'umbrae' }, { id: 'c-2', name: 'Neuma User Adoption', companyId: 'deus-neuma' }] });
    expect(file).toMatchObject({ id: 'umbrae', site: 'https://umbrae.io', parent: 'ignis', repos: 1, missing: [] });
    expect(file.facts.map((f) => f.n)).toEqual([1]);
    expect(file.audiences).toEqual([{ id: 's-1', name: 'Base token teams', state: 'approved' }]);
    expect(file.campaigns.map((c) => c.name)).toEqual(['Umbrae Market Depth']);
    const text = companiesText([file]);
    expect(text).toContain('Umbrae [umbrae], part of ignis: site https://umbrae.io');
    expect(text).toContain('- Liquidity providers keep 95% of every swap fee');
    // The approved model is read before the facts, and everything said starts from it.
    expect(text).toMatch(/Business model \(approved by the operator\):\n {2}- what you sell: A swap venue on Base[\s\S]*- what changes for them: Their token trades with less slippage[\s\S]*What a buyer may be told/);
    expect(text).toContain('why are you at my door');
    expect(text).not.toContain('Sessions run 60 minutes');
    expect(text).not.toContain('MISSING');
  });

  test('names what is missing and tells the seat to say nothing that rests on it', () => {
    const bare = companyFile({ id: 'deus-neuma', name: 'Deus Neuma', parentId: null, site: { url: null, links: [] }, repos: [] }, { facts: null, segments: [], campaigns: [] });
    expect(bare.missing).toHaveLength(3);
    expect(bare.missing[0]).toMatch(/^its business model: what it sells, who pays, what it costs and what objectively changes for the buyer/);
    expect(companiesText([bare])).toMatch(/Deus Neuma \[deus-neuma\]: site NOT SET[\s\S]*MISSING: its business model[\s\S]*; its site address[\s\S]*Say nothing about Deus Neuma that rests on a missing item/);
    expect(companiesText([])).toBe('');
  });
});

const NAMES = new Map([['merc', 'Sol'], ['aure', 'Metidar']]);
const board = () => foldBoard({
  holders: { cos: null, cro: 'merc', cmo: 'aure', clo: null, cso: null, cfo: null, cao: null },
  names: NAMES,
  waiting: [
    { id: 'post:1', kind: 'post', title: 'a post about the launch', who: { laneId: 'aure' }, where: { app: 'marketing' }, at: '2026-11-14T10:00:00.000Z' },
    { id: 'card:7', kind: 'approval', title: 'email.send', who: { laneId: 'merc' }, where: { app: 'chat' }, at: '2026-11-14T11:00:00.000Z' },
    { id: 'charter:3', kind: 'charter', title: 'the house charter, version 3', who: null, where: { app: 'houseclock' }, at: '2026-11-14T09:00:00.000Z' },
  ],
  connections: [{ id: 'mail-watch', name: 'House mailbox watch', control: 'switch', on: false, whileOff: 'new mail waits until a being or you check the mailbox' }],
});

describe('the positions board and window', () => {
  test('every position stands once, with its holder, its own waiting items and its switches', () => {
    const positions = board();
    expect(positions.map((p) => p.office)).toEqual(POSITIONS.map((p) => p.office));
    const sales = positions.find((p) => p.office === 'cro');
    expect(sales.holder).toEqual({ laneId: 'merc', name: 'Sol' });
    expect(sales.waiting.map((w) => w.id)).toEqual(['card:7']);
    // A connection the list does not carry in this read still stands on the hub, by its id, off.
    expect(sales.connections).toEqual([{ id: 'mail-watch', name: 'House mailbox watch', on: false, whileOff: 'new mail waits until a being or you check the mailbox' }, { id: 'lead-sources', name: 'lead-sources', on: false, whileOff: null }]);
    expect(positions.find((p) => p.office === 'cmo').waiting.map((w) => w.id)).toEqual(['post:1']);
    expect(positions.find((p) => p.office === 'cos').waiting.map((w) => w.id)).toEqual(['charter:3']);
    expect(positions.find((p) => p.office === 'clo').holder).toBe(null);
  });

  test('the rail counts what it lists; the window opens on what waits', () => {
    const positions = board();
    expect(railSummary(positions)).toBe('2/7 HELD · 3 WAITING ON YOU');
    expect(railRow(positions.find((p) => p.office === 'cro'))).toEqual({ office: 'cro', seat: 'CHIEF REVENUE OFFICER', acronym: 'CRO', plain: 'SALES', title: 'Mercator', holder: 'Sol', waiting: 1, off: 2, setupOpen: 0, setup: null });
    expect(pickPosition(positions, 'clo').office).toBe('clo');
    expect(pickPosition(positions, 'nope').office).toBe('cos');
    expect(pickPosition([], 'cro')).toBe(null);
    const sales = positions.find((p) => p.office === 'cro');
    expect(hubTabs(sales).map((t) => t.id)).toEqual(['model', 'campaigns', 'leads', 'deals', 'mailbox', '_switches', '_eyes']);
    expect(hubTabs(sales).find((t) => t.id === '_switches').label).toBe('SWITCHES · 0/2');
    expect(hubTabs(positions.find((p) => p.office === 'clo')).map((t) => t.id)).toEqual(['legal', '_eyes']);
    expect(pickTab(sales, 'mailbox')).toBe('mailbox');
    expect(pickTab(sales, 'legal')).toBe('model');
    expect(seatOptions([{ laneId: 'merc', name: 'Sol' }, { laneId: 'aure', name: 'Metidar' }], sales)).toEqual([{ value: 'aure', label: 'Metidar' }]);
  });

  const render = (office, tab, extra = {}) => {
    const position = board().find((p) => p.office === office);
    return renderToStaticMarkup(createElement(PositionHub, {
      position, members: [{ laneId: 'merc', name: 'Sol' }, { laneId: 'aure', name: 'Metidar' }], names: { merc: 'Sol' }, tab, now: Date.parse('2026-11-14T12:00:00.000Z'),
      busy: false, pick: '', confirmClear: false, eyes: null, onTab: () => {}, onPick: () => {}, onSeat: () => {}, onAskClear: () => {}, onClear: () => {},
      onTalk: () => {}, onOpenWaiting: () => {}, onSwitch: () => {}, ...extra,
    }));
  };

  test('a held position shows its holder, what waits, its switches and what its holder is told', () => {
    const switches = render('cro', '_switches');
    expect(switches).toContain('HELD BY SOL');
    expect(switches).toContain('WAITING ON YOU · 1');
    expect(switches).toContain('APPROVAL');
    expect(switches).toContain('1H');
    expect(switches).toContain('House mailbox watch');
    expect(switches).toMatch(/aria-pressed="false"[^>]*>OFF</);
    expect(switches).toContain('UNSEAT');
    const eyes = render('cro', '_eyes', { eyes: { laneId: 'merc', text: '## YOUR POSITION\nSALES (Mercator)' } });
    expect(eyes).toContain('This is what Sol reads at the top of every turn, word for word.');
    expect(eyes).toContain('SALES (Mercator)');
    expect(render('cro', '_eyes', { confirmClear: true })).toContain('PRESS AGAIN TO UNSEAT');
  });

  test('an empty position says so, offers no unseat, and tells nobody anything', () => {
    const html = render('clo', '_eyes');
    expect(html).toContain('NOBODY HOLDS THIS POSITION');
    expect(html).not.toContain('UNSEAT');
    expect(html).not.toContain('TALK');
    expect(html).toContain('Nobody holds this position, so nobody is told anything.');
    expect(html).not.toContain('WAITING ON YOU');
  });
});

describe('a title and its seat are one office', () => {
  const positions = foldBoard({ holders: { cos: null, cro: 'merc', cmo: null, clo: null, cso: null, cfo: null, cao: null }, names: new Map([['merc', 'Sol']]), waiting: [], connections: [] });
  test('a title that names a position says whether its member holds the seat, and who does', () => {
    expect(titleSeat({ neumaId: 'merc', title: 'Mercator' }, positions)).toEqual({ office: 'cro', plain: 'CHIEF REVENUE OFFICER', held: true, holder: 'Sol', words: 'HOLDS THE CHIEF REVENUE OFFICER SEAT' });
    expect(titleSeat({ neumaId: 'aure', title: 'mercator ' }, positions)).toMatchObject({ office: 'cro', held: false, words: 'TITLE ONLY — THE CHIEF REVENUE OFFICER SEAT IS HELD BY SOL' });
    // A title may name the seat by its title word, its short form or the seat itself.
    expect(titleSeat({ neumaId: 'aure', title: 'CMO' }, positions)).toMatchObject({ office: 'cmo', held: false, words: 'TITLE ONLY — THE CHIEF MARKETING OFFICER SEAT IS EMPTY' });
    expect(titleSeat({ neumaId: 'aure', title: 'Legatus' }, positions)?.office).toBe('cmo');
    expect(titleSeat({ neumaId: 'aure', title: 'chief of staff' }, positions)?.office).toBe('cos');
    // Every position's own title is known; a title of the house's own invention names no seat.
    expect(POSITIONS.map((p) => titleSeat({ neumaId: 'x', title: p.title }, positions)?.office)).toEqual(POSITIONS.map((p) => p.office));
    expect([titleSeat({ neumaId: 'x', title: 'Curator' }, positions), titleSeat({ neumaId: 'x', title: null }, positions), titleSeat({ neumaId: 'x', title: 'CMO' }, null)]).toEqual([null, null, null]);
  });
});

describe('a section is a line first (design-language.md § FOLD)', () => {
  test('it stands open exactly when it waits on the operator, until they choose for themselves', async () => {
    const { foldOpen, statOf } = await import('../../frontend/app/RelinkShell/fold/fold-state.js');
    expect([foldOpen(null, true), foldOpen(null, false), foldOpen('1', false), foldOpen('0', true)]).toEqual([true, false, true, false]);
    expect([statOf('3 FACTS'), statOf({ text: 'APPROVED', tone: 'on' })]).toEqual([{ text: '3 FACTS', tone: null }, { text: 'APPROVED', tone: 'on' }]);
  });

  test('the line carries the state and the counts, so folding hides no number', async () => {
    const { Fold } = await import('../../frontend/app/RelinkShell/fold/Fold.jsx');
    const html = renderToStaticMarkup(createElement(Fold, { id: 't:1', title: 'UMBRAE', waits: true, level: 2, stats: ['6 FACTS', { text: 'WAITS FOR YOUR APPROVAL', tone: 'alert' }] }, 'body'));
    expect(html).toBe('<details class="fold fold-l2 is-waiting" open="" data-fold="t:1"><summary class="fold-sum"><span class="fold-mark" aria-hidden="true">▾</span><span class="fold-title label-data">UMBRAE</span><span class="fold-stat label-data">6 FACTS</span><span class="fold-stat label-data is-alert">WAITS FOR YOUR APPROVAL</span></summary><div class="fold-body">body</div></details>');
    expect(renderToStaticMarkup(createElement(Fold, { id: 't:2', title: 'DO NOT CONTACT', stats: ['0 ENTRIES'] }, 'x'))).toContain('<details class="fold fold-l1" data-fold="t:2">');
    const { modelStats, modelsStats, modelsWait } = await import('../../frontend/app/RelinkShell/positions/business-model-view.js');
    const approved = { id: 'a', name: 'A', model: { sells: 'x', buyer: 'y', problem: 'z', value: 'v', price: 'p', proof: '', next: '' }, modelProposal: null };
    const none = { id: 'b', name: 'B', model: null, modelProposal: null };
    const waiting = { ...approved, id: 'c', modelProposal: { model: approved.model, by: 'merc' } };
    expect(modelStats(approved, MODEL_FIELDS)).toEqual([{ text: 'APPROVED', tone: 'on' }, '5 OF 7 ANSWERED']);
    expect(modelStats(none, MODEL_FIELDS)).toEqual([{ text: 'NOT WRITTEN YET', tone: 'alert' }]);
    expect(modelsStats([approved, none, waiting])).toEqual(['3 COMPANIES', { text: '1 APPROVED', tone: 'on' }, { text: '1 WAITING ON YOU', tone: 'alert' }, { text: '1 NOT WRITTEN', tone: 'alert' }]);
    expect([modelsWait([approved]), modelsWait([approved, none])]).toEqual([false, true]);
  });
});
