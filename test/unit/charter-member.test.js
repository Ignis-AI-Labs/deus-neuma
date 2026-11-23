import { describe, test, expect } from 'vitest';
import { memberCharterInput, normalizeCharter, MONEY_OUT } from '../../backend/services/house-clock/charter-shape.js';

const PRIOR = Object.freeze({
  goal: 'Earn for the house.', linesOfWork: ['trade'], seats: [{ laneId: 'tenekom', dailyCap: 24 }, { laneId: 'rugevil', dailyCap: 6 }],
  quietHours: { start: '23:00', end: '07:00' }, cadence: { everyHours: 2 }, delegation: { teamPlans: false, maxMembers: 4, maxSteps: 8, maxProgrammeRuns: 3 },
  allow: ['intents/social.queue'], escalate: ['intents/social.post', ...MONEY_OUT], involvement: null,
});

describe('a member\'s change to its own house\'s charter', () => {
  test('only the fields it names change; the operator\'s three ride over untouched', () => {
    const next = memberCharterInput(PRIOR, { quietHours: null, cadence: { everyHours: 4 } }, 'rugevil');
    expect(next).toMatchObject({ goal: PRIOR.goal, seats: PRIOR.seats, quietHours: null, cadence: { everyHours: 4 }, allow: PRIOR.allow, escalate: PRIOR.escalate });
    expect(normalizeCharter(next, { ownedLanes: ['tenekom', 'rugevil'] }).quietHours).toBeNull();
  });

  test('seat sets or removes its OWN seat and leaves every other one', () => {
    expect(memberCharterInput(PRIOR, { seat: { dailyCap: 48 } }, 'rugevil').seats).toEqual([{ laneId: 'tenekom', dailyCap: 24 }, { laneId: 'rugevil', dailyCap: 48 }]);
    expect(memberCharterInput(PRIOR, { seat: null }, 'rugevil').seats).toEqual([{ laneId: 'tenekom', dailyCap: 24 }]);
    expect(() => memberCharterInput(PRIOR, { seat: 12 }, 'rugevil')).toThrow(/seat is \{dailyCap\}/);
  });

  test('a house with no charter: the member sets one up, and money out still comes back to the operator', () => {
    const next = normalizeCharter(memberCharterInput(null, { goal: 'Run the LP book.', seat: { dailyCap: 24 } }, 'tenekom'), { ownedLanes: ['tenekom'] });
    expect(next.seats).toEqual([{ laneId: 'tenekom', dailyCap: 24 }]);
    expect(next.allow).toEqual([]);
    expect(next.escalate).toEqual(MONEY_OUT);
  });

  test('what a wake takes without asking, what comes back to the operator, and how close they stand are never a member\'s to write', () => {
    for (const field of ['allow', 'escalate', 'involvement']) {
      expect(() => memberCharterInput(PRIOR, { [field]: [] }, 'rugevil')).toThrow(/stay your operator's/);
    }
    expect(() => memberCharterInput(PRIOR, { paused: false }, 'rugevil')).toThrow(/no field "paused"/);
    expect(() => memberCharterInput(PRIOR, {}, 'rugevil')).toThrow(/name at least one/);
  });
});
