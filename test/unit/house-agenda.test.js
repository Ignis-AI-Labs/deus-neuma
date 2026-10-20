// house-agenda — the pure half of the house calendar: the window, where each
// kind of scheduled thing lands (which day, which row, projected or real),
// and the machine's standing lines. Real modules, real values; no mocks.
import { describe, test, expect } from 'vitest';
import { agendaWindow, stampOf, runsBetween, taskDays, everyLabel } from '../../backend/services/house-agenda/agenda-time.js';
import { taskItems, vesselItems } from '../../backend/services/house-agenda/agenda-tasks.js';
import { runItems, chargeItems, postItems } from '../../backend/services/house-agenda/agenda-work.js';
import { clockItems, watchItems, meditationItems } from '../../backend/services/house-agenda/agenda-house.js';
import { machineStanding, benchItems } from '../../backend/services/house-agenda/agenda-machine.js';

const at = (day, time = '00:00') => new Date(`${day}T${time}:00`).getTime(); // local
const win = agendaWindow('2026-10-19', '2026-10-25'); // Mon..Sun
const owned = new Set(['being-a', 'witness-x-W']);

describe('the window', () => {
  test('inclusive local days, bounded, validated', () => {
    expect(win.days).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(win.fromMs).toBe(at('2026-10-19'));
    expect(stampOf(win.toMs)).toEqual({ day: '2026-10-25', time: '23:59' });
    expect(agendaWindow('2026-10-25', '2026-10-19').error).toMatch(/before/);
    expect(agendaWindow('2026-01-01', '2026-06-01').error).toMatch(/at most/);
    expect(agendaWindow('soon', 'later').error).toMatch(/YYYY-MM-DD/);
  });
  test('a rhythm is listed inside the window only, and capped', () => {
    const hour = 3_600_000;
    expect(runsBetween({ firstMs: at('2026-10-18', '22:00'), everyMs: 24 * hour, fromMs: win.fromMs, toMs: win.toMs }).map((ms) => stampOf(ms).day))
      .toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(runsBetween({ firstMs: win.fromMs, everyMs: 60_000, fromMs: win.fromMs, toMs: win.toMs, max: 5 })).toHaveLength(5);
    expect(runsBetween({ firstMs: NaN, everyMs: hour, fromMs: 0, toMs: 1 })).toEqual([]);
    expect([60_000, 600_000, 6 * hour, 90 * 60_000].map(everyLabel)).toEqual(['every minute', 'every 10 min', 'every 6 h', 'every 1.5 h']);
  });
});

describe('tasks land where their rhythm puts them', () => {
  test('a daily every day, a custom rhythm on its weekdays, a one-shot on its date, a time-only today', () => {
    expect(taskDays({ cadence: 'daily' }, win.days, '2026-10-21')).toHaveLength(7);
    expect(taskDays({ cadence: 'custom', days: [1, 3, 5] }, win.days, '2026-10-21')).toEqual(['2026-10-19', '2026-10-21', '2026-10-23']);
    expect(taskDays({ dueDate: '2026-10-24' }, win.days, '2026-10-21')).toEqual(['2026-10-24']);
    expect(taskDays({ dueDate: '2026-11-30' }, win.days, '2026-10-21')).toEqual([]);
    expect(taskDays({ cadence: 'weekly', dueTime: '09:00' }, win.days, '2026-10-21')).toEqual(['2026-10-21']);
  });
  test("a daily done today shows done today; the days after are projected and open", () => {
    const items = taskItems([{ id: 'mine:t', title: 'stretch', laneId: 'me', list: 'OPERATOR', status: 'done', cadence: 'daily', dueTime: '07:00' }], win, '2026-10-21');
    const byDay = Object.fromEntries(items.map((i) => [i.day, i]));
    expect(byDay['2026-10-21']).toMatchObject({ lane: 'me', time: '07:00', status: 'done' });
    expect(byDay['2026-10-21'].projected).toBeUndefined();
    expect(byDay['2026-10-22']).toMatchObject({ status: 'open', projected: true });
    // a repeating task's past is not on record: nothing before today
    expect(byDay['2026-10-20']).toBeUndefined();
    expect(items).toHaveLength(5);
  });
  test('planned vessel work rides the operator row', () => {
    expect(vesselItems([{ kind: 'planned', title: 'long run', scheduledFor: '2026-10-25' }, { kind: 'pr', scheduledFor: '2026-10-25' }], win))
      .toEqual([{ id: 'vessel:2026-10-25:0', source: 'vessel', lane: 'me', title: 'long run', day: '2026-10-25' }]);
  });
});

