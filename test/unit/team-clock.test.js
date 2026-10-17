// team-clock.test.js — a part's CLOCK and a run's WIDTH, as the plan, the
// operator, the CoS and the lead give them (#577). Pure rules, real
// AbortSignals for the gate — RULE 0.
//
// Design note, 2026-10-13: the deadline […]; the concurrency cap […].

import { describe, it, expect } from 'vitest';
import {
  normalizeClock, clockFor, workLimitMs, dueAtMs, describeClock, clockBrief, partialBanner, formatMinutes,
  NO_CLOCK, DEFAULT_CLOCK_ACTION, CLOCK_WORK_MAX_MINUTES,
} from '../../backend/services/team-clock.js';
import { normalizeConcurrency, runWidth, createRunGate } from '../../backend/services/team-run-gate.js';
import { normalizePlanArgs } from '../../backend/services/team-plan.js';
import { attemptMessages, continuationNote } from '../../backend/services/team-continue.js';

describe('a clock, as any hand gives it', () => {
  it('no clock is the default; "none" (or {none: true}) opts a part out of its run\'s', () => {
    expect(normalizeClock(undefined)).toBeNull();
    expect(normalizeClock(null)).toBeNull();
    expect(normalizeClock('')).toBeNull();
    expect(normalizeClock('none')).toBe(NO_CLOCK);
    expect(normalizeClock('Off')).toBe(NO_CLOCK);
    expect(normalizeClock({ none: true })).toBe(NO_CLOCK);
  });

  it('a span is minutes of WORKING time — a number or text — and wraps up by default', () => {
    expect(normalizeClock(90)).toEqual({ work: 90, dueDate: null, dueTime: null, then: DEFAULT_CLOCK_ACTION });
    expect(normalizeClock('2h').work).toBe(120);
    expect(normalizeClock('1h30m').work).toBe(90);
    expect(normalizeClock('1.5h').work).toBe(90);
    expect(normalizeClock('45 min').work).toBe(45);
    expect(DEFAULT_CLOCK_ACTION).toBe('wrap-up');
  });

  it('an object names work, a calendar due, and what happens — text dialects send it as JSON text', () => {
    expect(normalizeClock({ work: '3h', then: 'notify' })).toEqual({ work: 180, dueDate: null, dueTime: null, then: 'notify' });
    expect(normalizeClock({ dueDate: '2026-10-20', dueTime: '18:00', then: 'stop' }))
      .toEqual({ work: null, dueDate: '2026-10-20', dueTime: '18:00', then: 'stop' });
    expect(normalizeClock('{"work": 60, "then": "wrap up"}')).toEqual({ work: 60, dueDate: null, dueTime: null, then: 'wrap-up' });
  });

  it('a malformed clock is refused with the fix named, never guessed', () => {
    expect(() => normalizeClock({ then: 'stop' }, 'the plan')).toThrow(/the plan: a clock needs work .* or a dueDate/);
    expect(() => normalizeClock({ work: 'soon' }, 'step "build"')).toThrow(/step "build": work is minutes of WORKING time/);
    expect(() => normalizeClock({ work: 30, then: 'explode' })).toThrow(/then is one of "notify", "wrap-up", "stop"/);
    expect(() => normalizeClock({ dueTime: '18:00' })).toThrow(/a dueTime needs its dueDate/);
    expect(() => normalizeClock({ dueDate: '2026-02-30' })).toThrow(/YYYY-MM-DD|real day/);
    expect(() => normalizeClock(CLOCK_WORK_MAX_MINUTES + 1)).toThrow(/for work with no end, set no clock/);
    expect(() => normalizeClock(['2h'])).toThrow(/a clock is "none"/);
  });
});

