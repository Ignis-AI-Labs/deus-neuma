// house-calendar-view — the house calendar's display law: who the people are
// and in what colour, the week and the month a day belongs to, how an item
// reads, and the month fold that dots each person's days. Real module; no mocks.
import { describe, test, expect } from 'vitest';
import {
  peopleOf, weekOf, monthSpan, cellsOf, focusItems, toggleFocus, inFocus, countsBy, kindOf, nowIndex, toneOf, stackRepeats, standingGroups, nextUp, weekRows, shortName, dayOf, monthCountSpec, peopleOn, canQuickAdd, spanOf, quickAddWakes,
} from '../../frontend/app/RelinkShell/house-calendar/calendar-view.js';
import { buildMonthGrid } from '../../frontend/app/RelinkShell/month-grid.js';

const lanes = [
  { id: 'me', kind: 'operator' }, { id: 'being-a', kind: 'neuma' }, { id: 'being-b', kind: 'neuma' },
  { id: 'witness-x-W', kind: 'witness', name: 'W' }, { id: 'house', kind: 'house' }, { id: 'machine', kind: 'machine' },
];

describe('the people', () => {
  test("a being in its own soul colour; one the roster cannot colour takes a seat colour; the house and machine stay quiet", () => {
    const people = peopleOf(lanes, [{ neumaId: 'being-a', name: 'Ashby', color: '#8fd3c1' }], 'JUNIPER');
    expect(people.map((p) => [p.id, p.name, p.color])).toEqual([
      ['me', 'JUNIPER', 'var(--color-text-primary)'],
      ['being-a', 'ASHBY', '#8fd3c1'],
      ['being-b', 'BEING-B', 'var(--voice-2)'],
      ['witness-x-W', 'W', 'var(--voice-3)'],
      ['house', 'HOUSE', 'var(--color-text-tertiary)'],
      ['machine', 'MACHINE', 'var(--color-text-tertiary)'],
    ]);
    expect(people.map(canQuickAdd)).toEqual([true, true, true, true, false, false]);
    expect(peopleOf(lanes, [])[0].name).toBe('OPERATOR');
  });

  test('quick-add says whether the task wakes anyone: only a charter seat, only at a time; the operator\'s own list never', () => {
    const people = peopleOf([{ id: 'me', kind: 'operator' }, { id: 'being-a', kind: 'neuma', wakes: true }, { id: 'being-b', kind: 'neuma' }], [{ neumaId: 'being-a', name: 'Ashby' }]);
    expect(people.map((p) => p.wakes === true)).toEqual([false, true, false]);
    const [me, seat, other] = people;
    expect(quickAddWakes(me, { start: '', time: '09:00' })).toBe('ON YOUR OWN LIST — IT WAKES NO ONE');
    expect(quickAddWakes(seat, { start: '14:00', time: '15:00' })).toBe('AT 14:00 THIS WAKES ASHBY — A CHARTER SEAT; THE CHARTER\'S PAUSE, QUIET HOURS AND DAILY LIMIT STILL HOLD IT');
    expect(quickAddWakes(seat, { start: '', time: '15:00' })).toMatch(/^AT 15:00 THIS WAKES ASHBY/);
    expect(quickAddWakes(seat, { start: '', time: '' })).toBe('NO TIME — IT WAKES NO ONE; GIVE IT A TIME TO WAKE ASHBY');
    expect(quickAddWakes(other, { start: '', time: '15:00' })).toBe('BEING-B HOLDS NO CHARTER SEAT — IT WAKES NO ONE');
  });

  test('focus: none is everyone; a click focuses, more clicks add, a click on a focused one releases', () => {
    let focus = new Set();
    expect(inFocus(focus, 'being-a')).toBe(true);
    focus = toggleFocus(focus, 'being-a');
    expect([inFocus(focus, 'being-a'), inFocus(focus, 'me')]).toEqual([true, false]);
    focus = toggleFocus(focus, 'me');
    expect([...focus]).toEqual(['being-a', 'me']);
    focus = toggleFocus(focus, 'being-a');
    expect([...focus]).toEqual(['me']);
    expect(toggleFocus(focus, 'me').size).toBe(0);
  });
});

describe('the week and the month', () => {
  test('a week runs Monday to Sunday whatever day it is asked from', () => {
    expect(weekOf('2026-10-17')).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    expect(weekOf('2026-10-12')[0]).toBe('2026-10-12');
    expect(weekOf('2026-11-01')[0]).toBe('2026-10-26');
  });
  test("a month's span is the six weeks its grid shows", () => {
    expect(monthSpan(2026, 9)).toEqual({ from: '2026-09-28', to: '2026-11-08' });
  });
});

