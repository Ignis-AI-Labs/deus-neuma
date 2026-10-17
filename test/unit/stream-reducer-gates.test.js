// stream-reducer-gates.test.js — the witness gates: approval, ask, plan,
// and team-run segments. Split from stream-reducer.test.js (SIZE-033);
// bodies byte-identical.

import { describe, expect, test } from 'vitest';
import {
  reducer,
} from '../../frontend/app/RelinkShell/stream-reducer.js';
import { run, streamingMsg } from '../helpers/stream-reducer-kit.js';

describe('approval segments — the witness gate', () => {
  const open = [
    { type: 'USER_SENT', text: 'organize my files' },
    { type: 'SPEECH', text: 'Reaching for the tree…' },
    { type: 'APPROVAL_REQUEST', id: 'req-1', tool: 'filesystem/directory_tree', args: '{\n  "path": "."\n}' },
  ];

  test('APPROVAL_REQUEST appends a pending approval segment to the live message', () => {
    const state = run(open);
    const msg = streamingMsg(state);
    const seg = msg.segments.find((s) => s.kind === 'approval');
    expect(seg).toMatchObject({
      phase: 'pending', id: 'req-1', tool: 'filesystem/directory_tree', decision: null,
    });
    expect(seg.args).toContain('"path"');
    expect(state.thinking).toBe(false);
  });

  test('APPROVAL_RESOLVED settles the matching pending segment', () => {
    const state = run([...open, { type: 'APPROVAL_RESOLVED', id: 'req-1', decision: 'allow' }]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'approval');
    expect(seg).toMatchObject({ phase: 'resolved', decision: 'allow' });
  });

  test('APPROVAL_RESOLVED carries an ALWAYS grant through unchanged', () => {
    const state = run([...open, { type: 'APPROVAL_RESOLVED', id: 'req-1', decision: 'always' }]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'approval');
    expect(seg).toMatchObject({ phase: 'resolved', decision: 'always' });
  });

  test('APPROVAL_RESOLVED for an unknown id is a no-op', () => {
    const before = run(open);
    const after = reducer(before, { type: 'APPROVAL_RESOLVED', id: 'ghost', decision: 'deny' });
    const seg = streamingMsg(after).segments.find((s) => s.kind === 'approval');
    expect(seg.phase).toBe('pending');
  });

  test('a stray APPROVAL_RESOLVED with no live message never mints one', () => {
    const idle = run([{ type: 'USER_SENT', text: 'hi' }]);
    const after = reducer(idle, { type: 'APPROVAL_RESOLVED', id: 'req-1', decision: 'deny' });
    expect(after).toBe(idle);
  });

  test('COMPLETE expires a still-pending approval so no dead buttons remain', () => {
    const state = run([...open, { type: 'COMPLETE', metadata: null }]);
    const msg = state.messages.find((m) => m.role === 'neuma');
    const seg = msg.segments.find((s) => s.kind === 'approval');
    expect(seg).toMatchObject({ phase: 'resolved', decision: 'expired' });
    expect(msg.streaming).toBe(false);
  });

  test('two pending approvals resolve independently by id', () => {
    const state = run([
      ...open,
      { type: 'APPROVAL_REQUEST', id: 'req-2', tool: 'filesystem/read_multiple_files', args: '' },
      { type: 'APPROVAL_RESOLVED', id: 'req-2', decision: 'deny' },
    ]);
    const segs = streamingMsg(state).segments.filter((s) => s.kind === 'approval');
    expect(segs.find((s) => s.id === 'req-1').phase).toBe('pending');
    expect(segs.find((s) => s.id === 'req-2')).toMatchObject({ phase: 'resolved', decision: 'deny' });
  });
});

