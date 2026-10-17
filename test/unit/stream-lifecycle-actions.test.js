import { expect, test } from 'vitest';
import { reconnectFrames, streamSession, resumedSession, lifecycleAction } from '../../frontend/app/RelinkShell/stream-lifecycle-actions.js';
import { HELD_ACK_CHANNELS, heldAckAction } from '../../frontend/app/RelinkShell/stream-held-actions.js';
import { run } from '../helpers/stream-reducer-kit.js';

test('reconnect declares chat mode after tool mode and includes only non-default purpose', () => {
  const prefs = Object.freeze({ toolMode: 'ask', chatMode: 'auto', voiceEnabled: false, purpose: 'work' });
  expect(reconnectFrames(prefs)).toEqual([
    ['tool:mode', { mode: 'ask' }], ['chat:mode', { mode: 'auto' }], ['voice:pref', { enabled: false }],
  ]);
  expect(reconnectFrames({ ...prefs, purpose: 'conversation' }).at(-1))
    .toEqual(['session:purpose', { purpose: 'conversation' }]);
});

test('foreign and missing resume identities cannot replace the active session', () => {
  const companion = Object.freeze({ neumaId: 'active', name: 'Active' });
  expect(resumedSession({ neumaId: 'other', sessionId: 'foreign' }, companion)).toBeNull();
  expect(resumedSession({}, companion)).toBeNull();
  expect(resumedSession({ neumaId: 'active', sessionId: 'own', companionName: 'Current' }, companion))
    .toEqual({ neumaId: 'active', sessionId: 'own', companionName: 'Current' });
  expect(resumedSession({ neumaId: 'active' }, companion)).toEqual(streamSession(companion, null));
  expect(streamSession(null, null)).toEqual({ neumaId: undefined, companionName: 'Unknown', sessionId: null });
});

test('real reducer clears shared activity when a link drops', () => {
  const state = run([
    lifecycleAction('connection'), lifecycleAction('substrate:activity', { local: 3 }),
    lifecycleAction('disconnection'),
  ]);
  expect(state).toMatchObject({ connected: false, localTurns: 0 });
  expect(run([lifecycleAction('substrate:activity', { local: -1 })]).localTurns).toBe(0);
});

test('binding refusals retain server explanations and distinct missing-message defaults', () => {
  for (const channel of ['companion:lane_missing', 'companion:not_yours']) {
    expect(lifecycleAction(channel, { message: 'Explained' })).toEqual({ type: 'ERROR', text: 'Explained' });
  }
  expect(lifecycleAction('companion:lane_missing').text).toContain('no workspace');
  expect(lifecycleAction('companion:not_yours').text).toContain('another witness');
  const data = Object.freeze({ id: 'act', status: 'completed', result: 'Read' });
  expect(lifecycleAction('tool:usage', data)).toEqual({ type: 'TOOL_RESULT', data });
  expect(lifecycleAction('unknown')).toBeNull();
});

test('held acknowledgements normalize counts even when there is no action handle', () => {
  for (const channel of HELD_ACK_CHANNELS) {
    expect(heldAckAction(channel, { held: '2' })).toEqual({ count: 2, action: null });
    expect(heldAckAction(channel, { held: 'bad' })).toEqual({ count: 0, action: null });
  }
  expect(heldAckAction('unknown', {})).toBeNull();
});

test('real queue reducer edits only the held bubble and pulls its final text home', () => {
  const mark = heldAckAction('consciousness:queued', { holdId: 'h', held: 1 });
  const edit = heldAckAction('consciousness:queue_edited', { holdId: 'h', held: 1, ok: true, thought: 'Revised' });
  const pull = heldAckAction('consciousness:queue_pulled', { holdId: 'h', held: 0, thought: 'Revised' });
  const state = run([
    { type: 'USER_SENT', text: 'Original', holdId: 'h' }, mark.action, edit.action, pull.action,
  ]);
  expect(state.messages.some((message) => message.holdId === 'h')).toBe(false);
  expect(state.pulledDraft.text).toBe('Revised');
});

test('a refused edit clears its queue marker while malformed accepted text does not invent an edit', () => {
  expect(heldAckAction('consciousness:queue_edited', { holdId: 'h', ok: false }).action)
    .toEqual({ type: 'QUEUE_CLEAR', holdId: 'h' });
  expect(heldAckAction('consciousness:queue_edited', { holdId: 'h', ok: true, thought: 9 }).action).toBeNull();
  expect(heldAckAction('consciousness:queue_taken', { holdId: 'h' }).action)
    .toEqual({ type: 'QUEUE_CLEAR', holdId: 'h' });
  expect(heldAckAction('consciousness:queue_pulled', { holdId: 'h', thought: null }).action)
    .toEqual({ type: 'QUEUE_PULLED', holdId: 'h', text: '' });
});