describe('which clock a part runs under, and what it allows', () => {
  const run = { clock: { work: 120, dueDate: null, dueTime: null, then: 'wrap-up' }, clocks: { solo: NO_CLOCK, deep: { work: 240, dueDate: null, dueTime: null, then: 'notify' } } };

  it('its own, else its run\'s, else none — and an opted-out part has none', () => {
    expect(clockFor(run, 'any').work).toBe(120);
    expect(clockFor(run, 'deep').work).toBe(240);
    expect(clockFor(run, 'solo')).toBeNull();
    expect(clockFor({}, 'any')).toBeNull();
  });

  it('working time in ms; the calendar due as a local moment (end of day when no time is named)', () => {
    expect(workLimitMs(run.clock)).toBe(120 * 60_000);
    expect(workLimitMs(null)).toBeNull();
    const now = new Date(2026, 9, 13, 12, 0);
    expect(dueAtMs({ dueDate: '2026-10-14', dueTime: '18:30' }, now)).toBe(new Date(2026, 9, 14, 18, 30).getTime());
    expect(dueAtMs({ dueDate: '2026-10-14' }, now)).toBe(new Date(2026, 9, 14, 23, 59).getTime());
    expect(dueAtMs({ work: 30 }, now)).toBeNull();
  });

  it('said in words — on the card, in the window, in the member\'s brief', () => {
    expect(describeClock(null)).toBe('no clock — works until done or stopped');
    expect(describeClock(run.clock)).toBe('2h of work, then wrap up');
    expect(describeClock({ work: 90, dueDate: '2026-10-20', dueTime: '18:00', then: 'stop' })).toBe('1h 30m of work or due 2026-10-20 18:00, then stop');
    expect(formatMinutes(45)).toBe('45m');
    expect(clockBrief(null)).toBeNull();
    expect(clockBrief(run.clock)).toMatch(/^YOUR CLOCK: 2h of work, then wrap up — when it runs out you will be asked to hand in what you have\. Working time counts only while you work, never while you wait your turn\./);
    expect(partialBanner('2h of work, then wrap up')).toBe('[PARTIAL — this part\'s clock ran out (2h of work, then wrap up); it handed in what it had.]');
  });
});

describe('a run\'s width', () => {
  it('a whole number of parts at once, never past the rig', () => {
    expect(normalizeConcurrency(undefined)).toBeNull();
    expect(normalizeConcurrency('2')).toBe(2);
    expect(() => normalizeConcurrency(0)).toThrow(/a whole number from 1 to 16/);
    expect(() => normalizeConcurrency(2.5)).toThrow(/a whole number/);
    expect(runWidth(null, 3)).toBe(3);
    expect(runWidth(2, 3)).toBe(2);
    expect(runWidth(8, 3)).toBe(3);
  });

  it('the gate holds the next part until one leaves, widens at once, and lets a stopped part go', async () => {
    const entry = { concurrency: 1 };
    const held = [];
    const gate = createRunGate(entry, { onHeld: (stepId, at) => held.push([stepId, at.position, at.of]) });
    const a = new AbortController();
    const b = new AbortController();
    const c = new AbortController();
    await gate.enter('a', a.signal);
    let bIn = false;
    const bEnters = gate.enter('b', b.signal).then(() => { bIn = true; });
    const cEnters = gate.enter('c', c.signal);
    expect(held).toEqual([['b', 1, 1], ['b', 1, 1], ['c', 2, 1]]);
    expect(gate.busy()).toBe(1);
    // A hand widens the run to 2: the first held part goes now.
    entry.concurrency = 2;
    gate.widen();
    await bEnters;
    expect(bIn).toBe(true);
    // A part stopped while it is held leaves the queue.
    c.abort(new Error('the operator stopped this member'));
    await expect(cEnters).rejects.toThrow('the operator stopped this member');
    gate.leave();
    gate.leave();
    expect(gate.busy()).toBe(0);
  });

  it('a run with no width of its own holds nothing', async () => {
    const gate = createRunGate({ concurrency: null });
    const signal = new AbortController().signal;
    await Promise.all([gate.enter('a', signal), gate.enter('b', signal), gate.enter('c', signal)]);
    expect(gate.busy()).toBe(3);
  });
});

