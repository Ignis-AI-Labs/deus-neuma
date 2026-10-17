// team-runs-store.test.js — the desk's team-run store and the WORKFLOW window
// that reads it, proven with real inputs (RULE 0): the pure reducer driven by
// frames shaped exactly as the server sends them (team-run-background.js,
// team-run-live.js), then the whole window rendered for real
// (react-dom/server) over the resulting store.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { teamRunsReducer, initialTeamRuns, TEAM_RUN_FRAMES, STREAM_TAIL_CHARS } from '../../frontend/app/RelinkShell/team-runs-reducer.js';
import { TeamRunsContext, createTeamRunsStore } from '../../frontend/app/RelinkShell/team-runs-context.js';
import { workflowApp } from '../../frontend/app/RelinkShell/WorkflowApp.jsx';
import { TeamRunChip } from '../../frontend/app/RelinkShell/TeamRunChip.jsx';
import { WindowContext } from '../../frontend/app/windowing/WindowManager.jsx';

const BOARD = [
  { id: 'claim', neumaId: 'keir', member: 'Keir', state: 'waiting', status: null },
  { id: 'check', neumaId: 'signal', member: 'Signal', state: 'waiting', status: null },
];

// The frames, as the portal carries them, through the hook's own mapping.
const frames = (list) => list.reduce(
  (state, frame) => teamRunsReducer(state, { ...frame, type: TEAM_RUN_FRAMES[frame.type] }),
  initialTeamRuns,
);

const START = { type: 'operator:team_start', id: 'run-1', background: true, lead: 'Keir', laneId: 'keir', name: 'HOUSE PROOF', goal: 'Prove it.', board: BOARD };
const working = (stepId) => ({ type: 'operator:team_board', id: 'run-1', board: BOARD.map((e) => (e.id === stepId ? { ...e, state: 'working' } : e)) });

// The desk hands every window the same external store (team-runs-context.js).
const render = (state) => renderToStaticMarkup(
  createElement(TeamRunsContext.Provider, { value: createTeamRunsStore(state) }, createElement(workflowApp.Body)),
);