describe('work lands on the row of the member doing it', () => {
  const nowMs = at('2026-10-21', '12:00');
  test('a team run spans start to end on its lead\'s row; a running run shows its clock\'s due time', () => {
    const done = runItems({ id: 'r1', name: 'launch', runAt: new Date(at('2026-10-20', '09:00')).toISOString(), finishedAt: new Date(at('2026-10-20', '11:30')).toISOString(), status: 'done', lead: { neumaId: 'being-a' } }, { win, owned, nowMs });
    expect(done).toEqual([{ id: 'run:r1', source: 'run', lane: 'being-a', title: 'launch', day: '2026-10-20', time: '09:00', status: 'done', endDay: '2026-10-20', endTime: '11:30' }]);
    const running = runItems({ id: 'r2', goal: 'ship it', runAt: new Date(at('2026-10-21', '08:00')).toISOString(), status: 'running', lead: { neumaId: 'someone-else' }, clock: { dueDate: '2026-10-23', dueTime: '17:00' } }, { win, owned, nowMs });
    expect(running.map((i) => [i.source, i.lane, i.day, i.time])).toEqual([['run', 'me', '2026-10-21', '08:00'], ['run-due', 'me', '2026-10-23', '17:00']]);
    expect(runItems({ id: 'r3', runAt: '2026-09-01T00:00:00Z', finishedAt: '2026-09-01T01:00:00Z', status: 'done' }, { win, owned, nowMs })).toEqual([]);
  });
  test('a charge with a due time sits on its member\'s row; a post on its author\'s, the operator\'s when it has none', () => {
    expect(chargeItems([{ id: 'c1', title: 'audit the deps', to: 'witness-x-W', status: 'working', dueAt: new Date(at('2026-10-22', '10:00')).toISOString() }, { id: 'c2', title: 'x', to: 'being-a', status: 'done', dueAt: null }], { win, owned }))
      .toEqual([{ id: 'charge:c1', source: 'charge', lane: 'witness-x-W', title: 'audit the deps', day: '2026-10-22', time: '10:00', status: 'working' }]);
    const posts = postItems([
      { id: 'p1', status: 'approved', channelId: 'x', text: 'hello\nworld', authorNeumaId: 'being-a', scheduledFor: new Date(at('2026-10-23', '18:00')).toISOString() },
      { id: 'p2', status: 'sent', channelId: 'telegram', text: 'done', scheduledFor: new Date(at('2026-10-19', '09:00')).toISOString(), sentAt: new Date(at('2026-10-19', '09:02')).toISOString() },
      { id: 'p3', status: 'rejected', text: 'no', scheduledFor: new Date(at('2026-10-20', '09:00')).toISOString() },
    ], { win, owned });
    expect(posts.map((p) => [p.id, p.lane, p.channel, p.title, p.time])).toEqual([['post:p1', 'being-a', 'x', 'hello world', '18:00'], ['post:p2', 'me', 'telegram', 'done', '09:02']]);
  });
});

