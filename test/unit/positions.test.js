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
    expect(sales.connections).toEqual([{ id: 'mail-watch', name: 'House mailbox watch', on: false, whileOff: 'new mail waits until a being or you check the mailbox' }]);
    expect(positions.find((p) => p.office === 'cmo').waiting.map((w) => w.id)).toEqual(['post:1']);
    expect(positions.find((p) => p.office === 'cos').waiting.map((w) => w.id)).toEqual(['charter:3']);
    expect(positions.find((p) => p.office === 'clo').holder).toBe(null);
  });

  test('the rail counts what it lists; the window opens on what waits', () => {
    const positions = board();
    expect(railSummary(positions)).toBe('2/7 HELD · 3 WAITING ON YOU');
    expect(railRow(positions.find((p) => p.office === 'cro'))).toEqual({ office: 'cro', plain: 'SALES', title: 'Mercator', holder: 'Sol', waiting: 1, off: 1 });
    expect(pickPosition(positions, 'clo').office).toBe('clo');
    expect(pickPosition(positions, 'nope').office).toBe('cos');
    expect(pickPosition([], 'cro')).toBe(null);
    const sales = positions.find((p) => p.office === 'cro');
    expect(hubTabs(sales).map((t) => t.id)).toEqual(['leads', 'deals', 'mailbox', '_switches', '_eyes']);
    expect(hubTabs(sales).find((t) => t.id === '_switches').label).toBe('SWITCHES · 0/1');
    expect(hubTabs(positions.find((p) => p.office === 'clo')).map((t) => t.id)).toEqual(['legal', '_eyes']);
    expect(pickTab(sales, 'mailbox')).toBe('mailbox');
    expect(pickTab(sales, 'legal')).toBe('leads');
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