describe('items', () => {
  const now = { day: '2026-10-17', time: '13:00' };
  const items = [
    { id: '1', lane: 'me', day: '2026-10-17', time: '07:00', source: 'task', status: 'open' },
    { id: '2', lane: 'me', day: '2026-10-18', time: '07:00', source: 'task', status: 'open', projected: true },
    { id: '3', lane: 'being-a', day: '2026-10-17', source: 'task', status: 'done' },
    { id: '4', lane: 'house', day: '2026-10-17', time: '23:00', source: 'wake', projected: true, held: 'quiet hours' },
    { id: '5', lane: 'being-a', day: '2026-10-16', time: '09:00', source: 'post', status: 'approved' },
  ];
  test('how each reads: owed work past its time is overdue; a projected run is expected; a held wake waits', () => {
    expect(items.map((i) => toneOf(i, now))).toEqual(['overdue', 'projected', 'done', 'held', 'set']);
    expect(toneOf({ day: '2026-10-17', time: '18:00', source: 'task', status: 'open' }, now)).toBe('set');
  });
  test('cells group by person and day; hiding a person hides their items', () => {
    const cells = cellsOf(items);
    expect(cells.get('me|2026-10-17').map((i) => i.id)).toEqual(['1']);
    expect(cells.get('being-a|2026-10-17').map((i) => i.id)).toEqual(['3']);
    expect(focusItems(items, new Set(['being-a'])).map((i) => i.id)).toEqual(['3', '5']);
    expect(focusItems(items, new Set()).map((i) => i.id)).toEqual(['1', '2', '3', '4', '5']);
    expect([...countsBy(items)]).toEqual([['me', 2], ['being-a', 2], ['house', 1]]);
    expect(items.map(kindOf)).toEqual(['TASK', 'TASK', 'TASK', 'HOUSE WAKE', 'POST']);
    expect(dayOf(items, '2026-10-17').map((i) => i.id)).toEqual(['1', '3', '4']);
  });
  test('the month fold dots each person once per day, and no day shares its counts with another', () => {
    const weeks = buildMonthGrid(2026, 9, items, { dayKeyOfEntry: (i) => i.day, countSpec: monthCountSpec });
    const cell = (key) => weeks.flat().find((c) => c.key === key);
    expect(cell('2026-10-17').counts).toEqual({ total: 3, '@me': 1, '@being-a': 1, '@house': 1 });
    expect(cell('2026-10-16').counts).toEqual({ total: 1, '@being-a': 1 });
    expect(cell('2026-10-01').counts).toEqual({ total: 0 });
    const people = peopleOf(lanes, []);
    expect(peopleOn(cell('2026-10-17').counts, people).map((p) => p.id)).toEqual(['me', 'being-a', 'house']);
  });
  test("the now line falls before the first timed item still ahead", () => {
    const today = [{ time: undefined }, { time: '07:00' }, { time: '12:30' }, { time: '18:00' }];
    expect(nowIndex(today, { time: '13:00' })).toBe(3);
    expect(nowIndex(today, { time: '19:00' })).toBe(4);
    expect(nowIndex([{ time: '09:00' }], { time: '08:00' })).toBe(0);
  });
  test("an item's span reads as it should", () => {
    expect(spanOf({ time: '07:00' })).toBe('07:00');
    expect(spanOf({ time: '23:00', endTime: '06:00' })).toBe('23:00–06:00');
    expect(spanOf({ day: '2026-10-17', time: '22:00', endDay: '2026-10-18', endTime: '07:00' })).toMatch(/^22:00 → .*18.* 07:00$/);
    expect(spanOf({})).toBe('');
  });
  test('repeats fold into one, carrying every time; a sent post is past, a done task is struck', () => {
    const stacked = stackRepeats([
      { id: 'a', source: 'meditation', title: 'Meditation', time: '05:54', projected: true },
      { id: 'b', source: 'meditation', title: 'Meditation', time: '11:54', projected: true },
      { id: 'c', source: 'task', title: 'Stretch', time: '07:00' },
    ]);
    expect(stacked.map((i) => [i.id, i.times])).toEqual([['a', ['05:54', '11:54']], ['c', ['07:00']]]);
    expect(toneOf({ source: 'post', status: 'sent', day: '2026-10-16' }, now)).toBe('past');
    expect(toneOf({ source: 'task', status: 'done', day: '2026-10-16' }, now)).toBe('done');
  });
});

describe('the rail and the rows', () => {
  const people = peopleOf(lanes, [], 'JUNIPER MATTHEW');
  test('people group by standing; a long name rides the row by its first word', () => {
    expect(standingGroups(people).map((g) => [g.label, g.people.map((p) => p.id)])).toEqual([
      ['OPERATOR', ['me']], ['HOUSE', ['being-a', 'being-b']], ['WITNESSES', ['witness-x-W']], ['SYSTEMS', ['house', 'machine']],
    ]);
    expect(shortName('JUNIPER MATTHEW')).toBe('JUNIPER');
  });
  test("a person's next item is the first still to come and not settled", () => {
    const now = { day: '2026-10-17', time: '13:00' };
    const items = [
      { id: '1', lane: 'me', day: '2026-10-17', time: '07:00', status: 'open' },
      { id: '2', lane: 'me', day: '2026-10-17', time: '15:00', status: 'done' },
      { id: '3', lane: 'me', day: '2026-10-18', time: '07:00', status: 'open' },
    ];
    expect(nextUp(items, 'me', now).id).toBe('3');
    expect(nextUp(items, 'being-a', now)).toBeNull();
  });
  test('the week rows are the people with something in it, or focused; the rest are quiet', () => {
    const cells = new Map([['being-a|2026-10-17', [{ id: 'x' }]]]);
    const days = ['2026-10-17'];
    expect(weekRows(people, cells, days, new Set()).busy.map((p) => p.id)).toEqual(['being-a']);
    expect(weekRows(people, cells, days, new Set()).quiet).toHaveLength(5);
    expect(weekRows(people, cells, days, new Set(['machine'])).busy.map((p) => p.id)).toEqual(['machine']);
  });
});
