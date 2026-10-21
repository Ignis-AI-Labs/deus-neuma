// house-clock-asks-view.test.js — the ASKS tab's display law, proven two ways
// (RULE 0, nothing faked): the pure helpers (asks-view.js) with real inputs
// and outputs, and the tab rendered for real (react-dom/server) over data
// shaped exactly like GET /api/v1/house-clock/asks: the Optio's packet on
// top in her order, blocked marked; the filters; each open ask with its
// answer controls by kind; answered asks under ANSWERED.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  askRow, filterAsks, packetView, askSeats, waitedWords, ASK_FILTER_START,
} from '../../frontend/app/RelinkShell/house-clock/asks-view.js';
import { HouseClockBody } from '../../frontend/app/RelinkShell/house-clock/HouseClockBody.jsx';

const NAMES = { 'lane-quae': 'Quae', 'lane-optio': 'Optio', 'lane-cosi': 'Cosi' };
const AT = '2026-10-16T10:00:00Z';
const act = { id: 'a-act', seat: 'lane-quae', kind: 'act', tool: 'intents/tasks.add', scope: 'Outline', why: 'the charter sends this act to the operator', status: 'open', at: AT, argsHash: 'h', args: {} };
const plan = { id: 'a-plan', seat: 'lane-quae', kind: 'plan', planId: 'plan-0123456789ab', why: 'the charter does not delegate team plans', status: 'open', at: AT };
const decision = { id: 'a-dec', seat: 'lane-cosi', kind: 'decision', question: 'Ratify the $250 price?', options: ['Ratify', 'Lower it'], why: 'a decision only you can make', status: 'open', at: AT, runId: 'run-1', stepId: 's2' };
const answered = { ...act, id: 'a-old', status: 'answered', answeredAt: AT, answer: { decision: 'allow', text: 'Once only.' } };
const dismissed = { ...act, id: 'a-gone', status: 'closed', closedAt: AT };
const ASKS = [decision, plan, act, answered, dismissed];
const PACKET = { v: 1, at: AT, by: 'lane-optio', byName: 'Optio', summary: 'The price first: nothing ships without it.\nThe plan can wait.', order: ['a-dec', 'a-plan', 'a-old'], blocked: ['a-dec'] };

describe('asks-view — the pure law', () => {
  it('the filter: standing, kind, seat, blocked only', () => {
    const blocked = new Set(PACKET.blocked);
    const ids = (f) => filterAsks(ASKS, { ...ASK_FILTER_START, ...f }, blocked).map((a) => a.id);
    expect(ids({})).toEqual(['a-dec', 'a-plan', 'a-act']);
    expect(ids({ view: 'answered' })).toEqual(['a-old']);
    expect(ids({ view: 'closed' })).toEqual(['a-gone']);
    expect(ids({ kind: 'plan' })).toEqual(['a-plan']);
    expect(ids({ seat: 'lane-cosi' })).toEqual(['a-dec']);
    expect(ids({ blockedOnly: true })).toEqual(['a-dec']);
    expect(askSeats(ASKS)).toEqual(['lane-cosi', 'lane-quae']);
  });

  it('a row: a decision\'s question and choices, a member\'s run and step, the answer it took', () => {
    expect(askRow(decision, NAMES, new Set(['a-dec']))).toMatchObject({
      name: 'Cosi', kind: 'DECISION', question: 'Ratify the $250 price?', options: ['Ratify', 'Lower it'],
      where: 'team run run-1 · step s2', blocked: true, controls: 'decision',
    });
    expect(askRow(act, NAMES).controls).toBe('act');
    expect(askRow({ ...act, argsHash: undefined }, NAMES).controls).toBe('act-legacy');
    expect(askRow(plan, NAMES).controls).toBe('plan');
    expect(askRow({ ...plan, planId: undefined }, NAMES).controls).toBe('plan-legacy');
    expect(askRow(answered, NAMES)).toMatchObject({ controls: null, answerText: 'Once only.', answered: expect.stringMatching(/^ALLOWED ONCE · /) });
    expect(askRow({ ...decision, status: 'answered', answer: { decision: 'reply', option: 'Ratify' } }, NAMES).answered).toMatch(/^REPLIED: Ratify · /);
  });

  it('an open ask says how long it has waited on you; an answered or dismissed one does not', () => {
    const after = (min) => Date.parse(AT) + min * 60_000;
    expect(waitedWords(AT, after(0.5))).toBe('WAITING UNDER A MINUTE');
    expect(waitedWords(AT, after(42))).toBe('WAITING 42 MIN');
    expect(waitedWords(AT, after(3 * 60 + 12))).toBe('WAITING 3 H 12 MIN');
    expect(waitedWords(AT, after(2 * 1440 + 5 * 60 + 30))).toBe('WAITING 2 D 5 H');
    // an unknown moment says nothing rather than guess
    expect(waitedWords(undefined, after(5))).toBeNull();
    expect(waitedWords(AT, undefined)).toBeNull();
    expect(askRow(act, NAMES, new Set(), after(90)).waited).toBe('WAITING 1 H 30 MIN');
    expect(askRow(answered, NAMES, new Set(), after(90)).waited).toBeNull();
    expect(askRow(dismissed, NAMES, new Set(), after(90)).waited).toBeNull();
  });

  it('the packet: her summary, her order, blocked marked, where each now stands', () => {
    const pv = packetView(PACKET, ASKS, NAMES);
    expect(pv).toMatchObject({ by: 'Optio', summary: PACKET.summary, waiting: 2, blocked: 1 });
    expect(packetView({ ...PACKET, byName: 'Fenna' }, ASKS, NAMES).by).toBe('Fenna'); // her own name, as she filed it
    expect(pv.items.map((i) => [i.n, i.name, i.what, i.blocked, i.standing])).toEqual([
      [1, 'Cosi', 'decision: Ratify the $250 price?', true, 'WAITS ON YOU'],
      [2, 'Quae', 'a team plan (plan-0123456789ab)', false, 'WAITS ON YOU'],
      [3, 'Quae', 'intents/tasks.add', false, 'ANSWERED'],
    ]);
    expect(packetView({ ...PACKET, order: ['zz'] }, ASKS, NAMES).items[0]).toMatchObject({ standing: 'GONE', name: 'an ask no longer on file' });
    // once answered, a blocked ask blocks nothing: the mark goes with the wait
    const after = packetView(PACKET, [{ ...decision, status: 'answered', answer: { decision: 'reply', option: 'Ratify' } }, plan], NAMES);
    expect(after.items[0]).toMatchObject({ blocked: false, standing: 'ANSWERED' });
    expect(after).toMatchObject({ waiting: 1, blocked: 0 });
    expect(askRow({ ...decision, status: 'answered', answer: { decision: 'reply', option: 'Ratify' } }, NAMES, new Set(['a-dec'])).blocked).toBe(false);
    expect(packetView(null, ASKS, NAMES)).toBeNull();
  });
});