describe('team-runs reducer — every run the desk has seen, by id', () => {
  it('follows a run from start to done: board, live words and reasoning, the part, the outcome', () => {
    const store = frames([
      START,
      working('claim'),
      { type: 'operator:team_stream', id: 'run-1', stepId: 'claim', thought: 'weighing what proof means' },
      { type: 'operator:team_stream', id: 'run-1', stepId: 'claim', thought: '…', text: 'A member must never' },
      { type: 'operator:team_stream', id: 'run-1', stepId: 'claim', text: ' report done without proof.' },
      { type: 'operator:team_part', id: 'run-1', stepId: 'claim', output: 'A member must never report done without proof.' },
      { type: 'operator:team_done', id: 'run-1', status: 'done', order: ['claim'], record: 'run-1' },
    ]);
    const run = store.runs['run-1'];
    expect(store.order).toEqual(['run-1']);
    expect(run).toMatchObject({ lead: 'Keir', name: 'HOUSE PROOF', phase: 'settled', status: 'done', record: 'run-1' });
    expect(run.streams.claim).toEqual({ thought: 'weighing what proof means…', text: 'A member must never report done without proof.' });
    expect(run.parts.claim).toBe('A member must never report done without proof.');
  });

  it('the member\'s HANDS: tool events land per step, and the part names the session it was recorded in', () => {
    const store = frames([
      START,
      { type: 'operator:team_tool', id: 'run-1', stepId: 'claim', tool: 'fs/write', status: 'executing', summary: null },
      { type: 'operator:team_tool', id: 'run-1', stepId: 'claim', tool: 'fs/write', status: 'ok', summary: 'write — notes.md' },
      { type: 'operator:team_part', id: 'run-1', stepId: 'claim', output: 'wrote notes.md', sessionId: 'session-42' },
    ]);
    expect(store.runs['run-1'].tools.claim.map((t) => t.status)).toEqual(['executing', 'ok']);
    expect(store.runs['run-1'].sessions.claim).toBe('session-42');
    const html = render(frames([START, working('claim'), { type: 'operator:team_tool', id: 'run-1', stepId: 'claim', tool: 'fs/write', status: 'ok', summary: 'write — notes.md' }]));
    expect(html).toContain('HANDS');
    expect(html).toContain('write — notes.md');
  });

  it('the operator\'s guidance lands per member, and the panel offers the channel while the run works', () => {
    const store = frames([START, working('claim'), { type: 'operator:team_note', id: 'run-1', stepId: 'claim', note: 'Name the proof.', at: 't1' }]);
    expect(store.runs['run-1'].notes.claim).toEqual([{ note: 'Name the proof.', at: 't1' }]);
    const html = render(store);
    expect(html).toContain('YOUR GUIDANCE TO BASUNORR');
    expect(html).toContain('Name the proof.');
    expect(html).toContain('SEND — IT CONTINUES WITH THIS');
  });

  it('PICK UP WHERE IT STOPPED: interrupted/failed/stopped lead runs wait with a RESUME; a resumed start takes the run back live, parts and all', () => {
    const summaries = [
      { id: 'r-lost', lane: 'lead', lead: { name: 'Keir' }, name: 'CHAIN', status: 'lost', steps: 3, completed: 1 },
      { id: 'r-done', lane: 'lead', status: 'done', steps: 2, completed: 2 },
      { id: 'r-sse', lane: null, status: 'failed', steps: 2, completed: 1 }, // the TEAMS lane resumes itself
    ];
    let store = teamRunsReducer(initialTeamRuns, { type: 'RESUMABLE', runs: summaries });
    expect(store.resumable.map((r) => r.id)).toEqual(['r-lost']);
    const html = render(store);
    expect(html).toContain('PICK UP WHERE IT STOPPED');
    expect(html).toContain('INTERRUPTED — THE BACKEND STOPPED');
    expect(html).toContain('1 OF 3 PARTS DONE');
    expect(html).toContain('RESUME — FINISHED PARTS STAND');
    // The run had settled on this desk before; its resumed start replaces it.
    store = frames([START, { type: 'operator:team_done', id: 'run-1', status: 'error', order: [] }]);
    store = teamRunsReducer(store, { type: 'RESUMABLE', runs: [{ id: 'run-1', lane: 'lead', status: 'failed', steps: 2, completed: 1 }] });
    store = teamRunsReducer(store, { ...START, type: 'START', resumed: true, parts: { claim: 'the part from before' } });
    expect(store.runs['run-1']).toMatchObject({ phase: 'live', parts: { claim: 'the part from before' } });
    expect(store.resumable).toEqual([]);
  });

  it('a stop reads STOPPED, with what failed and what never started', () => {
    const store = frames([START, { type: 'operator:team_done', id: 'run-1', status: 'error', stopped: true, order: [], failures: { claim: 'the operator stopped the run' }, skipped: ['check'] }]);
    expect(store.runs['run-1']).toMatchObject({ status: 'stopped', failures: { claim: 'the operator stopped the run' }, skipped: ['check'] });
  });

  it('a live tail is capped like the server\'s — the newest words are kept', () => {
    const big = 'x'.repeat(STREAM_TAIL_CHARS);
    const store = frames([START, { type: 'operator:team_stream', id: 'run-1', stepId: 'claim', text: big }, { type: 'operator:team_stream', id: 'run-1', stepId: 'claim', text: 'END' }]);
    const text = store.runs['run-1'].streams.claim.text;
    expect(text.length).toBe(STREAM_TAIL_CHARS);
    expect(text.endsWith('END')).toBe(true);
  });

  it('SEED adds the server\'s live runs whole, and never clobbers a run this desk already follows', () => {
    const followed = frames([START, working('claim')]);
    const seeded = teamRunsReducer(followed, {
      type: 'SEED',
      runs: [
        { id: 'run-1', name: 'STALE COPY', board: BOARD },
        { id: 'run-2', name: 'BEFORE THE RELOAD', lead: 'Galen', board: BOARD, streams: { claim: { text: 'so far', thought: '' } }, parts: {} },
      ],
    });
    expect(seeded.runs['run-1'].name).toBe('HOUSE PROOF');
    expect(seeded.runs['run-1'].board[0].state).toBe('working');
    expect(seeded.runs['run-2']).toMatchObject({ name: 'BEFORE THE RELOAD', phase: 'live', streams: { claim: { text: 'so far' } } });
  });

  it('a run the server no longer lists is not working: it settles LOST, then takes the record\'s own ending — RESUME offered', () => {
    const followed = frames([{ ...START, seenAt: 100 }, working('claim')]);
    // A run this desk learned of AFTER the list was asked is newer than it.
    const fresh = teamRunsReducer(followed, { ...START, id: 'run-2', type: 'START', seenAt: 300 });
    let store = teamRunsReducer(fresh, { type: 'SEED', runs: [], asOf: 200 });
    expect(store.runs['run-1']).toMatchObject({ phase: 'settled', status: 'lost' });
    expect(store.runs['run-2'].phase).toBe('live');
    store = teamRunsReducer(store, { type: 'RESUMABLE', runs: [{ id: 'run-1', lane: 'lead', status: 'lost', steps: 2, completed: 0 }] });
    expect(store.resumable.map((r) => r.id)).toEqual(['run-1']);
    const html = render(store);
    expect(html).toContain('RUN INTERRUPTED');
    // Its end was only missed: the record says how it really ended.
    const ended = teamRunsReducer(store, { type: 'RESUMABLE', runs: [{ id: 'run-1', lane: 'lead', status: 'done', steps: 2, completed: 2 }] });
    expect(ended.runs['run-1'].status).toBe('done');
    expect(ended.resumable).toEqual([]);
  });

  it('a run this desk holds as settled that the server lists as working was picked up elsewhere — the list wins', () => {
    const settled = frames([START, { type: 'operator:team_done', id: 'run-1', status: 'error', stopped: true, order: [] }]);
    const revived = teamRunsReducer(settled, { type: 'SEED', runs: [{ id: 'run-1', name: 'HOUSE PROOF', board: BOARD, parts: { claim: 'kept' } }], asOf: 5 });
    expect(revived.runs['run-1']).toMatchObject({ phase: 'live', status: null, parts: { claim: 'kept' } });
  });

  it('a resumed start carries the operator\'s notes — the guidance stays on every desk', () => {
    const store = frames([
      START,
      { type: 'operator:team_done', id: 'run-1', status: 'error', stopped: true, order: [] },
      { ...START, resumed: true, parts: {}, notes: { check: [{ note: 'Keep it short.', at: 't0' }] } },
    ]);
    expect(store.runs['run-1'].notes.check).toEqual([{ note: 'Keep it short.', at: 't0' }]);
  });

  it('a frame for an unknown run is a no-op, never a crash', () => {
    const store = frames([START]);
    expect(teamRunsReducer(store, { type: 'BOARD', id: 'ghost', board: [] })).toBe(store);
    expect(teamRunsReducer(store, { type: 'NOT_A_THING' })).toBe(store);
  });
});

