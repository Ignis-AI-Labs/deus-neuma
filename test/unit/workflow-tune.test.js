// workflow-tune.test.js — what GOVERNS a run, on the operator's desk (#577):
// the store follows the tune and clock frames exactly as the server sends
// them (team-run-tune.js, team-run-live.js markStepClock), the WORKFLOW window
// shows each part's working time and clock in the server's own words, the
// operator's hands are there while the run works, the plan card says how long
// and how wide BEFORE the yes, and a member's log reads its clock acting. Real
// inputs, real render (react-dom/server) — RULE 0.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { teamRunsReducer, initialTeamRuns, TEAM_RUN_FRAMES } from '../../frontend/app/RelinkShell/team-runs-reducer.js';
import { TeamRunsContext, createTeamRunsStore } from '../../frontend/app/RelinkShell/team-runs-context.js';
import { workflowApp } from '../../frontend/app/RelinkShell/WorkflowApp.jsx';
import { standingOf } from '../../frontend/app/RelinkShell/WorkflowMember.jsx';
import { clockLineOf, spanOf } from '../../frontend/app/RelinkShell/WorkflowTune.jsx';
import { LogList } from '../../frontend/app/RelinkShell/WorkflowMemberLog.jsx';
import { PlanChip } from '../../frontend/app/RelinkShell/PlanChip.jsx';
import { governsOf } from '../../backend/services/team-clock.js';

const BOARD = [
  { id: 'g1', neumaId: 'zezebur', member: 'Zezebur', state: 'working', status: null },
  { id: 'g2', neumaId: 'kisonam', member: 'Kisonam', state: 'working', status: null },
];
const CLOCK = Object.freeze({ work: 120, dueDate: null, dueTime: null, then: 'wrap-up' });
// The start frame as team-run-start.js sends it: the board, then what governs the run.
const START = {
  type: 'operator:team_start', id: 'run-7', background: true, lead: 'Zezebur', laneId: 'zezebur', name: 'GAP SPRINT', goal: 'Validate the gaps.', board: BOARD,
  ...governsOf({ concurrency: 1, ceiling: 3, clock: CLOCK, clocks: { g2: 'none' }, board: BOARD }), worked: {}, clockState: {},
};
const frames = (list) => list.reduce((state, f) => teamRunsReducer(state, { ...f, type: TEAM_RUN_FRAMES[f.type] }), initialTeamRuns);
const render = (state) => renderToStaticMarkup(
  createElement(TeamRunsContext.Provider, { value: createTeamRunsStore(state) }, createElement(workflowApp.Body)),
);

describe('the store follows what governs each run', () => {
  it('the start carries the width, the run\'s clock and each part\'s — a part opted out reads no clock', () => {
    const run = frames([START]).runs['run-7'];
    expect(run).toMatchObject({ concurrency: 1, ceiling: 3, clockWords: '2h of work, then wrap up' });
    expect(run.partClocks.g1).toMatchObject({ own: null, words: '2h of work, then wrap up', limitMs: 120 * 60_000 });
    expect(run.partClocks.g2).toMatchObject({ own: 'none', words: 'no clock — works until done or stopped', limitMs: null });
  });

  it('a hand\'s change, a part\'s working time, its clock acting — and a settled run works no more', () => {
    const tune = { type: 'operator:team_tune', id: 'run-7', ...governsOf({ concurrency: 2, ceiling: 3, clock: CLOCK, clocks: {}, board: BOARD }), clockState: {}, by: 'Zezebur (the Optio)' };
    const working = { type: 'operator:team_clock', id: 'run-7', stepId: 'g1', worked: 600000, since: 1_000, passed: null };
    const passed = { type: 'operator:team_clock', id: 'run-7', stepId: 'g1', worked: 7_200_000, since: null, passed: { passed: true, by: 'work', then: 'wrap-up', clock: '2h of work, then wrap up' } };
    const run = frames([START, tune, working]).runs['run-7'];
    expect(run.concurrency).toBe(2);
    expect(run.tunedBy).toEqual({ by: 'Zezebur (the Optio)', stepId: null });
    expect(run.partClocks.g2.words).toBe('2h of work, then wrap up');
    expect(run.worked.g1).toBe(600000);
    expect(run.workingSince.g1).toBe(1_000);
    const after = frames([START, tune, working, passed]).runs['run-7'];
    expect(after.workingSince).toEqual({});
    expect(after.clockState.g1).toMatchObject({ then: 'wrap-up' });
    const settled = frames([START, working, { type: 'operator:team_done', id: 'run-7', status: 'done', order: [] }]).runs['run-7'];
    expect(settled.workingSince).toEqual({});
  });
});

