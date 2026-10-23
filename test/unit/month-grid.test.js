// month-grid.test.js — the proving test for the F4 extraction (2026-08-31):
// the generic month grid is domain-free, and the queue calendar over it is
// byte-identical to what HERALD rendered before the split. Pure throughout —
// real inputs, real outputs, no mocks anywhere (RULE 0).
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dayKeyOf, shiftDayKey, buildMonthGrid } from '../../frontend/app/RelinkShell/month-grid.js';
import {
  buildMonthGrid as buildQueueGrid,
  shiftDayKey as queueShiftDayKey,
} from '../../frontend/app/RelinkShell/queue-calendar.js';
import { QueueCalendar } from '../../frontend/app/RelinkShell/QueueCalendar.jsx';

// A Wednesday at local noon — injected, so `today` is testable.
const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime();
const iso = (d) => d.toISOString();

// THE VESSEL SHAPE (Wave-3's consumer): entries with a plain date field and a
// kind, counted S sessions · D dailies-done · P planned. This is the generic
// contract proven on a second domain — the queue's letters appear nowhere.
const vesselEntry = (id, kind, date = null) => ({ id, kind, date: date ? iso(date) : null });
const VESSEL_SPEC = Object.freeze({
  empty: Object.freeze({ S: 0, D: 0, P: 0 }),
  count: (counts, entry) => {
    const lane = { session: 'S', daily: 'D', planned: 'P' }[entry.kind];
    if (lane) counts[lane] += 1;
  },
});
const vesselDayKeyOfEntry = (entry) => (entry?.date ? dayKeyOf(entry.date) : null);

describe('buildMonthGrid (generic) — a second domain over the same grid', () => {
  const cellFor = (weeks, date) => weeks.flat().find((c) => c.date === date);

  it('folds the domain\'s own count taxonomy — S/D/P for the vessel shape', () => {
    const entries = [
      vesselEntry('s1', 'session', new Date(2026, 6, 14, 7, 0, 0)),
      vesselEntry('s2', 'session', new Date(2026, 6, 14, 18, 0, 0)),
      vesselEntry('d1', 'daily', new Date(2026, 6, 14, 21, 0, 0)),
      vesselEntry('p1', 'planned', new Date(2026, 6, 20, 9, 0, 0)),
      vesselEntry('u1', 'daily'), // no date → nobody's day, like the queue's unscheduled
    ];
    const weeks = buildMonthGrid(2026, 6, entries, {
      now: NOW, dayKeyOfEntry: vesselDayKeyOfEntry, countSpec: VESSEL_SPEC,
    });
    expect(cellFor(weeks, 14).counts).toEqual({ S: 2, D: 1, P: 0 });
    expect(cellFor(weeks, 20).counts).toEqual({ S: 0, D: 0, P: 1 });
    expect(cellFor(weeks, 15).counts).toEqual({ S: 0, D: 0, P: 0 });
    // The dateless entry counts nowhere — every cell sums to the 4 dated ones.
    const total = weeks.flat().reduce((n, c) => n + c.counts.S + c.counts.D + c.counts.P, 0);
    expect(total).toBe(4);
  });

  it('empty cells share the spec\'s one frozen counts object', () => {
    const weeks = buildMonthGrid(2026, 6, [], {
      now: NOW, dayKeyOfEntry: vesselDayKeyOfEntry, countSpec: VESSEL_SPEC,
    });
    expect(Object.is(weeks[0][0].counts, VESSEL_SPEC.empty)).toBe(true);
    expect(Object.is(weeks[2][2].counts, VESSEL_SPEC.empty)).toBe(true); // a real but quiet day
    expect(Object.isFrozen(VESSEL_SPEC.empty)).toBe(true);
  });

  it('a counted day starts from a COPY of empty — the shared frozen one is never mutated', () => {
    const weeks = buildMonthGrid(2026, 6, [vesselEntry('s1', 'session', new Date(2026, 6, 14, 7, 0, 0))], {
      now: NOW, dayKeyOfEntry: vesselDayKeyOfEntry, countSpec: VESSEL_SPEC,
    });
    expect(cellFor(weeks, 14).counts).not.toBe(VESSEL_SPEC.empty);
    expect(VESSEL_SPEC.empty).toEqual({ S: 0, D: 0, P: 0 });
  });

  it('refuses to guess — missing dayKeyOfEntry or countSpec is a loud TypeError, never a silent grid', () => {
    expect(() => buildMonthGrid(2026, 6, [], { now: NOW })).toThrow(TypeError);
    expect(() => buildMonthGrid(2026, 6, [], { now: NOW, dayKeyOfEntry: vesselDayKeyOfEntry })).toThrow(TypeError);
    expect(() => buildMonthGrid(2026, 6, [], { now: NOW, countSpec: VESSEL_SPEC })).toThrow(TypeError);
  });
});