describe('the house: clock, watches, meditation', () => {
  const nowMs = at('2026-10-21', '12:00');
  const charter = { version: 2, approvedVersion: 2, approvedAt: '2026-10-01T00:00:00Z', cadence: { everyHours: 12 }, quietHours: { start: '23:00', end: '06:00' } };
  test('an approved charter: quiet hours each day, cadence wakes on the Optio\'s row; unapproved or paused: nothing', () => {
    const items = clockItems(charter, 'being-a', { win, owned });
    expect(items.filter((i) => i.source === 'quiet')).toHaveLength(7);
    expect(items.filter((i) => i.source === 'quiet').every((q) => q.projected)).toBe(true);
    const wakes = items.filter((i) => i.source === 'wake');
    expect(wakes.length).toBeGreaterThanOrEqual(13);
    expect(wakes.every((w) => w.lane === 'being-a' && w.projected)).toBe(true);
    expect(clockItems({ ...charter, approvedVersion: 1 }, 'being-a', { win, owned })).toEqual([]);
    expect(clockItems({ ...charter, paused: true }, 'being-a', { win, owned })).toEqual([]);
  });
  test('a 24 h watch projects from its last run, never into the past; never run: from now', () => {
    const day = 86_400_000;
    const runs = watchItems({ source: 'security', title: 'Security watch', laneId: 'being-a', lastRunAt: new Date(at('2026-10-21', '03:00')).toISOString(), everyMs: day }, { win, owned, nowMs });
    expect(runs.map((r) => `${r.day} ${r.time}`)).toEqual(['2026-10-22 03:00', '2026-10-23 03:00', '2026-10-24 03:00', '2026-10-25 03:00']);
    expect(watchItems({ source: 'legal', title: 'Legal', laneId: 'nobody', lastRunAt: null, everyMs: day }, { win, owned, nowMs })[0]).toMatchObject({ day: '2026-10-21', time: '12:00', lane: 'house' });
  });
  test('meditation: past runs as they ended, coming runs only for an enabled lane, nothing when env-locked', () => {
    const settings = { envLocked: false, defaults: { cadenceHours: 24 }, beings: { 'being-a': { enabled: true, cadenceHours: 48 } } };
    const state = { lanes: { 'being-a': { lastRunAt: new Date(at('2026-10-20', '05:00')).toISOString(), runs: [{ at: new Date(at('2026-10-20', '05:00')).toISOString(), outcome: 'synthesis' }] }, 'witness-x-W': { runs: [{ at: new Date(at('2026-10-19', '05:00')).toISOString(), outcome: 'unclear' }] } } };
    const items = meditationItems(settings, state, { win, owned, nowMs });
    expect(items.map((i) => [i.lane, i.day, i.status ?? 'projected'])).toEqual([
      ['being-a', '2026-10-20', 'synthesis'], ['being-a', '2026-10-22', 'projected'], ['being-a', '2026-10-24', 'projected'],
      ['witness-x-W', '2026-10-19', 'unclear'],
    ]);
    expect(meditationItems({ ...settings, envLocked: true }, state, { win, owned, nowMs })).toEqual([]);
  });
});

describe('the machine row', () => {
  test('every loop reads as one standing line with its real interval; heartbeat and idle unload only when on', () => {
    const lines = machineStanding({ heartbeatMinutes: 0, standby: { enabled: false, idleMinutes: 15 } });
    expect(lines.find((l) => l.id === 'post-scheduler').every).toBe('every minute');
    expect(lines.find((l) => l.id === 'status-sweep').every).toBe('every 6 h');
    expect(lines.some((l) => l.id === 'heartbeat' || l.id === 'model-idle')).toBe(false);
    const on = machineStanding({ heartbeatMinutes: 30, standby: { enabled: true, idleMinutes: 15 } });
    expect(on.find((l) => l.id === 'heartbeat').every).toBe('every 30 min');
    expect(on.find((l) => l.id === 'model-idle').title).toBe('Model unloads after 15 min idle');
  });
  test('a benchmark night is an item when its window touches the agenda', () => {
    const night = { file: 'night-x-status.json', status: 'running', startedAt: new Date(at('2026-10-21', '22:00')).toISOString(), deadline: new Date(at('2026-10-22', '07:00')).toISOString() };
    expect(benchItems(night, win)).toEqual([{ id: 'bench:night-x-status.json', source: 'bench', lane: 'machine', title: 'Benchmark night', day: '2026-10-21', time: '22:00', status: 'running', endDay: '2026-10-22', endTime: '07:00' }]);
    expect(benchItems({ ...night, startedAt: '2026-01-01T00:00:00Z', deadline: '2026-01-02T00:00:00Z' }, win)).toEqual([]);
    expect(benchItems(null, win)).toEqual([]);
  });
});
