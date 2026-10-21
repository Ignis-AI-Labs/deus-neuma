import { describe, it, expect } from 'vitest';
import {
  buildMonthGrid, filterQueueToDay, queueDayKey, shiftDayKey,
  replyDispositionLabel, replyNeedsAttention, replyWhenLabel,
} from '../../frontend/app/RelinkShell/campaigns-helpers.js';

// Every standing the post queue can hold, mirrored BY HAND from post-queue.js —
// it writes them as inline strings, so there is nothing to import. The mirror
// is asserted as a whole below rather than status by status: the property that
// matters is that the lanes cover the set, not that any one of them is placed.
// An unknown status is tested too, which is what actually catches drift.
const ALL_STANDINGS = ['draft', 'approved', 'sending', 'sent', 'failed', 'rejected', 'withdrawn'];

// THE MONTH GRID (ruling, 2026-07-28): […] Pure truth tables — `now` is injected, so the calendar
// is testable without a clock. The properties that matter: the grid is always
// 6×7 Mon-first, today is exactly one cell, a reply counts ONLY as a reply,
// the unscheduled appear nowhere in it, and every scheduled entry counts
// EXACTLY once — a post lost between cells is worse than the pile was.
describe('queueDayKey / filterQueueToDay — which day an entry belongs to', () => {
  // Local construction → ISO, so the day is the LOCAL day in every timezone
  // the suite runs in (dayKeyOf reads local components).
  const iso = (d) => d.toISOString();
  const e = (id, status, date = null, kind = undefined) => ({
    id, status, kind, scheduledFor: date ? iso(date) : null,
  });

  it('a scheduled entry belongs to its slot\'s local day', () => {
    expect(queueDayKey(e('x', 'draft', new Date(2026, 6, 15, 10, 0, 0)))).toBe('2026-07-15');
  });

  it('an unscheduled entry belongs to no day — and a slot that cannot parse is no slot', () => {
    expect(queueDayKey(e('x', 'draft'))).toBeNull();
    expect(queueDayKey({ id: 'y', status: 'draft' })).toBeNull();
    expect(queueDayKey({ id: 'z', status: 'draft', scheduledFor: 'not-a-date' })).toBeNull();
  });

  it('midnight is a hard boundary — 23:59 and 00:01 are different days', () => {
    expect(queueDayKey(e('late', 'draft', new Date(2026, 6, 15, 23, 59, 0)))).toBe('2026-07-15');
    expect(queueDayKey(e('early', 'draft', new Date(2026, 6, 16, 0, 1, 0)))).toBe('2026-07-16');
  });

  it('filterQueueToDay is exact — a day holds its own entries and no other day\'s', () => {
    const entries = [
      e('a1', 'draft', new Date(2026, 6, 15, 9, 0, 0)),
      e('a2', 'sent', new Date(2026, 6, 15, 21, 0, 0)),
      e('b1', 'draft', new Date(2026, 6, 16, 9, 0, 0)),
      e('u1', 'draft'),
    ];
    expect(filterQueueToDay(entries, '2026-07-15').map((x) => x.id)).toEqual(['a1', 'a2']);
    expect(filterQueueToDay(entries, '2026-07-16').map((x) => x.id)).toEqual(['b1']);
    expect(filterQueueToDay(entries, '2026-07-17')).toEqual([]);
    // The bucket: dayKey null selects exactly the unscheduled.
    expect(filterQueueToDay(entries, null).map((x) => x.id)).toEqual(['u1']);
    // No entry lands in two days — the filter partitions the queue.
    const landed = ['2026-07-15', '2026-07-16', '2026-07-17', null]
      .flatMap((k) => filterQueueToDay(entries, k).map((x) => x.id));
    expect(landed.sort()).toEqual(['a1', 'a2', 'b1', 'u1']);
  });

  it('survives junk — an empty queue filters to an empty day', () => {
    expect(filterQueueToDay(null, '2026-07-15')).toEqual([]);
    expect(filterQueueToDay([], null)).toEqual([]);
  });
});