describe('queue adapter — BYTE PARITY with the pre-extraction grid', () => {
  // The expected 6×7 matrix for July 2026, constructed BY HAND here: literal
  // date rows (July 2026 opens on a Wednesday), keys derived from those
  // literals, today pinned to the 15th by NOW, counts written out per day.
  // The adapter's output must equal this matrix exactly — cell for cell.
  const ZERO = { Q: 0, A: 0, U: 0, W: 0, S: 0, F: 0, R: 0 };
  const DATE_ROWS = [
    [null, null, 1, 2, 3, 4, 5],
    [6, 7, 8, 9, 10, 11, 12],
    [13, 14, 15, 16, 17, 18, 19],
    [20, 21, 22, 23, 24, 25, 26],
    [27, 28, 29, 30, 31, null, null],
    [null, null, null, null, null, null, null],
  ];
  const COUNTS_BY_DATE = {
    14: { Q: 1, A: 1, U: 0, W: 0, S: 0, F: 0, R: 0 },
    15: { Q: 0, A: 0, U: 0, W: 0, S: 1, F: 0, R: 1 },
    20: { Q: 0, A: 2, U: 0, W: 0, S: 0, F: 0, R: 0 }, // the parent AND its self-reply child
    31: { Q: 0, A: 1, U: 0, W: 0, S: 0, F: 0, R: 0 }, // an unnamed standing rides with A
  };
  const EXPECTED = DATE_ROWS.map((row) => row.map((date) => (
    date === null
      ? { date: null, key: null, today: false, counts: ZERO }
      : {
        date,
        key: `2026-07-${String(date).padStart(2, '0')}`,
        today: date === 15,
        counts: COUNTS_BY_DATE[date] || ZERO,
      }
  )));

  it('the queue fixture reproduces the hand-built matrix exactly', () => {
    const parent = { id: 'p4', status: 'approved', scheduledFor: iso(new Date(2026, 6, 20, 14, 0, 0)) };
    const child = {
      id: 'c1', kind: 'self-reply', thread: { parentId: 'p4' }, status: 'approved', scheduledFor: null,
    };
    const entries = [
      { id: 'p1', status: 'draft', scheduledFor: iso(new Date(2026, 6, 14, 9, 0, 0)) },
      { id: 'p2', status: 'approved', scheduledFor: iso(new Date(2026, 6, 14, 18, 0, 0)) },
      { id: 'p3', status: 'sent', scheduledFor: iso(new Date(2026, 6, 15, 10, 0, 0)) },
      { id: 'r1', kind: 'reply', status: 'sent', scheduledFor: iso(new Date(2026, 6, 15, 11, 0, 0)) },
      parent,
      child,
      { id: 'u1', status: 'draft', scheduledFor: null }, // the unscheduled appear NOWHERE
      { id: 'x1', status: 'mystery', scheduledFor: iso(new Date(2026, 6, 31, 9, 0, 0)) },
      { id: 'o1', status: 'draft', scheduledFor: iso(new Date(2026, 7, 1, 9, 0, 0)) }, // August is not July
    ];
    expect(buildQueueGrid(2026, 6, entries, { now: NOW })).toEqual(EXPECTED);
  });

  it('the queue still exports the leaf\'s day walk — the barrel chain is unbroken', () => {
    expect(queueShiftDayKey).toBe(shiftDayKey);
  });
});

