// house-clock-view.test.js — the HOUSE CLOCK window's display law, proven two
// ways (RULE 0, nothing faked): the pure helpers with real inputs and outputs,
// and the whole window rendered for real (react-dom/server) over data shaped
// exactly like the house-clock routes' own responses.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  charterStatus, pauseSwitch, reasonWords, heldWords, outcomeWords, runningRows, queueRows,
  ledgerRow, askRow, openAskCount, draftFromCharter, charterFromDraft, charterLines, ONE_AT_A_TIME, MONEY_OUT,
} from '../../frontend/app/RelinkShell/house-clock/house-clock-view.js';
import { HouseClockBody } from '../../frontend/app/RelinkShell/house-clock/HouseClockBody.jsx';
import { notificationTarget } from '../../frontend/app/RelinkShell/NotificationTray/notification-target.js';
import { KIND } from '../../core/runtime/notification-record.js';
import { normalizeCharter } from '../../backend/services/house-clock/charter-shape.js';
import { runGate } from '../../backend/services/house-clock/wake-gate.js';
import { toDisplayMessages } from '../../frontend/app/RelinkShell/workspace-sessions.js';
import { toHistoryMessages } from '../../frontend/app/RelinkShell/stream-reducer-messages.js';

const NAMES = { 'lane-quae': 'Quae', 'lane-optio': 'Cael' };
const BASE = {
  v: 1, goal: 'Find a real gap and build for it.', linesOfWork: ['research digests'],
  seats: [{ laneId: 'lane-quae', dailyCap: 2 }], quietHours: { start: '22:00', end: '07:00' }, cadence: { everyHours: 24 },
  delegation: { teamPlans: true, maxMembers: 3, maxSteps: 5 }, allow: ['intents/social.post'], escalate: [MONEY_OUT],
  paused: false, pausedAt: null, version: 1, updatedAt: '2026-10-16T10:00:00.000Z',
  approvedAt: null, approvedBy: null, approvedVersion: null,
};
const approved = { ...BASE, approvedAt: '2026-10-16T10:05:00.000Z', approvedVersion: 1 };

describe('house-clock-view — where the charter stands, in plain words', () => {
  it('none / pending approval / approved at version N / paused', () => {
    expect(charterStatus(null)).toMatchObject({ key: 'none', words: 'NO CHARTER' });
    expect(charterStatus(BASE)).toMatchObject({ key: 'pending', words: 'PENDING APPROVAL — VERSION 1' });
    expect(charterStatus(approved)).toMatchObject({ key: 'approved', words: 'APPROVED AT VERSION 1' });
    expect(charterStatus({ ...approved, paused: true })).toMatchObject({ key: 'paused', words: 'PAUSED — APPROVED AT VERSION 1' });
    // an edit after approval waits again, and says which version had been approved
    const edited = { ...approved, version: 2 };
    expect(charterStatus(edited).words).toBe('PENDING APPROVAL — VERSION 2');
    expect(charterStatus(edited).detail).toContain('Version 1 was approved before this edit.');
  });

  it('the switch: PAUSE when running, RESUME when paused, nothing to pause without a charter', () => {
    expect(pauseSwitch(null)).toMatchObject({ label: 'PAUSE', enabled: false });
    expect(pauseSwitch(approved)).toMatchObject({ label: 'PAUSE', enabled: true });
    expect(pauseSwitch({ ...approved, paused: true })).toMatchObject({ label: 'RESUME', enabled: true });
  });
});