describe('shiftDayKey — walking the days', () => {
  it('steps within a month', () => {
    expect(shiftDayKey('2026-07-15', 1)).toBe('2026-07-16');
    expect(shiftDayKey('2026-07-15', -1)).toBe('2026-07-14');
  });

  it('crosses months and years without drifting', () => {
    expect(shiftDayKey('2026-07-31', 1)).toBe('2026-08-01');
    expect(shiftDayKey('2026-08-01', -1)).toBe('2026-07-31');
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('knows February\'s length — leap and not', () => {
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDayKey('2024-03-01', -1)).toBe('2024-02-29');
  });
});

describe('buildMonthGrid — the 6×7 Mon-first month', () => {
  const iso = (d) => d.toISOString();
  const e = (id, status, date = null, kind = undefined) => ({
    id, status, kind, scheduledFor: date ? iso(date) : null,
  });
  const datesOf = (weeks) => weeks.map((row) => row.map((c) => c.date));
  const cellFor = (weeks, date) => weeks.flat().find((c) => c.date === date);
  // A Wednesday at local noon — injected, so `today` is testable.
  const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime();

  it('is always six rows of seven, whatever the month', () => {
    for (const [y, m] of [[2026, 6], [2026, 7], [2026, 1], [2027, 0]]) {
      const weeks = buildMonthGrid(y, m, [], { now: NOW });
      expect(weeks).toHaveLength(6);
      for (const row of weeks) expect(row).toHaveLength(7);
    }
  });

  it('a month starting mid-week pads its first week — July 2026 opens on a Wednesday', () => {
    const weeks = buildMonthGrid(2026, 6, [], { now: NOW });
    expect(datesOf(weeks)[0]).toEqual([null, null, 1, 2, 3, 4, 5]);
    // 31 days from a Wednesday start ends inside week five — the sixth is all padding.
    expect(datesOf(weeks)[4]).toEqual([27, 28, 29, 30, 31, null, null]);
    expect(datesOf(weeks)[5]).toEqual([null, null, null, null, null, null, null]);
  });

  it('a month needing all six weeks uses them — August 2026 opens on a Saturday', () => {
    const weeks = buildMonthGrid(2026, 7, [], { now: NOW });
    expect(datesOf(weeks)[0]).toEqual([null, null, null, null, null, 1, 2]);
    expect(datesOf(weeks)[5]).toEqual([31, null, null, null, null, null, null]);
  });

  it('a short month stays 6×7 rather than shrinking — February 2026 fits in five', () => {
    const weeks = buildMonthGrid(2026, 1, [], { now: NOW });
    expect(datesOf(weeks)[0]).toEqual([null, null, null, null, null, null, 1]);
    expect(datesOf(weeks)[4]).toEqual([23, 24, 25, 26, 27, 28, null]);
    expect(datesOf(weeks)[5]).toEqual([null, null, null, null, null, null, null]);
  });

  it('padding cells are blank seats — no date, no key, never today, zero counts', () => {
    const pad = buildMonthGrid(2026, 6, [], { now: NOW })[0][0];
    expect(pad).toEqual({
      date: null, key: null, today: false,
      counts: { Q: 0, A: 0, U: 0, W: 0, S: 0, F: 0, R: 0 },
    });
  });

  it('a real day carries its sortable key', () => {
    const weeks = buildMonthGrid(2026, 6, [], { now: NOW });
    expect(cellFor(weeks, 1).key).toBe('2026-07-01');
    expect(cellFor(weeks, 31).key).toBe('2026-07-31');
  });

  it('marks exactly one cell today — and only in today\'s own month', () => {
    const july = buildMonthGrid(2026, 6, [], { now: NOW });
    expect(july.flat().filter((c) => c.today).map((c) => c.date)).toEqual([15]);
    const august = buildMonthGrid(2026, 7, [], { now: NOW });
    expect(august.flat().some((c) => c.today)).toBe(false);
  });

  it('counts each day in LETTERS — Q awaiting, A approved, and the settled named (Founder: each number tied to its standing)', () => {
    const entries = [
      e('d1', 'draft', new Date(2026, 6, 14, 9, 0, 0)),
      e('d2', 'draft', new Date(2026, 6, 14, 18, 0, 0)),
      e('a1', 'approved', new Date(2026, 6, 14, 20, 0, 0)),
      e('s1', 'sending', new Date(2026, 6, 14, 20, 30, 0)),
      e('ok', 'sent', new Date(2026, 6, 15, 10, 0, 0)),
      e('bad', 'failed', new Date(2026, 6, 15, 10, 5, 0)),
      e('no', 'rejected', new Date(2026, 6, 15, 11, 0, 0)),
      e('wd', 'withdrawn', new Date(2026, 6, 15, 12, 0, 0)),
    ];
    const weeks = buildMonthGrid(2026, 6, entries, { now: NOW });
    expect(cellFor(weeks, 14).counts).toEqual({ Q: 2, A: 2, U: 0, W: 0, S: 0, F: 0, R: 0 });
    expect(cellFor(weeks, 15).counts).toEqual({ Q: 0, A: 0, U: 1, W: 1, S: 1, F: 1, R: 0 });
    expect(cellFor(weeks, 16).counts).toEqual({ Q: 0, A: 0, U: 0, W: 0, S: 0, F: 0, R: 0 });
  });

  it('a reply counts ONLY as a reply, whatever its standing', () => {
    const entries = [
      e('r1', 'draft', new Date(2026, 6, 15, 9, 0, 0), 'reply'),
      e('r2', 'sent', new Date(2026, 6, 15, 10, 0, 0), 'reply'),
      e('r3', 'approved', new Date(2026, 6, 15, 11, 0, 0), 'reply'),
    ];
    const weeks = buildMonthGrid(2026, 6, entries, { now: NOW });
    expect(cellFor(weeks, 15).counts).toEqual({ Q: 0, A: 0, U: 0, W: 0, S: 0, F: 0, R: 3 });
  });

  it('an unrecognised standing is counted, not dropped — it rides with the approved', () => {
    const weeks = buildMonthGrid(2026, 6, [e('x', 'quarantined', new Date(2026, 6, 16, 9, 0, 0))], { now: NOW });
    expect(cellFor(weeks, 16).counts).toEqual({ Q: 0, A: 1, U: 0, W: 0, S: 0, F: 0, R: 0 });
  });

  it('the unscheduled appear NOWHERE in the grid — the bucket is beside it, not in it', () => {
    const entries = [
      e('u1', 'draft'), e('u2', 'sent'),
      e('s1', 'draft', new Date(2026, 6, 15, 9, 0, 0)),
    ];
    const weeks = buildMonthGrid(2026, 6, entries, { now: NOW });
    const total = weeks.flat().reduce((n, c) =>
      n + c.counts.Q + c.counts.A + c.counts.U + c.counts.W + c.counts.S + c.counts.F + c.counts.R, 0);
    expect(total).toBe(1); // only the scheduled entry, exactly once
    expect(cellFor(weeks, 15).counts.Q).toBe(1);
  });

  it('never double-counts — the month\'s cells sum to its scheduled entries, no more', () => {
    const entries = [
      ...ALL_STANDINGS.map((s, i) => e(`p-${s}`, s, new Date(2026, 6, 10 + i, 9, 0, 0))),
      ...ALL_STANDINGS.map((s, i) => e(`r-${s}`, s, new Date(2026, 6, 10 + i, 10, 0, 0), 'reply')),
      e('u', 'draft'),
      e('other-month', 'draft', new Date(2026, 7, 1, 9, 0, 0)),
    ];
    const weeks = buildMonthGrid(2026, 6, entries, { now: NOW });
    const total = weeks.flat().reduce((n, c) =>
      n + c.counts.Q + c.counts.A + c.counts.U + c.counts.W + c.counts.S + c.counts.F + c.counts.R, 0);
    // 14 scheduled in July (7 posts + 7 replies); the unscheduled and the
    // August entry belong to no cell in this month.
    expect(total).toBe(14);
    expect(weeks.flat().reduce((n, c) => n + c.counts.R, 0)).toBe(7);
  });

  it('survives junk — no entries, no clock, still a grid', () => {
    const weeks = buildMonthGrid(2026, 6, null);
    expect(weeks).toHaveLength(6);
    expect(weeks.flat().every((c) =>
      c.counts.Q + c.counts.A + c.counts.U + c.counts.W + c.counts.S + c.counts.F + c.counts.R === 0)).toBe(true);
  });
});

describe('reply candidate labels (pure)', () => {
  it('the disposition speaks one honest board word', () => {
    expect(replyDispositionLabel('none')).toBe('UNANSWERED');
    expect(replyDispositionLabel('staged')).toBe('ANSWER STAGED');
    expect(replyDispositionLabel('approved')).toBe('ANSWER APPROVED');
    expect(replyDispositionLabel('sent')).toBe('ANSWERED');
    expect(replyDispositionLabel('dismissed')).toBe('SET ASIDE');
    expect(replyDispositionLabel(undefined)).toBe('UNANSWERED');
  });

  it('attention = not dismissed AND nothing done yet', () => {
    expect(replyNeedsAttention({ disposition: 'none' })).toBe(true);
    expect(replyNeedsAttention({ disposition: 'staged' })).toBe(false);
    expect(replyNeedsAttention({ disposition: 'none', dismissed: true })).toBe(false);
    expect(replyNeedsAttention(null)).toBe(false);
  });

  it('the meta line names when the knock came; no time, no line', () => {
    const now = Date.parse('2026-07-28T02:00:00Z');
    expect(replyWhenLabel({ postCreatedAt: '2026-07-28T01:00:00Z' }, now)).toMatch(/^REPLIED 1H AGO · /);
    expect(replyWhenLabel({ postCreatedAt: 'junk' }, now)).toBe('');
    expect(replyWhenLabel(null, now)).toBe('');
  });
});

// THE THREAD'S DAY (Kagipem 2026-07-29): a follow-up carries no slot of
// its own — its day IS the parent's day, because its whole schedule is the
// parent's event.
describe('queueDayKey — the thread join', () => {
  const parent = { id: 'p1', status: 'approved', scheduledFor: '2026-07-29T14:00:00Z' };
  const child = { id: 'c1', kind: 'self-reply', thread: { parentId: 'p1' }, status: 'approved', scheduledFor: null };
  const byId = new Map([['p1', parent], ['c1', child]]);

  it('the follow-up belongs to the parent\'s day, never to the unscheduled bucket', () => {
    expect(queueDayKey(child, byId)).toBe(queueDayKey(parent, byId));
    expect(queueDayKey(child)).toBeNull(); // without the join it is nobody's day
    const unscheduledParent = { ...parent, scheduledFor: null };
    expect(queueDayKey(child, new Map([['p1', unscheduledParent]]))).toBeNull();
  });

  it('a missing parent is no day — the orphan cascade owns it, not the calendar', () => {
    expect(queueDayKey(child, new Map())).toBeNull();
  });

  it('filterQueueToDay + buildMonthGrid count the child ON the parent\'s day, exactly once', () => {
    const entries = [parent, child];
    const day = queueDayKey(parent, byId);
    expect(filterQueueToDay(entries, day)).toHaveLength(2);
    expect(filterQueueToDay(entries, null)).toHaveLength(0);
    const d = new Date(`${day}T00:00:00`);
    const weeks = buildMonthGrid(d.getFullYear(), d.getMonth(), entries, { now: Date.parse('2026-07-29T09:00:00Z') });
    const cell = weeks.flat().find((c) => c.key === day);
    // Parent A (approved) + child A (approved) — two marks, one day.
    expect(cell.counts.A).toBe(2);
  });
});