describe('grid law — padding, Mon-first, the day walk, today', () => {
  const grid = (y, m) => buildMonthGrid(y, m, [], {
    now: NOW, dayKeyOfEntry: vesselDayKeyOfEntry, countSpec: VESSEL_SPEC,
  });

  it('padding cells are blank seats — no date, no key, never today', () => {
    const weeks = grid(2026, 7); // August 2026 opens on a Saturday: five leading pads
    expect(weeks[0].slice(0, 5).every((c) =>
      c.date === null && c.key === null && c.today === false)).toBe(true);
  });

  it('a month opening on a Monday needs no leading padding — June 2026 starts in column 0', () => {
    expect(grid(2026, 5)[0].map((c) => c.date)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('the day walk crosses month and year boundaries in the local-day register', () => {
    expect(shiftDayKey('2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftDayKey('2024-02-28', 1)).toBe('2024-02-29'); // leap years hold
    // The local-midnight law: a full year of single steps lands exactly a year
    // later — no UTC round-trip drift, whatever DST boundaries the year holds.
    let key = '2026-01-01';
    for (let i = 0; i < 365; i += 1) key = shiftDayKey(key, 1);
    expect(key).toBe('2027-01-01');
  });

  it('today is exactly one cell, and only in today\'s own month', () => {
    expect(grid(2026, 6).flat().filter((c) => c.today).map((c) => c.key)).toEqual(['2026-07-15']);
    expect(grid(2026, 7).flat().some((c) => c.today)).toBe(false);
  });
});

describe('QueueCalendar render — the count lanes are a prop, the default is the queue\'s', () => {
  // Mirrored BY HAND from QueueCalendar.jsx's QUEUE_COUNT_LANES — the drift
  // sentinel: if the component's default lanes change, this render stops
  // matching and the test says HERALD changed.
  const QUEUE_LANES = Object.freeze([
    { key: 'Q', letter: 'Q', tone: 'await', label: (n) => `${n} awaiting approval` },
    { key: 'A', letter: 'A', tone: 'live', label: (n) => `${n} approved` },
    { key: 'U', letter: 'U', tone: 'done', label: (n) => `${n} unapproved` },
    { key: 'W', letter: 'W', tone: 'done', label: (n) => `${n} withdrawn` },
    { key: 'S', letter: 'S', tone: 'done', label: (n) => `${n} sent` },
    { key: 'F', letter: 'F', tone: 'fail', label: (n) => `${n} failed` },
    { key: 'R', letter: 'R', tone: 'reply', label: (n) => `${n} ${n === 1 ? 'reply' : 'replies'}` },
  ]);
  const entries = [
    { id: 'p1', status: 'draft', scheduledFor: iso(new Date(2026, 6, 14, 9, 0, 0)) },
    { id: 'p2', status: 'draft', scheduledFor: iso(new Date(2026, 6, 14, 18, 0, 0)) },
    { id: 'r1', kind: 'reply', status: 'sent', scheduledFor: iso(new Date(2026, 6, 14, 20, 0, 0)) },
  ];
  const props = {
    year: 2026, monthIndex: 6, entries, now: NOW, selectedKey: '2026-07-14',
    onPick: () => {}, onPrevMonth: () => {}, onNextMonth: () => {}, onToday: () => {},
  };
  const render = (over = {}) => renderToStaticMarkup(createElement(QueueCalendar, { ...props, ...over }));

  it('no prop renders BYTE-IDENTICALLY to the explicit queue lanes — HERALD passes nothing', () => {
    expect(render()).toBe(render({ countLanes: QUEUE_LANES }));
  });

  it('the default render draws each day by status — a stacked bar and its total — and speaks the counts', () => {
    const html = render();
    expect(html).toContain('qcal-stack');
    expect(html).toContain('qs-awaiting'); // two drafts on the 14th — a decision owed, drawn in signal
    expect(html).toContain('qs-reply');
    expect(html).toContain('class="qcal-total">3<'); // the 14th: two drafts and a reply
    expect(html).not.toContain('qcal-n '); // the letters left the cell…
    expect(html).toContain('2 awaiting approval, 1 reply'); // …the spoken counts did not
  });

  it('another domain\'s lanes drive the spoken counts', () => {
    const html = render({
      countLanes: Object.freeze([
        { key: 'Q', letter: 'Z', tone: 'done', label: (n) => `${n} zzz` },
      ]),
    });
    expect(html).toContain('2 zzz');
    expect(html).not.toContain('2 awaiting approval');
  });
});