describe('the ASKS tab, rendered', () => {
  const noop = () => {};
  const render = (props) => renderToStaticMarkup(createElement(HouseClockBody, {
    tab: 'asks', charter: null, history: [], names: NAMES, lanes: [], draft: null, busy: false, error: null,
    queue: null, ledger: null, asks: ASKS, packet: PACKET, askFilter: ASK_FILTER_START, notice: null,
    filter: { seat: '', outcome: '' }, seats: [], page: 0, pageSize: 20,
    money: null, addr: { address: '', label: '', member: '' }, moneyBusy: false,
    onTab: noop, onPause: noop, onOpenSitting: noop, onAskFilter: noop, onAnswerAsk: noop, onCloseAsk: noop,
    ...props,
  }));

  it('the packet sits on top, in her order, the blocked one marked; then the open asks with their answers', () => {
    const html = render({});
    expect(html).toContain('ASKS (3)');
    expect(html).toContain('REVIEW PACKET FROM Optio');
    expect(html).toContain('2 WAIT ON YOU, 1 BLOCKED');
    expect(html).toContain('The price first: nothing ships without it.');
    expect(html.indexOf('hclock-packet')).toBeLessThan(html.indexOf('data-ask="a-dec"'));
    expect(html).toMatch(/hclock-tag is-blocked[^>]*>BLOCKED</);
    for (const words of ['ALLOW ONCE', 'DENY', 'APPROVE', 'REVISE', 'REPLY', 'Ratify', 'Lower it', 'CLOSE']) expect(html).toContain(words);
    expect(html).toContain('Ratify the $250 price?');
    expect(html).toContain('From team run run-1 · step s2');
    expect(html).not.toContain('data-ask="a-old"'); // answered: under its own filter
    for (const label of ['Filter asks by standing', 'Filter asks by kind', 'Filter asks by seat', 'BLOCKED ONLY']) expect(html).toContain(label);
  });

  it('ANSWERED shows what was answered and the operator\'s words; no answer controls', () => {
    const html = render({ askFilter: { ...ASK_FILTER_START, view: 'answered' } });
    expect(html).toContain('data-ask="a-old"');
    expect(html).toContain('ALLOWED ONCE · ');
    expect(html).toContain('Once only.');
    expect(html).not.toContain('>ALLOW ONCE<');
  });

  it('each open ask shows how long it has waited, beside when it was filed', () => {
    const html = render({ now: Date.parse(AT) + (26 * 60 + 5) * 60_000 });
    expect(html.match(/WAITING 1 D 2 H/g)).toHaveLength(3);
    const answeredView = render({ now: Date.parse(AT) + 60 * 60_000, askFilter: { ...ASK_FILTER_START, view: 'answered' } });
    expect(answeredView).not.toContain('WAITING ');
  });

  it('no packet yet: says what one will be; an empty view says nothing waits', () => {
    const html = render({ packet: null, asks: [] });
    expect(html).toContain('No review packet yet.');
    expect(html).toContain('NOTHING WAITS ON YOU');
  });
});
