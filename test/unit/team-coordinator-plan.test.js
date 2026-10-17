// team-coordinator-plan.test.js — the scheduler's PURE decisions, proven with
// real inputs and real outputs, no mock: validatePlan, readySteps, isComplete,
// buildBrief. The execution seam (runTeam, resolveTeamCapacity, the shadow
// clone) is proven in team-coordinator-run.test.js; the REAL askNeuma path is
// proven live in team-coordinator-live.test.js.

import { describe, it, expect } from 'vitest';
import {
  validatePlan,
  readySteps,
  isComplete,
  buildBrief,
} from '../../backend/services/team-coordinator.js';

const step = (id, task, needs = [], neumaId = `neuma-${id}`) => ({ id, neumaId, task, needs });

describe('validatePlan (pure)', () => {
  it('accepts a well-formed DAG and freezes it', () => {
    const plan = validatePlan([step('a', 'A'), step('b', 'B', ['a'])]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan[0])).toBe(true);
  });

  it('rejects an empty plan', () => {
    expect(() => validatePlan([])).toThrow(/at least one step/);
  });

  it('rejects duplicate ids', () => {
    expect(() => validatePlan([step('a', 'A'), step('a', 'B')])).toThrow(/duplicate step id: a/);
  });

  it('rejects a step with no neumaId', () => {
    expect(() => validatePlan([{ id: 'a', task: 'A' }])).toThrow(/no neumaId/);
  });

  it('rejects a need on an unknown step', () => {
    expect(() => validatePlan([step('a', 'A', ['ghost'])])).toThrow(/needs unknown step: ghost/);
  });

  it('rejects blank done criteria (given means meant)', () => {
    expect(() => validatePlan([{ ...step('a', 'A'), done: '   ' }])).toThrow(/done criteria/);
  });

  it('rejects a self-dependency', () => {
    expect(() => validatePlan([step('a', 'A', ['a'])])).toThrow(/cannot need itself/);
  });

  it('rejects a dependency cycle (would hang forever)', () => {
    expect(() => validatePlan([step('a', 'A', ['b']), step('b', 'B', ['a'])]))
      .toThrow(/dependency cycle/);
  });

  it('accepts an optional role; rejects a non-string or blank one', () => {
    expect(validatePlan([{ ...step('a', 'A'), role: 'WRIGHT' }])[0].role).toBe('WRIGHT');
    expect(() => validatePlan([{ ...step('a', 'A'), role: 42 }])).toThrow(/role must be a non-empty string/);
    expect(() => validatePlan([{ ...step('a', 'A'), role: '  ' }])).toThrow(/role must be a non-empty string/);
  });
});