describe('the WORKFLOW window over the store, rendered for real', () => {
  it('empty: says what will appear', () => {
    expect(render(initialTeamRuns)).toContain('NO TEAM AT WORK YET');
  });

  it('a working member opens by itself: its reasoning and its words, with STOP beside it and STOP THE RUN above', () => {
    const html = render(frames([
      START,
      working('claim'),
      { type: 'operator:team_stream', id: 'run-1', stepId: 'claim', thought: 'weighing proof', text: 'A member must' },
    ]));
    expect(html).toContain('TEAM AT WORK');
    expect(html).toContain('LED BY BASUNORR');
    expect(html).toContain('STOP THE RUN');
    expect(html).toContain('THINKING');
    expect(html).toContain('weighing proof');
    expect(html).toContain('WRITING');
    expect(html).toContain('A member must');
    expect(html).toContain('>STOP<'); // the member's own stop
  });

  it('several runs: a picker, working runs first; a settled run shows no stop controls', () => {
    const store = frames([
      START,
      { type: 'operator:team_done', id: 'run-1', status: 'done', order: ['claim', 'check'] },
      { ...START, id: 'run-2', name: 'SECOND CREW', lead: 'Galen' },
    ]);
    const html = render(store);
    expect(html).toContain('SECOND CREW · Galen · AT WORK');
    expect(html).toContain('HOUSE PROOF · Keir · TEAM FINISHED');
    expect(html.indexOf('SECOND CREW · Galen')).toBeLessThan(html.indexOf('HOUSE PROOF · Keir'));
    const settledOnly = render(frames([START, { type: 'operator:team_done', id: 'run-1', status: 'done', order: [] }]));
    expect(settledOnly).toContain('TEAM FINISHED');
    expect(settledOnly).not.toContain('STOP THE RUN');
  });

  it('a settled run says why a member never started, and that a member was interrupted — never "waiting on its turn"', () => {
    const stopped = render(frames([
      START,
      working('claim'),
      { type: 'operator:team_done', id: 'run-1', status: 'error', order: [], failures: { claim: 'the operator stopped this member' }, skipped: ['check'] },
    ]));
    expect(stopped).toContain('FAILED — the operator stopped this member');
    expect(stopped).not.toContain('WAITING ON ITS TURN');
    // The skipped member is closed by default; its hint is honest once opened —
    // the same row, rendered as a settled run it never began in.
    const lost = teamRunsReducer(frames([{ ...START, seenAt: 1 }, working('claim')]), { type: 'SEED', runs: [], asOf: 2 });
    const html = render(lost);
    expect(html).toContain('RUN INTERRUPTED');
    expect(html).toContain('INTERRUPTED');
    expect(html).toContain('INTERRUPTED BEFORE IT ANSWERED.');
    expect(html).not.toContain('>STOP<');
  });

  it('the store re-renders readers only on change, and a chat\'s stale team chip reads the run as the desk knows it', () => {
    const store = createTeamRunsStore(frames([START]));
    let calls = 0;
    store.subscribe(() => { calls += 1; });
    store.dispatch({ type: 'BOARD', id: 'ghost', board: [] }); // no change, no render
    expect(calls).toBe(0);
    store.dispatch({ type: 'DONE', id: 'run-1', status: 'done', order: ['claim', 'check'] });
    expect(calls).toBe(1);
    // The chip in the chat never heard the end (its backend restarted, or the
    // chat was not listening) — the desk did.
    const segment = { kind: 'teamrun', phase: 'pending', id: 'run-1', name: 'HOUSE PROOF', goal: 'Prove it.', board: BOARD, status: null, detail: '', background: true };
    const chip = renderToStaticMarkup(createElement(WindowContext.Provider, { value: { registry: {}, state: { windows: [], focusedId: null }, dispatch: () => {} } },
      createElement(TeamRunsContext.Provider, { value: store }, createElement(TeamRunChip, { segment }))));
    expect(chip).toContain('HOUSE PROOF — TEAM FINISHED');
    expect(chip).not.toContain('TEAM AT WORK');
  });
});
