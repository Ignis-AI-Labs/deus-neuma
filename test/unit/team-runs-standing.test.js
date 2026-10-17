// team-runs-standing.test.js — where each working member STANDS, and its whole
// LOG (2026-10-12): the store follows the line and retry frames exactly as
// the server sends them (team-run-live.js markStepLine / markStepRetry), the
// WORKFLOW window says which members are waiting their turn for the model and
// which the run is about to continue, an act that went wrong says why, and a
// member's log renders in the order it happened. Real inputs, real render
// (react-dom/server) — RULE 0.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { teamRunsReducer, initialTeamRuns, TEAM_RUN_FRAMES } from '../../frontend/app/RelinkShell/team-runs-reducer.js';
import { TeamRunsContext, createTeamRunsStore } from '../../frontend/app/RelinkShell/team-runs-context.js';
import { workflowApp } from '../../frontend/app/RelinkShell/WorkflowApp.jsx';
import { standingOf } from '../../frontend/app/RelinkShell/WorkflowMember.jsx';
import { LogList } from '../../frontend/app/RelinkShell/WorkflowMemberLog.jsx';

const BOARD = [
  { id: 'v1', neumaId: 'zezebur', member: 'Zezebur', state: 'working', status: null },
  { id: 'v2', neumaId: 'kisonam', member: 'Kisonam', state: 'working', status: null },
];
const START = { type: 'operator:team_start', id: 'run-9', background: true, lead: 'Zezebur', laneId: 'zezebur', name: 'GAP SPRINT', goal: 'Validate the gaps.', board: BOARD };
const frames = (list) => list.reduce((state, f) => teamRunsReducer(state, { ...f, type: TEAM_RUN_FRAMES[f.type] }), initialTeamRuns);
const render = (state) => renderToStaticMarkup(
  createElement(TeamRunsContext.Provider, { value: createTeamRunsStore(state) }, createElement(workflowApp.Body)),
);

describe('the store follows each member\'s standing', () => {
  it('a place in line is held until the member works again; a retry until it acts; a settled run holds neither', () => {
    const waiting = frames([START, { type: 'operator:team_line', id: 'run-9', stepId: 'v1', state: 'waiting', position: 2, ahead: ['Keir', 'Kisonam (team)'] }]);
    expect(waiting.runs['run-9'].lines.v1).toEqual({ state: 'waiting', position: 2, ahead: ['Keir', 'Kisonam (team)'] });

    const retry = { type: 'operator:team_retry', id: 'run-9', stepId: 'v1', kind: 'failed', why: 'the answer stream ended early', inMs: 60000, at: 't1' };
    const stopped = frames([START, retry]);
    expect(stopped.runs['run-9'].retries.v1).toEqual({ kind: 'failed', why: 'the answer stream ended early', inMs: 60000, at: 't1' });
    // The member works again — its next words clear the retry.
    const again = frames([START, retry, { type: 'operator:team_stream', id: 'run-9', stepId: 'v1', thought: 'picking up' }]);
    expect(again.runs['run-9'].retries).toEqual({});
    const settled = frames([START, retry, { type: 'operator:team_done', id: 'run-9', status: 'done', order: [] }]);
    expect(settled.runs['run-9'].retries).toEqual({});
    expect(settled.runs['run-9'].lines).toEqual({});
  });

  it('an act keeps why it went wrong', () => {
    const store = frames([START, { type: 'operator:team_tool', id: 'run-9', stepId: 'v1', tool: 'web/web_fetch', status: 'error', summary: 'web_fetch — failed', detail: 'HTTP 403 from www.reddit.com' }]);
    expect(store.runs['run-9'].tools.v1).toEqual([{ tool: 'web/web_fetch', status: 'error', summary: 'web_fetch — failed', detail: 'HTTP 403 from www.reddit.com' }]);
  });
});

describe('the WORKFLOW window says where each member stands', () => {
  it('waiting its turn, stopped short and about to be continued, sent back to finish — or nothing when it simply works', () => {
    expect(standingOf({ state: 'waiting', position: 2, ahead: ['Keir'] }, null)).toBe('WAITING ITS TURN FOR THE MODEL (2 IN LINE) — BEHIND Keir');
    expect(standingOf(null, { kind: 'failed', why: 'the answer stream ended early', inMs: 60000 }))
      .toBe('STOPPED SHORT — the answer stream ended early. THE RUN CONTINUES IT IN 60s, WHERE IT STOPPED.');
    expect(standingOf(null, { kind: 'unfinished', why: 'it carried no work product — only a sign-off' }))
      .toBe('SENT BACK TO FINISH — it carried no work product — only a sign-off');
    expect(standingOf({ state: 'running' }, null)).toBeNull();
  });

  it('a live run shows the standing, the act\'s reason, and OPEN LOG on every member that has begun', () => {
    const html = render(frames([
      START,
      { type: 'operator:team_line', id: 'run-9', stepId: 'v2', state: 'waiting', position: 1, ahead: ['Zezebur (team)'] },
      { type: 'operator:team_tool', id: 'run-9', stepId: 'v1', tool: 'web/web_fetch', status: 'error', summary: 'web_fetch — failed', detail: 'HTTP 403 from www.reddit.com' },
    ]));
    expect(html).toContain('WAITING ITS TURN FOR THE MODEL (1 IN LINE) — BEHIND Zezebur (team)');
    expect(html).toContain('web_fetch — failed');
    expect(html).toContain(' — HTTP 403 from www.reddit.com');
    expect(html.match(/OPEN LOG/g)).toHaveLength(2);
  });
});

