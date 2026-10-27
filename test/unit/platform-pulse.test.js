// A platform's queue read as the operator's questions — the console head's fold
// (platform-pulse.js), counted in the queue's own taxonomy. Pure, real inputs.
import { describe, expect, test } from 'vitest';
import { platformPulse, scopeQueue, nextOut, untilLabel, STRIP_BEFORE, STRIP_AFTER } from '../../frontend/app/RelinkShell/platform-pulse.js';
import { buildMonthGrid } from '../../frontend/app/RelinkShell/queue-calendar.js';

const NOW = new Date(2026, 9, 21, 12, 0).getTime();
const at = (day, h = 9) => new Date(2026, 9, day, h, 0).toISOString();
const E = (id, status, day, over = {}) => ({ id, channelId: 'x', status, scheduledFor: day ? at(day) : null, text: `post ${id}`, ...over });
const QUEUE = [
  E('s1', 'sent', 5), E('s2', 'sent', 14), E('a1', 'approved', 22), E('a2', 'approved', 25), E('a3', 'approved', 20),
  E('d1', 'draft', 23), E('d2', 'draft', null), E('f1', 'failed', 12),
  E('r1', 'draft', 21, { kind: 'reply' }),
  E('o1', 'sent', 30, { channelId: 'bluesky' }), E('n1', 'sent', 3, { scheduledFor: new Date(2026, 10, 3, 9).toISOString() }),
];

describe('the platform pulse', () => {
  test('scoped to one platform, or the whole house', () => {
    expect(scopeQueue(QUEUE, 'x')).toHaveLength(10);
    expect(scopeQueue(QUEUE)).toHaveLength(11);
  });

  test('awaiting is every post draft (a reply draft is owed apart); the month counts by slot in the queue\'s own taxonomy', () => {
    const p = platformPulse(scopeQueue(QUEUE, 'x'), NOW);
    expect(p.awaiting).toBe(2);
    expect(p.repliesAwaiting).toBe(1);
    expect(p.unscheduled).toBe(1);
    expect(p.month).toEqual({ Q: 1, A: 3, U: 0, W: 0, S: 2, F: 1, R: 1 });
    // the month agrees with the calendar's own grid, cell for cell
    const grid = buildMonthGrid(2026, 9, scopeQueue(QUEUE, 'x'), { now: NOW }).flat();
    const sum = (k) => grid.reduce((t, c) => t + (c.counts?.[k] || 0), 0);
    expect(Object.fromEntries(Object.keys(p.month).map((k) => [k, sum(k)]))).toEqual(p.month);
  });

  test('next out is the soonest approved post ahead of now — never a past one, never a reply', () => {
    expect(nextOut(scopeQueue(QUEUE, 'x'), NOW).id).toBe('a1');
    expect(nextOut([E('p', 'approved', 1)], NOW)).toBeNull();
  });

  test('the strip runs fourteen days back and fourteen ahead, today marked once', () => {
    const { strip } = platformPulse(scopeQueue(QUEUE, 'x'), NOW);
    expect(strip).toHaveLength(STRIP_BEFORE + STRIP_AFTER);
    expect(strip.filter((d) => d.today)).toHaveLength(1);
    expect(strip[STRIP_BEFORE].today).toBe(true);
    expect(strip.find((d) => d.key === '2026-10-22').counts.A).toBe(1);
    expect(strip.find((d) => d.key === '2026-10-12').counts.F).toBe(1);
  });

  test('how far a time stands ahead', () => {
    expect(untilLabel(new Date(NOW + 30 * 60_000).toISOString(), NOW)).toBe('in 30m');
    expect(untilLabel(new Date(NOW + 3 * 3_600_000 + 12 * 60_000).toISOString(), NOW)).toBe('in 3h 12m');
    expect(untilLabel(new Date(NOW + 4 * 86_400_000).toISOString(), NOW)).toBe('in 4 days');
    expect(untilLabel(null, NOW)).toBe('—');
  });
});
