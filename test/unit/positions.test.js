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
import { setupOf, setupText } from '../../backend/services/positions/position-setup.js';
import { stepWords, helpAsk } from '../../frontend/app/RelinkShell/positions/positions-view.js';
import { intentTypes } from '../../backend/services/intents/registry.js';
import { SHED_LADDER } from '../../backend/services/envelope-budget.js';
import { finalizeTurnEnvelope } from '../../backend/services/turn-envelope.js';
import { KIND_LABEL } from '../../frontend/app/RelinkShell/waiting/waiting-view.js';
import { hubTabs, railRow, railSummary, pickPosition, pickTab, seatOptions } from '../../frontend/app/RelinkShell/positions/positions-view.js';
import { PositionHub } from '../../frontend/app/RelinkShell/positions/PositionHub.jsx';

const ROOT = path.resolve(import.meta.dirname, '../..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe('the position map', () => {
  test('names only acts the house really has, and no act twice', () => {
    const real = new Set(intentTypes().map((t) => t.name));
    const acts = POSITIONS.flatMap((p) => p.functions.flatMap((f) => f.acts));
    expect(acts.filter((a) => !real.has(a))).toEqual([]);
    expect(new Set(acts).size).toBe(acts.length);
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
    expect(text).toContain('SALES (Mercator)');
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
  const bare = { mailbox: false, mailboxHolder: null, mailWatch: false, leadSources: false, companiesWithoutSite: ['Umbrae'], factsFiled: false, factsApproved: false, audiences: 0, audiencesApproved: 0, salesCampaigns: 0, marketingCampaigns: 0, provider: false, accounts: 0, linkedin: false };
  const ready = { ...bare, mailbox: true, mailboxHolder: 'merc', mailWatch: true, leadSources: true, companiesWithoutSite: [], factsFiled: true, factsApproved: true, audiences: 1, audiencesApproved: 1, salesCampaigns: 1 };

  test('every step is measured: an empty seat has done nothing; a title or a mailbox held by someone else does not count', () => {
    const empty = setupOf('cro', null, bare);
    expect([empty.done, empty.total]).toEqual([0, 11]);
    expect(empty.steps.map((s) => [s.id, s.who, s.optional])).toEqual([['seat', 'operator', false], ['mailbox', 'operator', false], ['holder', 'operator', false], ['mail-watch', 'operator', false], ['lead-sources', 'operator', false], ['site', 'operator', false], ['campaign', 'seat', false], ['facts', 'seat', false], ['facts-approved', 'operator', false], ['audience', 'seat', false], ['audience-approved', 'operator', false], ['provider', 'operator', true]]);
    expect(setupOf('cro', 'merc', { ...ready, mailboxHolder: 'someone-else' }).open.map((s) => s.id)).toEqual(['holder', 'provider']);
    const done = setupOf('cro', 'merc', ready);
    expect([done.done, done.total, done.open.map((s) => s.id)]).toEqual([11, 11, ['provider']]);
    // A position with no steps of its own still needs its seat filled.
    expect(setupOf('clo', null, bare)).toMatchObject({ done: 0, total: 1 });
    expect(setupOf('clo', 'rugevil', bare)).toMatchObject({ done: 1, total: 1, open: [] });
  });

  test('the holder reads its own steps, then the operator\'s in the exact words to pass on; a finished position reads only the optional one', () => {
    const text = setupText(['cro'], { cro: setupOf('cro', 'merc', bare) });
    expect(text).toMatch(/^## SETTING UP YOUR POSITION — guide your operator through what only they can do\nSALES: 1 of 11 set up\./);
    expect(text).toContain('Yours to do now:\n- Open the first campaign. File sales/campaign');
    expect(text).toContain('Only your operator can do these. Tell them each one in these words, one at a time, and say why it matters:\n- Connect the mailbox the house sends from. POSITIONS, SALES, MAILBOX: enter the email address');
    expect(text).toContain('add the site address for Umbrae');
    expect(text).toContain('Never say a step is done because you were told so.');
    expect(setupText(['cro'], { cro: setupOf('cro', 'merc', ready) })).toMatch(/Optional, when they ask for more: Attach a contact-data provider/);
    expect(setupText(['cro'], { cro: setupOf('cro', 'merc', { ...ready, provider: true }) })).toBe('');
    expect(setupText(['clo'], { clo: setupOf('clo', 'rugevil', bare) })).toBe('');
    // Marketing's LinkedIn step carries the address to register, word for word.
    expect(setupOf('cmo', 'aure', bare).steps.find((s) => s.id === 'linkedin').how).toContain('http://127.0.0.1:53682/linkedin/callback');
  });

  test('the window words each step by who does it; SETUP leads the tabs while a needed step is open and steps back when all are done', () => {
    const [seat, mailbox] = setupOf('cro', 'merc', bare).steps;
    expect(stepWords(seat)).toBe('DONE — Seat a member in SALES');
    expect(stepWords(mailbox)).toBe('YOURS — Connect the mailbox the house sends from');
    expect(stepWords(setupOf('cro', 'merc', bare).steps.find((s) => s.id === 'facts'))).toBe('THE SEAT\'S — File what a buyer may be told');
    expect(stepWords(setupOf('cro', 'merc', ready).steps.at(-1))).toBe('OPTIONAL — Attach a contact-data provider');
    const position = (state) => foldBoard({ holders: { cos: null, cro: 'merc', cmo: null, clo: null, cso: null, cfo: null, cao: null }, names: new Map([['merc', 'Sol']]), waiting: [], connections: [], setupState: state }).find((p) => p.office === 'cro');
    expect(hubTabs(position(bare))[0]).toEqual({ id: '_setup', label: 'SETUP · 1/11' });
    expect(pickTab(position(bare), undefined)).toBe('_setup');
    expect(hubTabs(position(ready)).map((t) => t.id)).toEqual(['campaigns', 'leads', 'deals', 'mailbox', '_switches', '_eyes', '_setup']);
    expect(hubTabs(position(ready)).at(-1).label).toBe('SETUP · DONE');
    expect(railRow(position(bare))).toMatchObject({ setupOpen: 10, setup: '1/11' });
  });

  test('every open step is one press from its place: a tab here, a door on the desk, a page outside, or the seat with the ask drafted', () => {
    const state = { ...bare, companiesNoSite: [{ id: 'umbrae', name: 'Umbrae' }] };
    const by = Object.fromEntries(setupOf('cro', 'merc', state).steps.map((s) => [s.id, s]));
    expect(by.mailbox.go).toEqual({ tab: 'mailbox', label: 'MAILBOX' });
    expect(by.mailbox.link).toEqual({ url: 'https://myaccount.google.com/apppasswords', label: 'GOOGLE APP PASSWORDS' });
    expect(by['mail-watch'].go.tab).toBe('_switches');
    expect(by['facts-approved'].go.tab).toBe('leads');
    expect(by.site.door).toEqual({ kind: 'brand', companyId: 'umbrae', section: 'sources', label: 'SITE & CODE' });
    expect(by.provider).toMatchObject({ optional: true, link: { url: 'https://hunter.io/api-keys' }, door: { kind: 'app', app: 'settings' } });
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
    expect(html).toContain('GO TO MAILBOX');
    expect(html).toContain('href="https://myaccount.google.com/apppasswords"');
    expect(html).toContain('OPEN SITE &amp; CODE');
    expect(html).toContain('HAND TO SOL');
    expect(html).toContain('ASK SOL');
  });
});

describe('the company file', () => {
  const umbrae = { id: 'umbrae', name: 'Umbrae', parentId: 'ignis', site: { url: 'https://umbrae.io', links: [] }, legalEntity: null, repos: [{}] };
  const facts = { sheet: { id: 'fs-1', facts: [] }, review: { verdict: 'approved' }, approved: { id: 'fs-1', facts: [
    { n: 1, company: 'umbrae', claim: 'Liquidity providers keep 95% of every swap fee' }, { n: 2, company: 'ignis', claim: 'Sessions run 60 minutes' }] } };
  const segments = [{ id: 's-1', name: 'Base token teams', company: 'umbrae', state: 'approved' }, { id: 's-2', name: 'Founders', company: 'ignis', state: 'draft' }, { id: 's-3', name: 'Old', company: 'umbrae', state: 'retired' }];

  test('joins what stands for ONE company and leaves a sister company out', () => {
    const file = companyFile(umbrae, { facts, segments, campaigns: [{ id: 'c-1', name: 'Umbrae Market Depth', companyId: 'umbrae' }, { id: 'c-2', name: 'Neuma User Adoption', companyId: 'deus-neuma' }] });
    expect(file).toMatchObject({ id: 'umbrae', site: 'https://umbrae.io', parent: 'ignis', repos: 1, missing: [] });
    expect(file.facts.map((f) => f.n)).toEqual([1]);
    expect(file.audiences).toEqual([{ id: 's-1', name: 'Base token teams', state: 'approved' }]);
    expect(file.campaigns.map((c) => c.name)).toEqual(['Umbrae Market Depth']);
    const text = companiesText([file]);
    expect(text).toContain('Umbrae [umbrae], part of ignis: site https://umbrae.io');
    expect(text).toContain('- Liquidity providers keep 95% of every swap fee');
    expect(text).not.toContain('Sessions run 60 minutes');
    expect(text).not.toContain('MISSING');
  });

  test('names what is missing and tells the seat to say nothing that rests on it', () => {
    const bare = companyFile({ id: 'deus-neuma', name: 'Deus Neuma', parentId: null, site: { url: null, links: [] }, repos: [] }, { facts: null, segments: [], campaigns: [] });
    expect(bare.missing).toHaveLength(2);
    expect(companiesText([bare])).toMatch(/Deus Neuma \[deus-neuma\]: site NOT SET[\s\S]*MISSING: its site address[\s\S]*Say nothing about Deus Neuma that rests on a missing item/);
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
    expect(railRow(positions.find((p) => p.office === 'cro'))).toEqual({ office: 'cro', plain: 'SALES', title: 'Mercator', holder: 'Sol', waiting: 1, off: 2, setupOpen: 0, setup: null });
    expect(pickPosition(positions, 'clo').office).toBe('clo');
    expect(pickPosition(positions, 'nope').office).toBe('cos');
    expect(pickPosition([], 'cro')).toBe(null);
    const sales = positions.find((p) => p.office === 'cro');
    expect(hubTabs(sales).map((t) => t.id)).toEqual(['campaigns', 'leads', 'deals', 'mailbox', '_switches', '_eyes']);
    expect(hubTabs(sales).find((t) => t.id === '_switches').label).toBe('SWITCHES · 0/2');
    expect(hubTabs(positions.find((p) => p.office === 'clo')).map((t) => t.id)).toEqual(['legal', '_eyes']);
    expect(pickTab(sales, 'mailbox')).toBe('mailbox');
    expect(pickTab(sales, 'legal')).toBe('campaigns');
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