describe('house-clock-view — why a wake waits, from the gate\'s own words', () => {
  // The real gate's reasons, not hand-copied strings: the words follow the law.
  const charter = normalizeCharter({ goal: 'g', seats: [{ laneId: 'lane-quae', dailyCap: 1 }], quietHours: { start: '00:00', end: '23:59' } });
  const record = { ...charter, version: 1, approvedAt: 'x', approvedVersion: 1, paused: false };
  const why = (r, count = 0) => runGate({ charter: r, seat: 'lane-quae', now: new Date(2026, 9, 16, 12, 0).getTime(), count }).why;

  it('paused, unapproved, quiet hours, daily limit, no longer a seat', () => {
    expect(heldWords(why({ ...record, paused: true }))).toEqual({ key: 'paused', words: 'PAUSED — the house is paused' });
    expect(heldWords(why({ ...record, approvedVersion: null })).key).toBe('unapproved');
    expect(heldWords(why(null)).key).toBe('unapproved');
    expect(heldWords(why(record))).toEqual({ key: 'quiet', words: 'QUIET HOURS — 00:00–23:59' });
    expect(heldWords(why({ ...record, quietHours: null }, 1))).toEqual({ key: 'cap', words: 'DAILY LIMIT REACHED — lane-quae has spent its 1 wakes for today' });
    expect(heldWords(why({ ...record, seats: [] })).key).toBe('seat');
    expect(heldWords('the house clock is not running').key).toBe('clock');
  });

  it('reasons and outcomes read as words', () => {
    expect(reasonWords('post')).toBe('a house post came in');
    expect(reasonWords('cadence')).toBe('the Optio\'s regular review');
    expect(reasonWords('some-new-reason')).toBe('some new reason');
    expect(outcomeWords('escalated')).toEqual({ words: 'SENT SOMETHING TO YOU', register: 'live' });
    expect(outcomeWords('failed').register).toBe('loud');
    expect(outcomeWords('lost').words).toMatch(/RESTART/);
  });

  it('the queue: what runs, what waits behind it (one at a time), and what is held and why', () => {
    const queue = {
      items: [
        { id: 'i1', seat: 'lane-quae', reason: 'post', ref: 'p1', queuedAt: '2026-10-16T10:00:00Z' },
        { id: 'i2', seat: 'lane-quae', reason: 'dispatch', ref: 'c1', queuedAt: '2026-10-16T10:01:00Z' },
        { id: 'i3', seat: 'lane-optio', reason: 'cadence', ref: 'every-24h-1', queuedAt: '2026-10-16T10:02:00Z' },
      ],
      running: { 'lane-quae': { wakeId: 'w1', startedAt: '2026-10-16T10:00:03Z', itemIds: ['i1'], sessionId: 's-live' } },
      today: { 'lane-quae': 1 },
      held: [{ seat: 'lane-optio', why: 'the charter is paused' }],
    };
    expect(runningRows(queue, NAMES)).toEqual([expect.objectContaining({ seat: 'lane-quae', name: 'Quae', reason: 'a house post came in', ref: 'p1', sessionId: 's-live', waitingForLine: false })]);
    // started, but its turn still waits for the model line: never shown as working
    const behind = { ...queue, running: { 'lane-quae': { ...queue.running['lane-quae'], waitingForLine: true } } };
    expect(runningRows(behind, NAMES)[0].waitingForLine).toBe(true);
    const rows = queueRows(queue, NAMES);
    expect(rows.map((r) => [r.key, r.wait.key])).toEqual([['i2', 'one-at-a-time'], ['i3', 'paused']]);
    expect(rows[0].wait.words).toBe(ONE_AT_A_TIME);
  });
});

describe('house-clock-view — the ledger and the asks', () => {
  it('a wake row: every reason it carried, its acts, how it ended, its sitting', () => {
    const row = ledgerRow({
      id: 'w1', seat: 'lane-quae', reason: 'post', ref: 'p1',
      items: [{ reason: 'post', ref: 'p1' }, { reason: 'dispatch', ref: 'c1' }],
      startedAt: '2026-10-16T10:00:00Z', endedAt: '2026-10-16T10:02:00Z', outcome: 'escalated', sessionId: 's1',
      acts: [{ tool: 'house/post', decision: 'approved-charter', status: 'done' }], escalations: [{ tool: 'web/web_search' }],
    }, NAMES);
    expect(row).toMatchObject({ name: 'Quae', sessionId: 's1', escalations: 1, outcome: { words: 'SENT SOMETHING TO YOU' } });
    expect(row.reasons).toEqual(['a house post came in [p1]', 'the Optio gave it a task [c1]']);
    expect(row.acts).toEqual(['house/post — approved charter']);
  });

  it('an ask: what, why, open or closed with the operator\'s note', () => {
    const open = { id: 'a1', seat: 'lane-quae', kind: 'act', tool: 'intents/wallet.send', why: 'money out is always the operator\'s to approve', status: 'open', at: '2026-10-16T10:00:00Z', sessionId: 's1' };
    const closed = { ...open, id: 'a2', status: 'closed', closedAt: '2026-10-16T11:00:00Z', closeNote: 'not now' };
    expect(askRow(open, NAMES)).toMatchObject({ what: 'intents/wallet.send', open: true, closed: null, sessionId: 's1' });
    expect(askRow(closed, NAMES).closed).toMatch(/^CLOSED .* — not now$/);
    expect(askRow({ ...open, kind: 'plan', planId: 'pl-1', tool: undefined }, NAMES).what).toBe('a team plan (pl-1)');
    expect(openAskCount([open, closed])).toBe(1);
  });
});