describe('ask segments — a being\'s question to its witness', () => {
  const open = [
    { type: 'USER_SENT', text: 'plan the build' },
    { type: 'SPEECH', text: 'Before I plan, one thing —' },
    { type: 'ASK_REQUEST', id: 'ask-1', question: 'MVP first or full plan first?', options: ['MVP first', 'Full plan'] },
  ];

  test('ASK_REQUEST appends a pending ask segment with the question and choices', () => {
    const state = run(open);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'ask');
    expect(seg).toMatchObject({
      phase: 'pending', id: 'ask-1', question: 'MVP first or full plan first?', status: null, answer: '',
    });
    expect(seg.options).toEqual(['MVP first', 'Full plan']);
    expect(state.thinking).toBe(false);
  });

  test('ASK_REQUEST with no options carries an empty list, never undefined', () => {
    const state = run([
      { type: 'USER_SENT', text: 'go' },
      { type: 'ASK_REQUEST', id: 'ask-x', question: 'free text only?' },
    ]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'ask');
    expect(seg.options).toEqual([]);
  });

  test('a SEQUENCED ask keeps each question with its OWN options', () => {
    // Design note, 2026-07-27: five settings used to arrive as one question with every
    // option in one row. Each question must reach the card intact.
    const state = run([
      { type: 'USER_SENT', text: 'research the tooling' },
      {
        type: 'ASK_REQUEST',
        id: 'ask-seq',
        questions: [
          { question: 'How deep?', header: 'Budget', multiSelect: false, options: [{ label: 'Deep', description: 'a full day' }] },
          { question: 'How many roles?', header: 'Team', multiSelect: false, options: [{ label: '2-3 roles', description: '' }] },
        ],
      },
    ]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'ask');
    expect(seg.questions).toHaveLength(2);
    expect(seg.questions[0].header).toBe('Budget');
    expect(seg.questions[0].options[0]).toEqual({ label: 'Deep', description: 'a full day' });
    expect(seg.questions[1].options.map((o) => o.label)).toEqual(['2-3 roles']);
  });

  test('a LEGACY single-question frame is lifted into the same shape', () => {
    // One card renderer, one shape — an older frame must not need a branch.
    const seg = streamingMsg(run(open)).segments.find((s) => s.kind === 'ask');
    expect(seg.questions).toHaveLength(1);
    expect(seg.questions[0].question).toBe('MVP first or full plan first?');
    expect(seg.questions[0].options).toEqual([
      { label: 'MVP first', description: '' }, { label: 'Full plan', description: '' },
    ]);
  });

  test('ASK_RESOLVED collapses the card to the witness\'s actual words', () => {
    const state = run([...open, { type: 'ASK_RESOLVED', id: 'ask-1', status: 'answered', answer: 'MVP first' }]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'ask');
    expect(seg).toMatchObject({ phase: 'resolved', status: 'answered', answer: 'MVP first' });
  });

  test('ASK_RESOLVED unanswered (timeout) settles with no fabricated answer', () => {
    const state = run([...open, { type: 'ASK_RESOLVED', id: 'ask-1', status: 'timeout' }]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'ask');
    expect(seg).toMatchObject({ phase: 'resolved', status: 'timeout', answer: '' });
  });

  test('ASK_RESOLVED for an unknown id is a no-op', () => {
    const before = run(open);
    const after = reducer(before, { type: 'ASK_RESOLVED', id: 'ghost', status: 'answered', answer: 'x' });
    const seg = streamingMsg(after).segments.find((s) => s.kind === 'ask');
    expect(seg.phase).toBe('pending');
  });

  test('a stray ASK_RESOLVED with no live message never mints one', () => {
    const idle = run([{ type: 'USER_SENT', text: 'hi' }]);
    const after = reducer(idle, { type: 'ASK_RESOLVED', id: 'ask-1', status: 'answered', answer: 'x' });
    expect(after).toBe(idle);
  });

  test('COMPLETE expires a still-pending ask so no dead inputs remain', () => {
    const state = run([...open, { type: 'COMPLETE', metadata: null }]);
    const msg = state.messages.find((m) => m.role === 'neuma');
    const seg = msg.segments.find((s) => s.kind === 'ask');
    expect(seg).toMatchObject({ phase: 'resolved', status: 'expired', answer: '' });
    expect(msg.streaming).toBe(false);
  });
});

describe('plan segments — a being\'s team plan before its witness', () => {
  const STEPS = [
    { id: 'build', member: 'Aethon', task: 'Build it', needs: [] },
    { id: 'check', member: 'Boreas', task: 'Check it', needs: ['build'], done: 'All green' },
  ];
  const open = [
    { type: 'USER_SENT', text: 'plan the work' },
    { type: 'SPEECH', text: 'Here is the plan —' },
    { type: 'PLAN_REQUEST', id: 'plan-1', name: 'CREW', goal: 'Ship the thing', steps: STEPS },
  ];

  test('PLAN_REQUEST appends a pending plan segment with goal and steps', () => {
    const state = run(open);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'plan');
    expect(seg).toMatchObject({
      phase: 'pending', id: 'plan-1', name: 'CREW', goal: 'Ship the thing', status: null, notes: '',
    });
    expect(seg.steps).toEqual(STEPS);
    expect(state.thinking).toBe(false);
  });

  test('PLAN_RESOLVED approve collapses the card to the verdict', () => {
    const state = run([...open, { type: 'PLAN_RESOLVED', id: 'plan-1', status: 'approve' }]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'plan');
    expect(seg).toMatchObject({ phase: 'resolved', status: 'approve', notes: '' });
  });

  test('PLAN_RESOLVED revise carries the witness\'s notes', () => {
    const state = run([...open, { type: 'PLAN_RESOLVED', id: 'plan-1', status: 'revise', notes: 'Split step two.' }]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'plan');
    expect(seg).toMatchObject({ phase: 'resolved', status: 'revise', notes: 'Split step two.' });
  });

  test('PLAN_RESOLVED for an unknown id is a no-op; a stray one mints nothing', () => {
    const before = run(open);
    const after = reducer(before, { type: 'PLAN_RESOLVED', id: 'ghost', status: 'approve' });
    expect(streamingMsg(after).segments.find((s) => s.kind === 'plan').phase).toBe('pending');

    const idle = run([{ type: 'USER_SENT', text: 'hi' }]);
    expect(reducer(idle, { type: 'PLAN_RESOLVED', id: 'plan-1', status: 'approve' })).toBe(idle);
  });

  test('COMPLETE expires a still-pending plan so no dead verdict buttons remain', () => {
    const state = run([...open, { type: 'COMPLETE', metadata: null }]);
    const msg = state.messages.find((m) => m.role === 'neuma');
    const seg = msg.segments.find((s) => s.kind === 'plan');
    expect(seg).toMatchObject({ phase: 'resolved', status: 'expired', notes: '' });
    expect(msg.streaming).toBe(false);
  });
});

