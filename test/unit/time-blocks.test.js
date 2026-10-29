// time-blocks — a task with a START time is a block on the calendar (start →
// its due time as the end): the store's law for it, the line a being reads,
// where the agenda places it, when it reads as late, and the calendar text a
// being receives. Real modules, real values; no mocks.
import { describe, it, expect } from 'vitest';
import { addAssigned, updateAssigned } from '../../core/tasks/assigned-plan.js';
import { dueLabel } from '../../core/tasks/deadline.js';
import { taskItems } from '../../backend/services/house-agenda/agenda-tasks.js';
import { agendaWindow } from '../../backend/services/house-agenda/agenda-time.js';
import { formatAgendaForBeing, laneOfWho } from '../../backend/services/house-agenda/agenda-for-being.js';
import { toneOf } from '../../frontend/app/RelinkShell/house-calendar/calendar-view.js';
import { timeLabel } from '../../frontend/app/RelinkShell/todo-view.js';

const NOW = '2026-10-17T05:00:00.000Z';
const add = (args) => addAssigned({ tasks: [] }, { title: 'Chest + core', ...args }, { id: 't1', now: NOW });

describe('the store', () => {
  it('a block needs its end, and ends after it starts; custom days may carry a time', () => {
    expect(add({ cadence: 'custom', days: [1, 3], startTime: '17:00', dueTime: '18:15' }).task).toMatchObject({ startTime: '17:00', dueTime: '18:15', days: [1, 3] });
    expect(() => add({ cadence: 'daily', startTime: '17:00' })).toThrow(/needs its end/);
    expect(() => add({ cadence: 'daily', startTime: '18:00', dueTime: '17:00' })).toThrow(/end after it starts/);
    expect(() => add({ cadence: 'monthly', startTime: '17:00', dueTime: '18:00' })).toThrow(/time of day only makes sense/);
    expect(add({ cadence: 'custom', days: [5], dueTime: '09:00' }).task.dueTime).toBe('09:00');
  });

  it('a block moves whole or by one side, a start can be cleared, and clearing the end clears the block', () => {
    const plan = add({ cadence: 'daily', startTime: '17:00', dueTime: '18:15' }).plan;
    expect(updateAssigned(plan, { id: 't1', startTime: '06:30', dueTime: '07:15' }, { now: NOW }).task).toMatchObject({ startTime: '06:30', dueTime: '07:15' });
    expect(updateAssigned(plan, { id: 't1', dueTime: '19:00' }, { now: NOW }).task).toMatchObject({ startTime: '17:00', dueTime: '19:00' });
    expect(() => updateAssigned(plan, { id: 't1', dueTime: '16:00' }, { now: NOW })).toThrow(/end after it starts/);
    expect(updateAssigned(plan, { id: 't1', startTime: null }, { now: NOW }).task.startTime).toBeUndefined();
    const cleared = updateAssigned(plan, { id: 't1', dueTime: null }, { now: NOW }).task;
    expect([cleared.dueTime, cleared.startTime]).toEqual([undefined, undefined]);
  });
});

describe('where a block reads', () => {
  it('a being reads it as a BLOCK, open to close', () => {
    expect(dueLabel({ dueDate: '2026-10-20', startTime: '17:00', dueTime: '18:15' }, new Date('2026-10-17T10:00:00'))).toBe(' — BLOCK 2026-10-20 17:00–18:15');
    expect(dueLabel({ dueDate: '2026-10-20', dueTime: '18:15' }, new Date('2026-10-17T10:00:00'))).toBe(' — DUE 2026-10-20 18:15');
  });

  it('a TASKS row carries its span, or its deadline time', () => {
    expect(timeLabel({ startTime: '17:00', dueTime: '18:15' })).toBe('17:00–18:15');
    expect(timeLabel({ dueTime: '21:00' })).toBe('BY 21:00');
    expect(timeLabel({})).toBe('');
  });

  it('the agenda spans it start to end, and it reads late only once it has ended', () => {
    const win = agendaWindow('2026-10-19', '2026-10-25');
    const [item] = taskItems([{ id: 'mine:t1', title: 'Chest + core', laneId: 'me', list: 'OPERATOR', status: 'open', cadence: 'custom', days: [1], startTime: '17:00', dueTime: '18:15' }], win, '2026-10-19');
    expect(item).toMatchObject({ day: '2026-10-19', time: '17:00', endTime: '18:15' });
    expect(toneOf({ ...item, source: 'task' }, { day: '2026-10-19', time: '17:30' })).toBe('set');
    expect(toneOf({ ...item, source: 'task' }, { day: '2026-10-19', time: '18:30' })).toBe('overdue');
  });
});

describe('the calendar a being receives', () => {
  const agenda = {
    from: '2026-10-19', to: '2026-10-20', gaps: [], standing: [],
    lanes: [{ id: 'me' }, { id: 'optio-lane' }, { id: 'house' }, { id: 'machine' }],
    items: [
      { id: 'task:mine:abcdef1234:2026-10-19', source: 'task', lane: 'me', title: 'Chest + core', day: '2026-10-19', time: '17:00', endTime: '18:15', status: 'open' },
      { id: 'wake:1', source: 'wake', lane: 'optio-lane', title: 'House wake (cadence)', day: '2026-10-20', time: '12:00', projected: true, held: 'quiet hours' },
    ],
  };
  const names = new Map([['optio-lane', 'Optio']]);
  it('days in order; the block with the id the update takes; expected runs marked', () => {
    const text = formatAgendaForBeing(agenda, names);
    expect(text).toContain('HOUSE CALENDAR 2026-10-19 → 2026-10-20 (local time) · everyone');
    expect(text).toContain('MON 2026-10-19');
    expect(text).toMatch(/17:00–18:15 +OPERATOR · TASK · Chest \+ core \[abcdef12\] \(open\)/);
    expect(text).toMatch(/12:00 +~ Optio · HOUSE WAKE · House wake \(cadence\) — waits: quiet hours/);
    expect(formatAgendaForBeing(agenda, names, { lane: 'optio-lane' })).not.toContain('Chest');
  });
  it('who names the operator, a member by name in any case, or no one', () => {
    expect(laneOfWho('operator', agenda.lanes, names)).toBe('me');
    expect(laneOfWho('optio', agenda.lanes, names)).toBe('optio-lane');
    expect(laneOfWho('', agenda.lanes, names)).toBeNull();
    expect(laneOfWho('stranger', agenda.lanes, names)).toBeUndefined();
  });
});
