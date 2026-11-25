// The week's sending pace (frontend/…/send-pace.js) and the goal it is read against (backend/services/sales/send-goal.js):
// the pure arithmetic and the goal's shape. RULE 0: the real modules, real dates, nothing mocked.
import { describe, expect, it } from 'vitest';
import { paceOf, weekStart, daysLeft } from '../../frontend/app/RelinkShell/company-line/send-pace.js';
import { makeGoal } from '../../backend/services/sales/send-goal.js';

// Wednesday 2026-11-25, 15:00 on this computer's clock.
const now = new Date(2026, 10, 25, 15, 0).getTime();
const at = (day, hour = 10) => new Date(2026, 10, day, hour, 0).toISOString();
const lead = (id, contact, campaignId, more = {}) => ({ id, contact, status: 'contacted', origin: { campaignId }, ...more });
const sent = (id, to, when) => ({ id, to: [to], state: 'sent', sentAt: when });
const engine = {
  campaigns: [{ id: 'k-a', name: 'Alder — Funding' }, { id: 'k-b', name: 'Alder — Customers' }],
  leads: [lead('l1', 'ada@one.example', 'k-a'), lead('l2', 'bo@two.example', 'k-a', { bounced: { at: at(24), address: 'bo@two.example' } }), lead('l3', 'cy@three.example', 'k-b', { status: 'replied' }), lead('l4', 'di@four.example', 'k-c')],
  outbox: { drafts: [
    sent('d1', 'ada@one.example', at(23)), sent('d2', 'Bo@Two.example', at(24)), sent('d3', 'cy@three.example', at(25, 9)), sent('d4', 'cy@three.example', at(25, 11)),
    sent('d5', 'di@four.example', at(25, 12)), sent('d6', 'ada@one.example', at(20)), // the week before: not counted
    { id: 'd7', to: ['ada@one.example'], state: 'waiting', sentAt: null }, { id: 'd8', to: ['nobody@else.example'], state: 'sent', sentAt: at(24) },
  ] },
};

describe('the week and what is left of it', () => {
  it('a week begins on Monday at midnight on this computer\'s clock; the working days left count today', () => {
    expect(new Date(weekStart(now)).toString()).toBe(new Date(2026, 10, 23, 0, 0).toString());
    expect([23, 24, 25, 26, 27, 28, 29].map((d) => daysLeft(new Date(2026, 10, d, 12).getTime()))).toEqual([5, 4, 3, 2, 1, 1, 1]);
  });
});

describe('where each campaign stands against its share', () => {
  it('the goal is split evenly; an email counts once sent, this week, under the campaign of the person it went to', () => {
    const pace = paceOf(engine, { weekly: 500, campaigns: ['k-a', 'k-b'] }, now);
    expect(pace).toMatchObject({ weekly: 500, share: 250, daysLeft: 3 });
    expect(pace.rows).toEqual([
      { id: 'k-a', name: 'Alder — Funding', target: 250, sent: 2, today: 0, toGo: 248, aDay: 83, bounced: 1, replied: 0 },
      { id: 'k-b', name: 'Alder — Customers', target: 250, sent: 2, today: 2, toGo: 248, aDay: 83, bounced: 0, replied: 1 }, // two emails, one person: they wrote back once
      { id: 'other', name: 'EVERYTHING ELSE', target: null, sent: 2, today: 1, toGo: null, aDay: null, bounced: 0, replied: 0 }, // a campaign outside the goal, and someone on no list
    ]);
    expect(pace.total).toEqual({ sent: 6, today: 3, bounced: 1, replied: 1, toGo: 496, aDay: 166 });
  });

  it('with no goal it still says what was sent this week', () => {
    const pace = paceOf(engine, null, now);
    expect(pace.rows.map((r) => [r.id, r.sent, r.target])).toEqual([['other', 6, null]]);
    expect(pace.total).toMatchObject({ sent: 6, toGo: null, aDay: null });
    expect(paceOf({}, null, now)).toMatchObject({ rows: [], total: { sent: 0 } });
  });
});

describe('the goal', () => {
  it('is a whole number of emails a week and the campaigns it is split between; 0 takes it away', () => {
    expect(makeGoal({ weekly: 500, campaigns: ['k-a', ' k-b ', 'k-a', ''] })).toEqual({ weekly: 500, campaigns: ['k-a', 'k-b'] });
    expect(makeGoal({ weekly: 0 })).toEqual({ weekly: 0, campaigns: [] });
    expect(() => makeGoal({ weekly: 500 })).toThrow(/campaigns: the campaigns/);
    for (const bad of [-1, 5001, 12.5, 'many', null]) expect(() => makeGoal({ weekly: bad, campaigns: ['k-a'] })).toThrow(/weekly:/);
  });
});