describe('teamrun segments — the LEAD\'s team working live', () => {
  const BOARD_0 = [
    { id: 'build', member: 'Aethon', role: 'HELM', state: 'waiting', status: null },
    { id: 'check', member: 'Boreas', role: null, state: 'waiting', status: null },
  ];
  const open = [
    { type: 'USER_SENT', text: 'run it' },
    { type: 'SPEECH', text: 'Putting the team to work —' },
    { type: 'TEAMRUN_START', id: 'run-1', name: 'CREW', goal: 'Ship it', board: BOARD_0 },
  ];

  test('TEAMRUN_START appends a pending live board', () => {
    const state = run(open);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'teamrun');
    expect(seg).toMatchObject({ phase: 'pending', id: 'run-1', name: 'CREW', goal: 'Ship it', status: null });
    expect(seg.board).toEqual(BOARD_0);
  });

  test('TEAMRUN_BOARD updates the board in place while pending', () => {
    const moved = [
      { ...BOARD_0[0], state: 'done', status: 'built it' },
      { ...BOARD_0[1], state: 'working' },
    ];
    const state = run([...open, { type: 'TEAMRUN_BOARD', id: 'run-1', board: moved }]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'teamrun');
    expect(seg.phase).toBe('pending');
    expect(seg.board[0]).toMatchObject({ state: 'done', status: 'built it' });
    expect(seg.board[1].state).toBe('working');
  });

  test('TEAMRUN_DONE settles to the outcome with the step count', () => {
    const state = run([...open, { type: 'TEAMRUN_DONE', id: 'run-1', status: 'done', order: ['build', 'check'] }]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'teamrun');
    expect(seg).toMatchObject({ phase: 'resolved', status: 'done', detail: '2 steps' });
  });

  test('TEAMRUN_TORCH appends each baton pass to the live segment for the WORKFLOW window', () => {
    const state = run([
      ...open,
      { type: 'TEAMRUN_TORCH', id: 'run-1', stepId: 'build', member: 'Signal', torch: 'physics core done, wall data next' },
      { type: 'TEAMRUN_TORCH', id: 'run-1', stepId: 'check', member: 'Galen', torch: 'render loop verified' },
    ]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'teamrun');
    expect(seg.torches).toEqual([
      { stepId: 'build', member: 'Signal', torch: 'physics core done, wall data next' },
      { stepId: 'check', member: 'Galen', torch: 'render loop verified' },
    ]);
    // a torch for an unknown run is a no-op, never a crash
    const stray = reducer(state, { type: 'TEAMRUN_TORCH', id: 'ghost', stepId: 'x', member: 'Y', torch: 'z' });
    expect(streamingMsg(stray).segments.find((s) => s.kind === 'teamrun').torches).toHaveLength(2);
  });

  test('TEAMRUN_DONE carries the delivery handle and the record id so the chip can open both', () => {
    const delivery = { id: 'run-1', root: '/tmp/arena-x' };
    const state = run([...open, { type: 'TEAMRUN_DONE', id: 'run-1', status: 'done', order: ['build'], delivery, record: '2026-07-15T10-00-00-000Z' }]);
    const seg = streamingMsg(state).segments.find((s) => s.kind === 'teamrun');
    expect(seg.delivery).toEqual(delivery);
    expect(seg.record).toBe('2026-07-15T10-00-00-000Z');
    // a run with no workspace and no persisted record honestly carries neither
    const bare = run([...open, { type: 'TEAMRUN_DONE', id: 'run-1', status: 'done', order: ['build'] }]);
    const bareSeg = streamingMsg(bare).segments.find((s) => s.kind === 'teamrun');
    expect(bareSeg.delivery).toBe(null);
    expect(bareSeg.record).toBe(null);
  });

  test('TEAMRUN_DONE error settles as failure; unknown ids are a no-op', () => {
    const failed = run([...open, { type: 'TEAMRUN_DONE', id: 'run-1', status: 'error' }]);
    expect(streamingMsg(failed).segments.find((s) => s.kind === 'teamrun'))
      .toMatchObject({ phase: 'resolved', status: 'error', detail: '' });

    // A partial run names what failed and what never started — and keeps
    // its record, now written on failure too.
    const partial = run([...open, {
      type: 'TEAMRUN_DONE', id: 'run-1', status: 'error', order: ['build'],
      failures: { check: 'no reply' }, skipped: ['ship'], record: '2026-10-10T06-00-00-000Z',
    }]);
    expect(streamingMsg(partial).segments.find((s) => s.kind === 'teamrun'))
      .toMatchObject({ status: 'error', detail: '1 done, 1 failed, 1 never started', record: '2026-10-10T06-00-00-000Z' });

    const before = run(open);
    const after = reducer(before, { type: 'TEAMRUN_DONE', id: 'ghost', status: 'done', order: [] });
    expect(streamingMsg(after).segments.find((s) => s.kind === 'teamrun').phase).toBe('pending');
  });

  test('a BACKGROUND run outlives the lead\'s turn: COMPLETE leaves it live, and its frames still land', () => {
    const background = [
      ...open.slice(0, 2),
      { type: 'TEAMRUN_START', id: 'run-bg', name: 'CREW', goal: 'Ship it', board: BOARD_0, background: true },
      { type: 'COMPLETE', metadata: null },
    ];
    const settledTurn = run(background);
    const seg = () => (st) => st.messages.find((m) => m.role === 'neuma').segments.find((s) => s.kind === 'teamrun');
    expect(seg()(settledTurn)).toMatchObject({ phase: 'pending', background: true });
    // The turn is over — the board, torch and done frames still find the chip.
    const moved = reducer(settledTurn, { type: 'TEAMRUN_BOARD', id: 'run-bg', board: [{ ...BOARD_0[0], state: 'working' }, BOARD_0[1]] });
    expect(seg()(moved).board[0].state).toBe('working');
    const torched = reducer(moved, { type: 'TEAMRUN_TORCH', id: 'run-bg', stepId: 'build', member: 'Aethon', torch: 'half built' });
    expect(seg()(torched).torches).toHaveLength(1);
    const stopped = reducer(torched, { type: 'TEAMRUN_DONE', id: 'run-bg', status: 'error', stopped: true, order: [], failures: { build: 'the operator stopped the run' }, skipped: ['check'] });
    expect(seg()(stopped)).toMatchObject({ phase: 'resolved', status: 'stopped', detail: '0 done, 1 failed, 1 never started' });
  });

  test('a run that starts with no turn speaking (the operator\'s RESUME) gets its own message — never one left streaming', () => {
    const idle = run([{ type: 'USER_SENT', text: 'hello' }, { type: 'SPEECH', text: 'hi' }, { type: 'COMPLETE', metadata: null }]);
    const resumed = reducer(idle, { type: 'TEAMRUN_START', id: 'run-r', name: 'CREW', goal: 'Ship it', board: BOARD_0, background: true });
    expect(resumed.messages.some((m) => m.streaming)).toBe(false);
    const holder = resumed.messages.at(-1);
    expect(holder).toMatchObject({ role: 'neuma', streaming: false });
    expect(holder.segments).toEqual([expect.objectContaining({ kind: 'teamrun', phase: 'pending', id: 'run-r' })]);
    // Its frames still find the chip, and the being's next reply streams
    // below it, never into it.
    const moved = reducer(resumed, { type: 'TEAMRUN_BOARD', id: 'run-r', board: [{ ...BOARD_0[0], state: 'working' }, BOARD_0[1]] });
    expect(moved.messages.at(-1).segments[0].board[0].state).toBe('working');
    const replied = run([{ type: 'USER_SENT', text: 'still there?' }, { type: 'SPEECH', text: 'yes' }], moved);
    expect(replied.messages.at(-3).segments[0].kind).toBe('teamrun');
    expect(replied.messages.at(-1).segments.some((s) => s.kind === 'teamrun')).toBe(false);
  });

  test('COMPLETE expires a still-pending run board honestly', () => {
    const state = run([...open, { type: 'COMPLETE', metadata: null }]);
    const seg = state.messages.find((m) => m.role === 'neuma').segments.find((s) => s.kind === 'teamrun');
    expect(seg).toMatchObject({ phase: 'resolved', status: 'expired' });
  });
});

