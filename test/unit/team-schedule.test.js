import { describe, expect, it } from 'vitest';
import {
  ESTIMATE_SOURCE_KINDS,
  SCHEDULE_POLICIES,
  buildSchedulePriorities,
  normalizeSchedulePolicy,
  observedCriticalPath,
  prioritizeReady,
  resolveScheduleEstimates,
  resolveSchedulePolicy,
} from '../../backend/services/team-schedule.js';

const step = (id, needs = [], extra = {}) => ({
  id,
  neumaId: `neuma-${id}`,
  role: `role-${id}`,
  task: `private task ${id}`,
  needs,
  ...extra,
});

const declared = (steps, durations) => resolveScheduleEstimates(steps, { declaredWaits: durations });
const byId = (rows) => Object.fromEntries(rows.map((row) => [row.stepId, row]));

describe('team schedule policy', () => {
  it('fails absent and unknown policy values closed to exact plan order', () => {
    expect(normalizeSchedulePolicy()).toBe(SCHEDULE_POLICIES.PLAN_ORDER);
    expect(normalizeSchedulePolicy('critical-path ')).toBe(SCHEDULE_POLICIES.PLAN_ORDER);
    expect(resolveSchedulePolicy(undefined, {})).toBe(SCHEDULE_POLICIES.PLAN_ORDER);
    expect(resolveSchedulePolicy(undefined, { NEUMA_TEAM_SCHEDULE_POLICY: 'unknown' }))
      .toBe(SCHEDULE_POLICIES.PLAN_ORDER);
  });

  it('lets an explicit experiment policy override the environment', () => {
    expect(resolveSchedulePolicy('plan-order', { NEUMA_TEAM_SCHEDULE_POLICY: 'critical-path' }))
      .toBe(SCHEDULE_POLICIES.PLAN_ORDER);
    expect(resolveSchedulePolicy('critical-path', { NEUMA_TEAM_SCHEDULE_POLICY: 'plan-order' }))
      .toBe(SCHEDULE_POLICIES.CRITICAL_PATH);
  });
});