describe('house-clock-view — the charter form, both ways', () => {
  const lanes = [{ neumaId: 'lane-quae' }, { neumaId: 'lane-optio' }];

  it('the draft round-trips to exactly what the server stores, and the server accepts it', () => {
    const draft = draftFromCharter(approved, lanes);
    expect(draft.seats).toEqual({ 'lane-quae': { on: true, cap: '2' }, 'lane-optio': { on: false, cap: '3' } });
    expect(draft.escalate).toBe(''); // money out is a fixed rule, not a line to delete
    const fields = charterFromDraft(draft);
    const stored = normalizeCharter(fields, { ownedLanes: ['lane-quae', 'lane-optio'] });
    for (const key of ['goal', 'linesOfWork', 'seats', 'quietHours', 'cadence', 'delegation', 'allow', 'escalate']) {
      expect(stored[key]).toEqual(approved[key]);
    }
  });

  it('a blank draft for a house with no charter: every lane listed, off; optional parts off', () => {
    const fields = charterFromDraft({ ...draftFromCharter(null, lanes), goal: '  Keep the digest going.  ', seats: { 'lane-quae': { on: true, cap: '4' }, 'lane-optio': { on: false, cap: '3' } } });
    expect(fields).toEqual({
      goal: 'Keep the digest going.', linesOfWork: [], seats: [{ laneId: 'lane-quae', dailyCap: 4 }],
      quietHours: null, cadence: null, delegation: { teamPlans: false, maxMembers: 4, maxSteps: 8 }, allow: [], escalate: [],
    });
    expect(normalizeCharter(fields, { ownedLanes: ['lane-quae'] }).escalate).toEqual([MONEY_OUT]);
  });

  it('the charter reads back in plain sentences', () => {
    const lines = Object.fromEntries(charterLines(approved, NAMES).map((l) => [l.label, l.value]));
    expect(lines['MAY WAKE']).toBe('Quae — up to 2 a day');
    expect(lines['QUIET HOURS']).toBe('22:00 to 07:00, nothing wakes');
    expect(lines['THE OPTIO MAY APPROVE']).toBe('team plans of up to 3 members and 5 steps');
    expect(lines['ALWAYS COMES TO YOU']).toBe(MONEY_OUT);
  });
});

