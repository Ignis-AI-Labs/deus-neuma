import { expect, test } from 'vitest';
import { streamCardAction } from '../../frontend/app/RelinkShell/stream-card-actions.js';
import { run, streamingMsg } from '../helpers/stream-reducer-kit.js';

test('approval frames retain lane and media, resolve only their matching real reducer card', () => {
  const media = Object.freeze([{ path: '/tmp/preview.png' }]);
  const request = Object.freeze({ id: 'a', tool: 'read_file', args: '{}', scope: 'once', media });
  const first = streamCardAction('tool:approval_request', request, 'witness-a');
  expect(first.sound).toBe('confirm');
  expect(first.action).toMatchObject({ lane: 'witness-a', media, scope: 'once' });
  const second = streamCardAction('tool:approval_request', { ...request, id: 'b' }, 'witness-b');
  const settled = streamCardAction('tool:approval_resolved', { id: 'a', decision: 'always' });
  const state = run([{ type: 'USER_SENT', text: 'Review files' }, first.action, second.action, settled.action]);
  const cards = streamingMsg(state).segments.filter((segment) => segment.kind === 'approval');
  expect(cards.find((card) => card.id === 'a')).toMatchObject({ phase: 'resolved', decision: 'always' });
  expect(cards.find((card) => card.id === 'b')).toMatchObject({ phase: 'pending' });
  expect(settled.sound).toBeNull();
  expect(request).toEqual({ id: 'a', tool: 'read_file', args: '{}', scope: 'once', media });
});

test('council requests produce neither a duplicate card nor a confirmation cue', () => {
  expect(streamCardAction('tool:approval_request', { surface: 'council' })).toBeNull();
  expect(streamCardAction('tool:approval_request', { id: 'a' }).action).toMatchObject({ media: [], lane: null });
});

test('plan defaults preserve chat intent without accepting non-string detail', () => {
  expect(streamCardAction('operator:plan', { id: 'p', kind: 'chat', detail: 'Discuss' }).action)
    .toMatchObject({ planKind: 'chat', detail: 'Discuss', workspace: null });
  expect(streamCardAction('operator:plan', { id: 'p', kind: 'unknown', detail: 12 }).action)
    .toMatchObject({ planKind: 'team', detail: '', workspace: null });
});

test.each([
  ['operator:ask', 'ASK_REQUEST', 'confirm'],
  ['operator:ask_resolved', 'ASK_RESOLVED', null],
  ['seal:self_offer', 'SEAL_REQUEST', 'confirm'],
  ['seal:self_resolved', 'SEAL_RESOLVED', null],
  ['operator:plan_resolved', 'PLAN_RESOLVED', null],
  ['operator:team_start', 'TEAMRUN_START', 'confirm'],
  ['operator:team_board', 'TEAMRUN_BOARD', null],
  ['operator:team_done', 'TEAMRUN_DONE', null],
  ['operator:team_torch', 'TEAMRUN_TORCH', null],
])('%s keeps the card identity and cue contract', (channel, type, sound) => {
  const frame = Object.freeze({ id: 'original' });
  expect(streamCardAction(channel, frame)).toMatchObject({ action: { id: 'original', type }, sound });
});

test('settled seal and team frames retain receipt and delivery metadata', () => {
  const receipt = Object.freeze({ id: 'seal', status: 'confirmed', txHash: '0xreceipt', network: 'base', networkLabel: 'Base', blockNumber: 42 });
  expect(streamCardAction('seal:self_resolved', receipt).action).toEqual({ type: 'SEAL_RESOLVED', ...receipt });
  const delivery = Object.freeze({ path: '/tmp/report.md' });
  const record = Object.freeze({ id: 'record' });
  expect(streamCardAction('operator:team_done', { id: 'team', delivery, record }).action).toMatchObject({ delivery, record });
  expect(streamCardAction('operator:team_done', {}).action).toMatchObject({ delivery: null, record: null });
  const failures = Object.freeze({ check: 'no reply' });
  expect(streamCardAction('operator:team_done', { id: 'team', status: 'error', failures, skipped: ['ship'] }).action)
    .toMatchObject({ failures, skipped: ['ship'] });
});

test('a team run\'s chip belongs only in a chat with its lead — every desk hears the frame, one chat shows it', () => {
  const frame = Object.freeze({ id: 'run', laneId: 'keir', board: [] });
  expect(streamCardAction('operator:team_start', frame, 'keir').action).toMatchObject({ type: 'TEAMRUN_START', id: 'run' });
  expect(streamCardAction('operator:team_start', frame, 'signal')).toBeNull();
  // A frame or a chat with no lane to compare keeps the old reach.
  expect(streamCardAction('operator:team_start', { id: 'run' }, 'signal').action.type).toBe('TEAMRUN_START');
  expect(streamCardAction('operator:team_start', frame).action.type).toBe('TEAMRUN_START');
});

test('unknown and inherited object keys are not card channels', () => {
  for (const channel of ['missing', 'constructor', '__proto__']) expect(streamCardAction(channel, {})).toBeNull();
});
