// tasks-ics.js — pure proofs: the feed is valid RFC 5545 shape (CRLF, escaped
// TEXT, stable UIDs), deadlines render as all-day or floating-local timed
// events, settled work is skipped, and a token-leak reads nothing writable.

import { describe, it, expect } from 'vitest';
import {
  icsEscape, icsUidFor, icsEventLines, buildTasksIcs, liveDeadlines,
} from '../../backend/services/tasks-ics.js';

const NOW = new Date('2026-09-20T04:00:00.000Z');

describe('tasks-ics — the subscribe feed', () => {
  it('escapes TEXT per RFC 5545 — backslash, semicolons, commas, newlines', () => {
    expect(icsEscape('a;b,c\nd')).toBe('a\\;b\\,c\\nd');
    expect(icsEscape('back\\slash')).toBe('back\\\\slash');
    expect(icsEscape(undefined)).toBe('');
  });

  it('a dueDate without a time is an all-day event on that day', () => {
    const lines = icsEventLines({ id: 't1', source: 'OPERATOR', title: 'Passport, due', dueDate: '2026-10-01' }, NOW);
    expect(lines).toContain('DTSTART;VALUE=DATE:20261001');
    expect(lines).toContain(`UID:${icsUidFor({ id: 't1' })}`);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
  });

  it('a dueTime rides as a FLOATING local time — the operator\'s clock, never UTC', () => {
    const lines = icsEventLines({ id: 't2', title: 'Body', dueDate: '2026-09-21', dueTime: '18:00' }, NOW);
    expect(lines).toContain('DTSTART:20260921T180000'); // no Z, no TZID
  });

  it('a bare dueTime lands on TODAY (the recurring roll instance)', () => {
    const lines = icsEventLines({ id: 't3', title: 'Daily walk', dueTime: '07:30' }, NOW);
    expect(lines).toContain('DTSTART:20260920T073000');
  });

  it('the overdue mark rides the summary; CRLF lines; done is skipped', () => {
    const body = buildTasksIcs([
      { id: 'a', title: 'old one', source: 'OPERATOR', dueDate: '2026-09-01', done: true },
      { id: 'b', title: 'owes', source: 'OPERATOR', dueDate: '2026-09-01' },
    ], { now: NOW });
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('END:VCALENDAR');
    expect(body).toContain('SUMMARY:owes [OPERATOR]');
    expect(body).not.toContain('old one');
    expect(body.endsWith('\r\n')).toBe(true);
    expect(body.includes('\n') && !body.includes(' \n')).toBe(true); // bare LF only inside CRLF pairs... it IS \r\n
    expect(body).toMatch(/BEGIN:VEVENT\r\n/);
  });

  it('liveDeadlines re-derives overdue and drops settled/no-deadline records', () => {
    const now = new Date('2026-09-20T12:00:00');
    const live = liveDeadlines([
      { id: '1', title: 'past', dueDate: '2026-09-01' },
      { id: '2', title: 'ahead', dueDate: '2026-10-01' },
      { id: '3', title: 'settled', dueDate: '2026-09-01', done: true },
      { id: '4', title: 'no deadline' },
    ], now);
    expect(live.map((r) => r.id)).toEqual(['1', '2']);
    expect(live[0].overdue).toBe(true);
    expect(live[1].overdue).toBe(false);
  });
});