describe('the TEAM CHANNEL — what the team tells each other, on the operator\'s desk', () => {
  const post = (n, from, to, text) => ({ type: 'operator:team_message', id: 'run-9', n, at: `2026-10-12T16:0${n}:00.000Z`, from, fromStep: null, to, toStep: null, text });

  it('posts land once, in order — a frame heard twice is one post', () => {
    const store = frames([START, post(1, 'Zezebur (v1)', 'Kisonam', 'The offer is $499 flat.'), post(1, 'Zezebur (v1)', 'Kisonam', 'The offer is $499 flat.'), post(2, 'your operator', 'everyone', 'Datadog first.')]);
    expect(store.runs['run-9'].channel.map((m) => [m.n, m.from, m.to])).toEqual([[1, 'Zezebur (v1)', 'Kisonam'], [2, 'your operator', 'everyone']]);
  });

  it('the window shows who told whom what — the operator\'s own posts as YOU — and offers the operator\'s word while the team works', () => {
    const html = render(frames([START, post(1, 'Zezebur (v1)', 'Kisonam', 'The offer is $499 flat.'), post(2, 'your operator', 'everyone', 'Datadog first.')]));
    expect(html).toContain('TEAM CHANNEL — WHAT THEY TELL EACH OTHER');
    expect(html).toContain('Zezebur (v1) → KISONAM');
    expect(html).toContain('The offer is $499 flat.');
    expect(html).toContain('YOU → EVERYONE');
    expect(html).toContain('POST TO THE TEAM');
    expect(html).toContain('TO KISONAM (v2)');
  });
});

describe('a member\'s whole log reads in the order it happened', () => {
  const at = (s) => `2026-10-12T15:${s}.000Z`;
  const LOG = [
    { at: at('09:10'), kind: 'open', how: 'brief', why: null, text: 'Your part: validate G2.' },
    { at: at('09:12'), kind: 'line', state: 'waiting', position: 2, ahead: ['Keir'] },
    { at: at('09:20'), kind: 'line', state: 'running' },
    { at: at('09:21'), kind: 'thought', text: 'Let me search the threads ' },
    { at: at('09:23'), kind: 'thought', text: 'where buyers complain.' },
    { at: at('09:24'), kind: 'act', tool: 'web/web_search', status: 'ok', summary: '"too expensive" — 10 results', detail: null, sources: [{ title: 'A thread', url: 'https://example.org/t/1' }] },
    { at: at('09:30'), kind: 'act', tool: 'web/web_fetch', status: 'error', summary: 'web_fetch — failed', detail: 'HTTP 403', sources: null },
    { at: at('09:31'), kind: 'end', outcome: 'failed', why: 'the answer stream ended early' },
    { at: at('09:31'), kind: 'retry', inMs: 10000, why: 'the answer stream ended early' },
    { at: at('09:42'), kind: 'open', how: 'failed', why: 'the answer stream ended early', text: 'YOUR PART CONTINUES.' },
    { at: at('09:50'), kind: 'words', text: 'Ten buyers, ' },
    { at: at('09:51'), kind: 'words', text: 'in their own words.' },
    { at: at('09:52'), kind: 'end', outcome: 'answered', why: null },
  ];

  it('attempts are numbered, reasoning and words read as blocks, acts carry what came back and why they failed', () => {
    const html = renderToStaticMarkup(createElement(LogList, { entries: LOG, working: false }));
    expect(html).toContain('ATTEMPT 1 · BRIEFED');
    expect(html).toContain('ATTEMPT 2 · CONTINUED — IT HAD STOPPED SHORT');
    expect(html).toContain('WAITING ITS TURN FOR THE MODEL — 2 IN LINE (BEHIND Keir)');
    expect(html).toContain('Let me search the threads where buyers complain.');
    expect(html).toContain('href="https://example.org/t/1"');
    expect(html).toContain('WHY');
    expect(html).toContain('HTTP 403');
    expect(html).toContain('THE RUN WILL CONTINUE IT IN 10s — the answer stream ended early');
    expect(html).toContain('Ten buyers, in their own words.');
    expect(html).toContain('ANSWERED');
    // In the order it happened.
    const order = ['ATTEMPT 1', 'THINKING', 'web/web_search', 'web/web_fetch', 'STOPPED SHORT', 'ATTEMPT 2', 'Ten buyers'].map((s) => html.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