describe('schedule estimate resolution', () => {
  it('uses declared waits before exact history and emits receipt-shaped rows', () => {
    const steps = [step('a', [], { role: 'wright', taskClass: 'analysis' })];
    const rows = resolveScheduleEstimates(steps, {
      declaredWaits: { a: 9 },
      contractVersion: 1,
      model: 'model-a',
      minimumHistorySamples: 1,
      history: [{
        contractVersion: 1,
        model: 'model-a',
        role: 'wright',
        taskClass: 'analysis',
        status: 'success',
        durationMs: 99,
      }],
    });

    expect(rows).toEqual([{
      stepId: 'a',
      durationMilliseconds: 9,
      sourceKind: ESTIMATE_SOURCE_KINDS.DECLARED_WAIT,
      sourceSampleCount: 1,
      sourceKeySha256: null,
    }]);
  });

  it('takes the successful median only from the exact frozen history key', () => {
    const steps = [step('a', [], { role: 'wright', taskClass: 'analysis' })];
    const exact = (durationMs, status = 'success') => ({
      contractVersion: 1,
      model: 'model-a',
      role: 'wright',
      taskClass: 'analysis',
      status,
      durationMs,
    });
    const [row] = resolveScheduleEstimates(steps, {
      contractVersion: 1,
      model: 'model-a',
      minimumHistorySamples: 3,
      history: [
        exact(8),
        exact(2),
        exact(4),
        exact(500, 'failure'),
        { ...exact(700), model: 'model-b' },
        { ...exact(900), taskClass: 'different' },
      ],
    });

    expect(row.durationMilliseconds).toBe(4);
    expect(row.sourceKind).toBe(ESTIMATE_SOURCE_KINDS.EXACT_HISTORY);
    expect(row.sourceSampleCount).toBe(3);
    expect(row.sourceKeySha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses neutral one for absent or undersampled exact history without hiding its count', () => {
    const steps = [
      step('undersampled', [], { role: 'wright', taskClass: 'analysis' }),
      step('unclassified', [], { role: 'wright' }),
    ];
    const rows = byId(resolveScheduleEstimates(steps, {
      contractVersion: 1,
      model: 'model-a',
      minimumHistorySamples: 2,
      history: [{
        contractVersion: 1,
        model: 'model-a',
        role: 'wright',
        taskClass: 'analysis',
        status: 'success',
        durationMs: 12,
      }],
    }));

    expect(rows.undersampled).toMatchObject({
      durationMilliseconds: 1,
      sourceKind: ESTIMATE_SOURCE_KINDS.NEUTRAL_ONE,
      sourceSampleCount: 1,
    });
    expect(rows.undersampled.sourceKeySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(rows.unclassified).toMatchObject({
      durationMilliseconds: 1,
      sourceKind: ESTIMATE_SOURCE_KINDS.NEUTRAL_ONE,
      sourceSampleCount: 0,
      sourceKeySha256: null,
    });
  });

  it('never lets task text influence an estimate', () => {
    const inputs = {
      contractVersion: 1,
      model: 'model-a',
      taskClasses: { a: 'declared-class' },
      minimumHistorySamples: 1,
      history: [{
        contractVersion: 1,
        model: 'model-a',
        role: 'wright',
        taskClass: 'declared-class',
        status: 'success',
        durationMs: 7,
      }],
    };
    const left = resolveScheduleEstimates([{ ...step('a'), role: 'wright', task: 'short' }], inputs);
    const right = resolveScheduleEstimates([{ ...step('a'), role: 'wright', task: 'entirely different private prose' }], inputs);
    expect(left).toEqual(right);
  });
});

describe('reverse-DAG priorities', () => {
  it('computes chain and balanced-diamond remaining weights', () => {
    const chain = [step('a'), step('b', ['a']), step('c', ['b'])];
    expect(byId(buildSchedulePriorities(chain, declared(chain, { a: 2, b: 3, c: 5 }))))
      .toMatchObject({
        a: { remainingPathWeight: 10, uniqueDescendantCount: 2 },
        b: { remainingPathWeight: 8, uniqueDescendantCount: 1 },
        c: { remainingPathWeight: 5, uniqueDescendantCount: 0 },
      });

    const diamond = [step('root'), step('left', ['root']), step('right', ['root']), step('join', ['left', 'right'])];
    expect(byId(buildSchedulePriorities(diamond, declared(diamond, {
      root: 1, left: 1, right: 1, join: 1,
    })))).toMatchObject({
      root: { remainingPathWeight: 3, uniqueDescendantCount: 3 },
      left: { remainingPathWeight: 2, uniqueDescendantCount: 1 },
      right: { remainingPathWeight: 2, uniqueDescendantCount: 1 },
      join: { remainingPathWeight: 1, uniqueDescendantCount: 0 },
    });
  });

  it('counts unique descendants through wide fan-out/fan-in rather than double counting the join', () => {
    const steps = [
      step('root'),
      step('a', ['root']),
      step('b', ['root']),
      step('c', ['root']),
      step('join', ['a', 'b', 'c']),
    ];
    const priorities = byId(buildSchedulePriorities(steps, declared(steps, {
      root: 1, a: 1, b: 1, c: 1, join: 1,
    })));
    expect(priorities.root.uniqueDescendantCount).toBe(4);
    expect(priorities.root.remainingPathWeight).toBe(3);
  });

  it('orders asymmetric ready roots by weight, descendants, then authored index', () => {
    const steps = [
      step('authored-tie'),
      step('critical'),
      step('branchy'),
      step('tie'),
      step('critical-end', ['critical']),
      step('branch-mid', ['branchy']),
      step('branch-end', ['branch-mid']),
    ];
    const priorities = buildSchedulePriorities(steps, declared(steps, {
      'authored-tie': 3,
      critical: 1,
      branchy: 1,
      tie: 3,
      'critical-end': 5,
      'branch-mid': 1,
      'branch-end': 1,
    }));
    const ready = [steps[0], steps[1], steps[2], steps[3]];
    expect(prioritizeReady(ready, { policy: 'critical-path', priorities }).map((row) => row.id))
      .toEqual(['critical', 'branchy', 'authored-tie', 'tie']);
  });

  it('returns exact plan-order identity and cannot add, remove, or mutate ready membership', () => {
    const steps = [step('a'), step('b'), step('blocked', ['a'])];
    const priorities = buildSchedulePriorities(steps, declared(steps, { a: 1, b: 1, blocked: 5 }));
    const ready = [steps[1], steps[0]];
    expect(prioritizeReady(ready, { policy: 'plan-order', priorities })).toBe(ready);

    const prioritized = prioritizeReady(ready, { policy: 'critical-path', priorities });
    expect(prioritized).not.toBe(ready);
    expect(new Set(prioritized)).toEqual(new Set(ready));
    expect(ready.map((row) => row.id)).toEqual(['b', 'a']);
    expect(prioritized.some((row) => row.id === 'blocked')).toBe(false);
  });
});

describe('observed successful critical path', () => {
  const steps = [step('a'), step('b', ['a']), step('independent')];

  it('uses successful observed durations and sums only ready-to-start idle on that path', () => {
    const path = observedCriticalPath(steps, [
      { stepId: 'a', durationMs: 5, waitMs: 1, status: 'success' },
      { stepId: 'b', durationMs: 7, waitMs: 2, status: 'success' },
      { stepId: 'independent', durationMs: 10, waitMs: 4, status: 'success' },
    ]);
    expect(path).toEqual({ stepIds: ['a', 'b'], durationMs: 12, idleMs: 3 });
  });

  it('excludes failures and never bridges a failed prerequisite', () => {
    const path = observedCriticalPath(steps, [
      { stepId: 'a', durationMs: 50, waitMs: 1, status: 'failure' },
      { stepId: 'b', durationMs: 70, waitMs: 2, status: 'success' },
      { stepId: 'independent', durationMs: 3, waitMs: 0, status: 'success' },
    ]);
    expect(path).toEqual({ stepIds: ['independent'], durationMs: 3, idleMs: 0 });
  });

  it('keeps the successful critical branch when a noncritical branch fails', () => {
    expect(observedCriticalPath(steps, [
      { stepId: 'a', durationMs: 5, waitMs: 1, status: 'success' },
      { stepId: 'b', durationMs: 7, waitMs: 2, status: 'success' },
      { stepId: 'independent', durationMs: 30, waitMs: 0, status: 'failure' },
    ])).toEqual({ stepIds: ['a', 'b'], durationMs: 12, idleMs: 3 });
  });

  it('treats an unobserved seeded prerequisite as a path boundary instead of fabricated time', () => {
    expect(observedCriticalPath(steps, [
      { stepId: 'b', durationMs: 7, waitMs: 2, status: 'success' },
    ])).toEqual({ stepIds: ['b'], durationMs: 7, idleMs: 2 });
  });
});