describe('readySteps / isComplete (pure)', () => {
  const plan = [step('a', 'A'), step('b', 'B'), step('c', 'C', ['a', 'b'])];

  it('independent steps are ready together; the dependent waits', () => {
    const ready = readySteps(plan, new Set(), new Set());
    expect(ready.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('does not re-offer a running or done step', () => {
    expect(readySteps(plan, new Set(['a']), new Set(['b'])).map((s) => s.id)).toEqual([]);
  });

  it('the dependent becomes ready only when ALL needs are done', () => {
    expect(readySteps(plan, new Set(['a']), new Set()).map((s) => s.id)).toEqual(['b']);
    expect(readySteps(plan, new Set(['a', 'b']), new Set()).map((s) => s.id)).toEqual(['c']);
  });

  it('isComplete only when every step has finished', () => {
    expect(isComplete(plan, new Set(['a', 'b']))).toBe(false);
    expect(isComplete(plan, new Set(['a', 'b', 'c']))).toBe(true);
  });
});

describe('buildBrief (pure) — load-bearing outputs enter the next neuma', () => {
  const plan = [step('research', 'research the market'), step('write', 'write the summary', ['research'])];

  it('a step with no needs gets just its task', () => {
    const msgs = buildBrief(plan[0], {}, plan);
    expect(msgs[0].content).toContain('Your part: research the market');
    expect(msgs[0].content).not.toContain('Earlier members');
  });

  it('a dependent step receives its prerequisite output, labelled', () => {
    const msgs = buildBrief(plan[1], { research: 'the market is X' }, plan);
    expect(msgs[0].content).toContain('research the market');
    expect(msgs[0].content).toContain('the market is X');
    expect(msgs[0].content).toContain('Your part: write the summary');
  });

  it('a role enters the brief, and priors are labelled by their producer\'s role', () => {
    const rolePlan = [
      { ...step('spec', 'write the spec'), role: 'HELM' },
      { ...step('build', 'build it', ['spec']), role: 'WRIGHT' },
    ];
    const msgs = buildBrief(rolePlan[1], { spec: 'the spec says X' }, rolePlan);
    expect(msgs[0].content).toContain('Your role: WRIGHT.');
    expect(msgs[0].content).toContain('HELM — write the spec');
    expect(msgs[0].content).toContain('the spec says X');
  });

  it('with no role, the brief stays exactly role-free (old plans unchanged)', () => {
    const msgs = buildBrief(plan[0], {}, plan);
    expect(msgs[0].content).not.toContain('Your role:');
  });

  // The LOCKED trial (TRIAL_VERSION 2) sends plans with no goal and no done
  // criteria — its briefs must render BYTE-IDENTICALLY to the pre-goal wording.
  it('without goal/done the wording is byte-identical to the locked v2 form', () => {
    expect(buildBrief(plan[0], {}, plan)[0].content).toBe(
      'You are one member of a team working a shared goal. Your part: research the market'
    );
    expect(buildBrief(plan[1], { research: 'the market is X' }, plan)[0].content).toBe(
      'You are one member of a team working a shared goal. Earlier members completed work you must build on:\n\n' +
      '— research the market:\nthe market is X\n\nYour part: write the summary'
    );
  });

  it('a goal enters EVERY brief, with a teammate map that excludes the member itself', () => {
    const rolePlan = [
      { ...step('spec', 'write the spec'), role: 'HELM' },
      { ...step('build', 'build it', ['spec']), role: 'WRIGHT' },
    ];
    const msgs = buildBrief(rolePlan[0], {}, rolePlan, { goal: 'ship a working demo' });
    const content = msgs[0].content;
    expect(content).toContain("The team's GOAL — every member's output must serve it: ship a working demo");
    expect(content).toContain('Working beside you (each part belongs to its owner — deliver YOUR part; do not redo or override theirs):');
    expect(content).toContain('— WRIGHT: build it');
    expect(content).not.toContain('— HELM'); // never lists the member to itself
    expect(content).toContain('Your part: write the spec');
  });

  it('a done-checklist closes the brief: the member knows when its part counts', () => {
    const donePlan = [{ ...step('a', 'draft the copy'), done: 'three variants, each under 50 words' }];
    const content = buildBrief(donePlan[0], {}, donePlan)[0].content;
    expect(content).toContain('Your part is DONE only when: three variants, each under 50 words');
    expect(content.endsWith('three variants, each under 50 words')).toBe(true);
  });

  it("teammate tasks are clipped in the map — enough to know a lane is taken, not to work it", () => {
    const long = 'x'.repeat(300);
    const bigPlan = [step('a', 'mine'), step('b', long)];
    const content = buildBrief(bigPlan[0], {}, bigPlan, { goal: 'g' })[0].content;
    expect(content).toContain(`${'x'.repeat(240)}…`);
    expect(content).not.toContain('x'.repeat(241));
  });

  it('a solo plan with a goal gets the goal but no teammate map', () => {
    const solo = [step('a', 'do the thing')];
    const content = buildBrief(solo[0], {}, solo, { goal: 'g' })[0].content;
    expect(content).toContain("The team's GOAL");
    expect(content).not.toContain('Working beside you');
  });

  it('a teammate whose output the member already holds is shown ONCE — with that output, never again in the map', () => {
    const rolePlan = [
      { ...step('spec', 'write the spec'), role: 'HELM' },
      { ...step('build', 'build it', ['spec']), role: 'WRIGHT' },
      { ...step('ship', 'ship it'), role: 'HERALD' },
    ];
    const content = buildBrief(rolePlan[1], { spec: 'the spec' }, rolePlan, { goal: 'ship it' })[0].content;
    expect(content.split('write the spec').length - 1).toBe(1); // the prior's label, only
    expect(content).toContain('— HERALD: ship it'); // an independent teammate is still mapped
    const onlyNeeds = buildBrief(rolePlan[1], { spec: 'the spec' }, rolePlan.slice(0, 2), { goal: 'g' })[0].content;
    expect(onlyNeeds).not.toContain('Working beside you');
  });

  it('the LEAN brief: the part leads, context follows, ONE sign-off — and no ask to name its files', async () => {
    const { SIGNOFF_ASK } = await import('../../backend/services/team-board.js');
    const rolePlan = [
      { ...step('spec', 'write the spec'), role: 'HELM' },
      { ...step('build', 'build it', ['spec']), role: 'WRIGHT', files: ['build.md'] },
      { ...step('ship', 'ship it'), role: 'HERALD' },
    ];
    const content = buildBrief(rolePlan[1], { spec: 'the spec' }, rolePlan, {
      goal: 'ship it', signoff: true, memberTools: true, lead: 'Keir',
      workspace: { root: '/arena', budgetBytes: 1024 * 1024 },
    })[0].content;
    expect(content.startsWith('Your team lead Keir briefs you')).toBe(true);
    expect(content.indexOf('Your part: build it')).toBeLessThan(content.indexOf("The team's GOAL"));
    expect(content.indexOf('DELIVERS these files')).toBeLessThan(content.indexOf("The team's GOAL"));
    expect(content.indexOf("The team's GOAL")).toBeLessThan(content.indexOf('Earlier members'));
    expect(content.trim().endsWith(SIGNOFF_ASK)).toBe(true);
    expect(content).not.toContain('"TORCH:"');
    expect(content).not.toContain('name every file');
    expect(content).not.toMatch(/\d-\d short lines/);
  });

  it('a board snapshot and the STATUS ask enter the coordinated brief, in order', () => {
    const rolePlan = [
      { ...step('spec', 'write the spec'), role: 'HELM' },
      { ...step('build', 'build it', ['spec']), role: 'WRIGHT' },
      { ...step('ship', 'ship it'), role: 'HERALD' },
    ];
    const boardText = 'TEAM BOARD — where everyone stands right now:\n— HELM [DONE]\n— WRIGHT (YOU) [WORKING]';
    const content = buildBrief(rolePlan[1], { spec: 'the spec' }, rolePlan, {
      goal: 'ship it',
      board: boardText,
      statusAsk: true,
    })[0].content;
    expect(content).toContain(boardText);
    // Order: goal → mates → board → priors → your part → status ask.
    expect(content.indexOf("The team's GOAL")).toBeLessThan(content.indexOf('Working beside you'));
    expect(content.indexOf('Working beside you')).toBeLessThan(content.indexOf('TEAM BOARD'));
    expect(content.indexOf('TEAM BOARD')).toBeLessThan(content.indexOf('Earlier members'));
    expect(content.indexOf('Your part: build it')).toBeLessThan(content.indexOf('"STATUS:"'));
    expect(content.trim().endsWith('you hand to whoever builds on your work.')).toBe(true);
  });

  it("the member's own torch and the TORCH ask enter the coordinated brief, in order", () => {
    const relayPlan = [{ ...step('draft', 'write the posts'), role: 'HELM', done: 'ten posts' }];
    const content = buildBrief(relayPlan[0], {}, relayPlan, {
      goal: 'ship it',
      statusAsk: true,
      torchAsk: true,
      torch: 'picked themes A and B\npick up at the drafting',
    })[0].content;
    // Order: your part → done → your own torch → status ask → torch ask —
    // the torch instruction is the brief's LAST word, so the torch is the
    // reply's last block and extraction peels torch-then-status cleanly.
    expect(content.indexOf('Your part: write the posts')).toBeLessThan(content.indexOf('DONE only when'));
    expect(content.indexOf('DONE only when')).toBeLessThan(content.indexOf('Your torch from your last instance:'));
    expect(content).toContain('Your torch from your last instance:\npicked themes A and B');
    expect(content.indexOf('"STATUS:"')).toBeLessThan(content.indexOf('"TORCH:"'));
    expect(content.trim().endsWith('where to pick up.')).toBe(true);
  });

  it('a torch alone forces the coordinated form — authored continuity never rides the legacy brief', () => {
    const solo = [step('a', 'do the thing')];
    const content = buildBrief(solo[0], {}, solo, { torch: 'my own words' })[0].content;
    expect(content).toContain('Your torch from your last instance:\nmy own words');
    expect(content).not.toBe('You are one member of a team working a shared goal. Your part: do the thing');
  });
});
