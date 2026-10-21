/**
 * The charter's shape (house-clock/charter-shape.js) — pure, so every check is
 * a real input against a real output: what an operator may write, what is
 * refused with a reason they can act on, and the two lines no charter moves
 * (money out, the sandbox's reach).
 */
import { describe, test, expect } from 'vitest';
import {
  normalizeCharter, charterStanding, charterSeat, MONEY_OUT,
} from '../../backend/services/house-clock/charter-shape.js';

const base = () => ({
  goal: 'Build and sell one useful research digest a week.',
  seats: [{ laneId: 'optio-lane', dailyCap: 6 }, { laneId: 'scribe-lane', dailyCap: 3 }],
});

describe('a charter an operator writes', () => {
  test('the least a charter says is a goal and one seat; the rest takes its defaults', () => {
    const c = normalizeCharter(base(), { ownedLanes: ['optio-lane', 'scribe-lane'] });
    expect(c.goal).toBe('Build and sell one useful research digest a week.');
    expect(c.seats).toEqual([{ laneId: 'optio-lane', dailyCap: 6 }, { laneId: 'scribe-lane', dailyCap: 3 }]);
    expect(c.quietHours).toBeNull();
    expect(c.cadence).toBeNull();
    expect(c.delegation).toEqual({ teamPlans: false, maxMembers: 4, maxSteps: 8 });
    expect(c.allow).toEqual([]);
    // money out always comes back to the operator, written or not
    expect(c.escalate).toEqual(MONEY_OUT);
    expect(Object.isFrozen(c)).toBe(true);
  });

  test('every field, written whole, lands as written', () => {
    const c = normalizeCharter({
      ...base(),
      linesOfWork: ['research digests', 'outreach drafts'],
      quietHours: { start: '22:00', end: '07:00' },
      cadence: { everyHours: 24 },
      delegation: { teamPlans: true, maxMembers: 3, maxSteps: 6 },
      allow: ['web/web_search', 'intents/tasks.add'],
      escalate: ['intents/social.post', 'intents/wallet.send'],
    });
    expect(c.linesOfWork).toEqual(['research digests', 'outreach drafts']);
    expect(c.quietHours).toEqual({ start: '22:00', end: '07:00' });
    expect(c.cadence).toEqual({ everyHours: 24 });
    expect(c.delegation).toEqual({ teamPlans: true, maxMembers: 3, maxSteps: 6 });
    expect(c.allow).toEqual(['web/web_search', 'intents/tasks.add']);
    expect(c.escalate).toEqual(['intents/social.post', 'intents/wallet.send']);
  });
});

describe('what a charter can never say', () => {
  const refuse = (patch, pattern, opts) => expect(() => normalizeCharter({ ...base(), ...patch }, opts)).toThrow(pattern);

  test('money out is never pre-allowed', () => refuse({ allow: ['intents/wallet.send'] }, /money out/));
  test('the sandbox is never widened', () => {
    refuse({ allow: ['filesystem/delete_file'] }, /sandbox/);
    refuse({ allow: ['coding/execute'] }, /sandbox/);
    refuse({ allow: ['fs/write'] }, /sandbox/);
  });
  test('an act is never both allowed and escalated', () => refuse({ allow: ['web/web_fetch'], escalate: ['web/web_fetch'] }, /both/));
  test('a seat must be a being of this house', () => refuse({}, /not a being of this house/, { ownedLanes: ['optio-lane'] }));
  test('a seat needs a daily cap', () => refuse({ seats: [{ laneId: 'optio-lane' }] }, /dailyCap/));
  test('a seat is named once', () => refuse({ seats: [{ laneId: 'a', dailyCap: 1 }, { laneId: 'a', dailyCap: 2 }] }, /twice/));
  test('no seats, no charter', () => refuse({ seats: [] }, /at least one seat/));
  test('no goal, no charter', () => refuse({ goal: '  ' }, /goal/));
  test('quiet hours are real local times', () => {
    refuse({ quietHours: { start: '25:00', end: '07:00' } }, /HH:MM/);
    refuse({ quietHours: { start: '07:00', end: '07:00' } }, /differ/);
  });
  test('a cadence is whole hours within a week', () => refuse({ cadence: { everyHours: 0 } }, /cadence/));
  test('an act id is server/tool', () => refuse({ allow: ['post everything'] }, /not an act id/));
  test('handed the acts the house knows, an unknown one is refused by name; a known one lands', () => {
    const knownActs = new Set(['intents/social.post', 'web/web_search']);
    refuse({ escalate: ['intents/social.posts'] }, /"intents\/social.posts" in escalate is not an act this house knows/, { knownActs });
    refuse({ allow: ['web/web_serch'] }, /"web\/web_serch" in allow is not an act this house knows/, { knownActs });
    expect(normalizeCharter({ ...base(), allow: ['web/web_search'], escalate: ['intents/social.post'] }, { knownActs }).escalate)
      .toEqual(['intents/social.post', 'intents/wallet.send']);
  });
  test('an unknown field is refused, never dropped', () => refuse({ autoApproveEverything: true }, /no field "autoApproveEverything"/));
});

describe('where a charter stands', () => {
  const record = (patch) => ({ version: 2, approvedAt: '2026-10-16T00:00:00.000Z', approvedVersion: 2, paused: false, ...patch });
  test('none, unapproved, paused, active', () => {
    expect(charterStanding(null)).toBe('none');
    expect(charterStanding(record({ approvedAt: null, approvedVersion: null }))).toBe('unapproved');
    // an approval of an older version is not an approval of this one
    expect(charterStanding(record({ approvedVersion: 1 }))).toBe('unapproved');
    expect(charterStanding(record({ paused: true }))).toBe('paused');
    expect(charterStanding(record())).toBe('active');
  });
  test('a seat outside the charter has no row', () => {
    const c = { seats: [{ laneId: 'a', dailyCap: 2 }] };
    expect(charterSeat(c, 'a')).toEqual({ laneId: 'a', dailyCap: 2 });
    expect(charterSeat(c, 'b')).toBeNull();
    expect(charterSeat(null, 'a')).toBeNull();
  });
});