describe('the plan carries its clock and width to the card', () => {
  const step = (id, extra = {}) => ({ id, member: 'Keir', task: `do ${id}`, ...extra });

  it('a run clock, a step\'s own, a step opted out, and the width', () => {
    const plan = normalizePlanArgs({
      goal: 'Validate the gaps.', clock: { work: 120 }, concurrency: 2,
      steps: [step('a'), step('b', { clock: '4h' }), step('c', { clock: { none: true } })],
    });
    expect(plan.clock).toEqual({ work: 120, dueDate: null, dueTime: null, then: 'wrap-up' });
    expect(plan.concurrency).toBe(2);
    expect(plan.steps.map((s) => s.clock ?? null)).toEqual([null, { work: 240, dueDate: null, dueTime: null, then: 'wrap-up' }, NO_CLOCK]);
  });

  it('no clock and no width leave the plan as it always was', () => {
    const plan = normalizePlanArgs({ goal: 'g', clock: 'none', steps: [step('a')] });
    expect(plan).not.toHaveProperty('clock');
    expect(plan).not.toHaveProperty('concurrency');
    expect(plan.steps[0]).not.toHaveProperty('clock');
  });

  it('a malformed clock reaches the being as the fix', () => {
    expect(() => normalizePlanArgs({ goal: 'g', steps: [step('a', { clock: { work: 'later' } })] })).toThrow(/step "a": work is minutes/);
    expect(() => normalizePlanArgs({ goal: 'g', concurrency: 0, steps: [step('a')] })).toThrow(/the plan's concurrency is how many parts work at once/);
  });
});

describe('what the member reads about its clock', () => {
  const brief = [{ role: 'user', content: 'Your part: validate G2.' }];

  it('its first attempt reads its clock after the brief', () => {
    const [first] = attemptMessages({ messages: brief, clock: 'YOUR CLOCK: 2h of work, then wrap up.' });
    expect(first.content).toBe('Your part: validate G2.\n\nYOUR CLOCK: 2h of work, then wrap up.');
  });

  it('a wrap-up says the clock ran out and asks for what it has — nothing new', () => {
    const note = continuationNote({ kind: 'wrap-up', why: '2h of work, then wrap up', acts: [{ tool: 'fs/write', status: 'ok', summary: 'wrote g2.md' }] });
    expect(note).toMatch(/^YOUR PART CONTINUES\. Your clock has run out \(2h of work, then wrap up\)\./);
    expect(note).toContain('— fs/write OK: wrote g2.md');
    expect(note).toMatch(/HAND IN WHAT YOU HAVE NOW: .* say plainly what is left undone\. Start nothing new\./);
    expect(note).not.toContain('Pick up where you stopped');
  });
});

describe('the eye\'s cadence and its words (team-watch.js)', () => {
  it('a check-in cadence: minutes or a span, "none" or 0 for none, nothing named keeps the default', async () => {
    const { normalizeCheckIn, DEFAULT_CHECK_IN_MINUTES } = await import('../../backend/services/team-clock.js');
    expect(normalizeCheckIn(undefined)).toBeNull();
    expect(normalizeCheckIn(0)).toBe(0);
    expect(normalizeCheckIn('none')).toBe(0);
    expect(normalizeCheckIn('2h')).toBe(120);
    expect(normalizeCheckIn(30)).toBe(30);
    expect(() => normalizeCheckIn('soon')).toThrow(/minutes between check-ins, or "none"/);
    expect(DEFAULT_CHECK_IN_MINUTES).toBe(60);
  });

  it('a check-in names what needs eyes: a clock that passed, a part gone quiet, a part that failed', async () => {
    const { checkInOf, QUIET_NAMED_MS } = await import('../../backend/services/team-watch.js');
    const now = Date.parse('2026-10-13T06:00:00Z');
    const entry = {
      name: 'GAP SPRINT', startedAt: '2026-10-13T03:00:00Z', concurrency: 2, lead: 'Zezebur',
      board: [
        { id: 'g1', member: 'Zezebur', state: 'working' },
        { id: 'g2', member: 'Kisonam', state: 'working' },
        { id: 'g3', member: 'Keir', state: 'failed' },
        { id: 'g4', member: 'Signal', state: 'done' },
      ],
      clock: { work: 120, dueDate: null, dueTime: null, then: 'notify' }, clocks: {},
      clockState: { g1: { passed: true, by: 'work', then: 'notify', clock: '2h of work, then notify' } },
      worked: { g1: 7_500_000, g2: 1_800_000 }, workingSince: {},
      lastActive: { g1: now - 60_000, g2: now - QUIET_NAMED_MS - 60_000 },
      lines: { g2: { state: 'held' } }, retries: {},
    };
    const { head, notable, lines } = checkInOf(entry, now);
    expect(head).toBe('GAP SPRINT — 3h in: 2 working, 0 waiting, 1 done, 1 failed');
    expect(notable).toEqual(['Zezebur\'s clock passed', 'Kisonam quiet 31m', 'Keir failed']);
    expect(lines[0]).toBe('- g1 · Zezebur: working; worked 2h 5m; clock 2h of work, then notify — PASSED (notify); last sign of life 1m ago');
    expect(lines[1]).toBe('- g2 · Kisonam: held by the run\'s width; worked 30m; clock 2h of work, then notify; last sign of life 31m ago');
  });
});