describe('where a part stands and what its clock says', () => {
  it('held by its run\'s own width — not by the model', () => {
    expect(standingOf({ state: 'held', position: 1, of: 2 }, null)).toBe('HELD — THE RUN WORKS 2 AT A TIME · 1 IN ITS LINE');
  });

  it('working time, what is left, a due, a clock that acted — or nothing for a part that has not begun', () => {
    const now = 10_000_000;
    expect(spanOf(90 * 60_000)).toBe('1h 30m');
    expect(clockLineOf({ partClock: { words: 'no clock — works until done or stopped', limitMs: null, dueMs: null }, worked: 0, now })).toBeNull();
    expect(clockLineOf({ partClock: { words: 'no clock — works until done or stopped', limitMs: null, dueMs: null }, worked: 45 * 60_000, now })).toBe('WORKED 45m · NO CLOCK');
    expect(clockLineOf({ partClock: { words: '2h of work, then wrap up', limitMs: 120 * 60_000, dueMs: null }, worked: 30 * 60_000, since: now - 12 * 60_000, now }))
      .toBe('WORKED 42m · CLOCK: 2h of work, then wrap up · 1h 18m OF WORK LEFT');
    expect(clockLineOf({ partClock: { words: 'due 2026-10-20 18:00, then stop', limitMs: null, dueMs: now + 3 * 3_600_000 }, worked: 0, now }))
      .toBe('WORKED 0m · CLOCK: due 2026-10-20 18:00, then stop · DUE IN 3h');
    expect(clockLineOf({ worked: 7_200_000, passed: { clock: '2h of work, then notify', then: 'notify' }, now }))
      .toBe('WORKED 2h · ITS CLOCK PASSED (2h of work, then notify) — YOU WERE TOLD; IT KEEPS WORKING');
  });

  it('the window: the width with the operator\'s hands, the run\'s clock, each member\'s line', () => {
    const html = render(frames([
      START,
      { type: 'operator:team_clock', id: 'run-7', stepId: 'g1', worked: 30 * 60_000, since: null, passed: null },
      { type: 'operator:team_line', id: 'run-7', stepId: 'g2', state: 'held', position: 1, of: 1 },
    ]));
    expect(html).toContain('AT ONCE');
    expect(html).toContain('1 OF 3');
    expect(html).toContain('aria-label="fewer parts at once"');
    expect(html).toContain('aria-label="more parts at once"');
    expect(html).toContain('2h of work, then wrap up');
    expect(html).toContain('SET THE RUN&#x27;S CLOCK');
    expect(html).toContain('WORKED 30m · CLOCK: 2h of work, then wrap up · 1h 30m OF WORK LEFT');
    expect(html).toContain('HELD — THE RUN WORKS 1 AT A TIME · 1 IN ITS LINE');
    expect(html.match(/SET ITS CLOCK/g)).toHaveLength(2);
    // The eye's cadence, the operator's to change while it works.
    expect(html).toContain('CHECK-INS');
    expect(html).toContain('aria-label="check-in cadence"');
    expect(html).toContain('<option value="60" selected="">EVERY 1h</option>');
  });

  it('a settled run shows what governed it, with no hands on it', () => {
    const html = render(frames([START, { type: 'operator:team_done', id: 'run-7', status: 'done', order: [] }]));
    expect(html).toContain('2h of work, then wrap up');
    expect(html).not.toContain('SET THE RUN&#x27;S CLOCK');
    expect(html).not.toContain('aria-label="more parts at once"');
    expect(html).not.toContain('SET ITS CLOCK');
  });
});

describe('the plan card says how long and how wide before the yes', () => {
  const segment = {
    kind: 'plan', phase: 'pending', id: 'p1', name: 'GAP SPRINT', goal: 'Validate the gaps.', planKind: 'team', workspace: null, detail: '',
    clock: '2h of work, then wrap up', concurrency: 2,
    steps: [{ id: 'g1', member: 'Zezebur', task: 'validate G1', needs: [] }, { id: 'g2', member: 'Kisonam', task: 'validate G2', needs: [], clock: 'no clock — works until done or stopped' }],
  };

  it('the run\'s clock and width, and a part\'s own clock', () => {
    const html = renderToStaticMarkup(createElement(PlanChip, { segment, onRespond: () => {} }));
    expect(html).toContain('CLOCK 2H OF WORK, THEN WRAP UP · 2 PARTS AT ONCE · CHECK-IN EVERY 1H');
    expect(html).toContain('ITS OWN CLOCK: no clock — works until done or stopped');
  });

  it('no clock and no width are said too — the default is never a surprise', () => {
    const html = renderToStaticMarkup(createElement(PlanChip, { segment: { ...segment, clock: 'no clock — works until done or stopped', concurrency: null }, onRespond: () => {} }));
    expect(html).toContain('CLOCK NO CLOCK — WORKS UNTIL DONE OR STOPPED · AS MANY AT ONCE AS THE RIG ALLOWS · CHECK-IN EVERY 1H');
    const quiet = renderToStaticMarkup(createElement(PlanChip, { segment: { ...segment, checkIn: 0 }, onRespond: () => {} }));
    expect(quiet).toContain('· NO CHECK-INS');
  });
});

describe('a member\'s log reads its clock acting', () => {
  it('the clock passing, the cut, and the hand-in attempt — in the order it happened', () => {
    const at = (s) => `2026-10-13T03:${s}.000Z`;
    const html = renderToStaticMarkup(createElement(LogList, {
      working: false,
      entries: [
        { at: at('00:00'), kind: 'open', how: 'brief', why: null, text: 'Your part.' },
        { at: at('59:00'), kind: 'clock', by: 'work', then: 'wrap-up', clock: '2h of work, then wrap up' },
        { at: at('59:01'), kind: 'end', outcome: 'wrap-up', why: '2h of work, then wrap up' },
        { at: at('59:02'), kind: 'open', how: 'wrap-up', why: '2h of work, then wrap up', text: 'YOUR PART CONTINUES.' },
        { at: at('59:30'), kind: 'end', outcome: 'answered', why: null },
      ],
    }));
    expect(html).toContain('CLOCK PASSED — ITS WORKING TIME RAN OUT (2h of work, then wrap up): IT WAS ASKED TO HAND IN WHAT IT HAS');
    expect(html).toContain('CUT BY ITS CLOCK — TO HAND IN WHAT IT HAS');
    expect(html).toContain('ATTEMPT 2 · HANDING IN — ITS CLOCK RAN OUT');
    const order = ['ATTEMPT 1', 'CLOCK PASSED', 'CUT BY ITS CLOCK', 'ATTEMPT 2'].map((s) => html.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