describe('the HOUSE CLOCK window, rendered', () => {
  const noop = () => {};
  const render = (props) => renderToStaticMarkup(createElement(HouseClockBody, {
    tab: 'charter', charter: null, history: [], names: NAMES, lanes: [], draft: null, busy: false, error: null,
    queue: null, ledger: null, asks: [], filter: { seat: '', outcome: '' }, seats: ['lane-quae'], page: 0, pageSize: 20,
    money: null, addr: { address: '', label: '', member: '' }, moneyBusy: false,
    onTab: noop, onPause: noop, onEdit: noop, onDraft: noop, onSeat: noop, onSave: noop, onCancel: noop, onApprove: noop,
    onOpenSitting: noop, onFilter: noop, onPage: noop, onCloseAsk: noop, onAddr: noop, onDeclare: noop, onRemove: noop, onScan: noop,
    ...props,
  }));

  it('the head always carries the standing and the switch; APPROVE names the version shown', () => {
    let html = render({});
    expect(html).toContain('NO CHARTER');
    expect(html).toContain('WRITE A CHARTER');
    html = render({ charter: BASE });
    expect(html).toContain('PENDING APPROVAL — VERSION 1');
    expect(html).toContain('APPROVE VERSION 1');
    html = render({ charter: { ...approved, paused: true }, tab: 'ledger' });
    expect(html).toContain('PAUSED — APPROVED AT VERSION 1');
    expect(html).toMatch(/hclock-switch[^>]*>RESUME</);
  });

  it('ASKS counts what is open in its tab; NOW shows the held reason', () => {
    const html = render({
      tab: 'now',
      asks: [{ id: 'a1', seat: 'lane-quae', kind: 'act', tool: 'web/web_search', why: 'w', status: 'open', at: '2026-10-16T10:00:00Z' }],
      queue: { items: [{ id: 'i1', seat: 'lane-quae', reason: 'post', ref: 'p1', queuedAt: '2026-10-16T10:00:00Z' }], running: {}, today: {}, held: [{ seat: 'lane-quae', why: 'quiet hours (22:00–07:00)' }] },
    });
    expect(html).toContain('ASKS (1)');
    expect(html).toContain('QUIET HOURS — 22:00–07:00');
  });

  it('NOW: a wake still waiting for the model line says so, and is not drawn live', () => {
    const item = { id: 'i1', seat: 'lane-quae', reason: 'post', ref: 'p1', queuedAt: '2026-10-16T10:00:00Z' };
    const run = { wakeId: 'w1', startedAt: '2026-10-16T10:00:03Z', itemIds: ['i1'] };
    const queueWith = (r) => ({ items: [item], running: { 'lane-quae': r }, today: {}, held: [] });
    let html = render({ tab: 'now', queue: queueWith({ ...run, waitingForLine: true }) });
    expect(html).toContain('waiting for the model line since');
    expect(html).not.toContain('is-live');
    html = render({ tab: 'now', queue: queueWith(run) });
    expect(html).not.toContain('waiting for the model line');
    expect(html).toContain('hclock-row is-live');
  });

  it('the form shows money out as a fixed rule', () => {
    const html = render({ draft: draftFromCharter(approved, [{ neumaId: 'lane-quae' }]) });
    expect(html).toContain(`Money out (${MONEY_OUT}) always comes to you`);
    expect(html).toContain('Saving makes a new version');
  });
});

describe('a wake\'s sitting, reopened: the opener stays the platform\'s line', () => {
  it('origin wake (and watch) survives the resume fold and maps to its own role, never the operator\'s', () => {
    const rows = [
      { role: 'user', content: '[A WAKE — the platform, not your operator] The house woke you…', origin: 'wake', turnId: 't1', timestamp: '2026-10-16T10:00:00Z' },
      { role: 'assistant', content: 'I read the house post.', turnId: 't1', timestamp: '2026-10-16T10:00:05Z' },
      { role: 'user', content: '[A WATCH YOU SET] the run ended', origin: 'watch', timestamp: '2026-10-16T10:01:00Z' },
      { role: 'user', content: 'Thanks.', origin: 'something-else', turnId: 't2', timestamp: '2026-10-16T10:02:00Z' },
    ];
    const display = toDisplayMessages(rows);
    expect(display.map((m) => m.origin ?? null)).toEqual(['wake', null, 'watch', null]);
    expect(toHistoryMessages(display, 0, 'h').map((m) => m.role)).toEqual(['wake', 'neuma', 'watch', 'user']);
  });
});

describe('the tray: a house wake\'s card opens the HOUSE CLOCK', () => {
  it('maps houseWake to the window, carrying which wake', () => {
    expect(notificationTarget({ kind: KIND.houseWake, ref: { sessionId: 's1', wakeId: 'w1' } }))
      .toEqual({ appId: 'houseclock', payload: { wakeId: 'w1', sessionId: 's1' } });
  });
});
