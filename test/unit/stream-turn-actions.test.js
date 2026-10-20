import { expect, test } from 'vitest';
import { thinkingActions, speechActions, completionActions, providerRetryAction } from '../../frontend/app/RelinkShell/stream-turn-actions.js';
import { run } from '../helpers/stream-reducer-kit.js';

test('thinking stamps the real user turn before recording thought without starting speech', () => {
  const data = Object.freeze({ content: 'considering', turnId: 't1', takeIndex: 2 });
  const actions = thinkingActions(data, null, 123);
  expect(actions.map((action) => action.type)).toEqual(['TURN_STAMP', 'THINKING']);
  const state = run([{ type: 'USER_SENT', text: 'Question' }, ...actions]);
  expect(state.messages.find((message) => message.role === 'user').turnId).toBe('t1');
  expect(actions[1]).toMatchObject({ at: 123, take: { turnId: 't1', takeIndex: 2 } });
  expect(actions.some((action) => action.type === 'STREAM')).toBe(false);
});

test('empty thoughts are ignored and unstamped thoughts inherit the supplied take', () => {
  for (const content of ['', null, 9]) expect(thinkingActions({ content }, null, 1)).toEqual([]);
  const take = Object.freeze({ turnId: 'existing', takeIndex: 3 });
  expect(thinkingActions({ content: 'thinking' }, take, 42)).toEqual([
    { type: 'THINKING', text: 'thinking', at: 42, take },
  ]);
});

test('a failed first speech frame remains attached to its persisted turn in the real reducer', () => {
  const frame = speechActions({ turnId: 'failed', takeIndex: 1, error: true, content: 'Refused' }, { seen: false, witness: true });
  expect(frame.health).toBeNull();
  const state = run([{ type: 'USER_SENT', text: 'Question' }, frame.stamp, frame.start, frame.failure]);
  expect(state.messages.find((message) => message.role === 'user').turnId).toBe('failed');
  expect(state.messages.at(-1)).toMatchObject({ turnId: 'failed' });
  expect(frame.take).toEqual({ turnId: 'failed', takeIndex: 1 });
});

test('only attributed failures move a light: a witness route by its provider, the local model by unreachable', () => {
  expect(speechActions({ error: true, provider: 'vendor' }, { seen: true, witness: true }).health)
    .toEqual({ type: 'ROUTE', live: false, provider: 'vendor' });
  expect(speechActions({ error: true }, { seen: true, witness: true }).health).toBeNull();
  expect(speechActions({ error: true, unreachable: true }, { seen: true, witness: false }).health)
    .toEqual({ type: 'LOCAL', reachable: false, standby: false });
  // A refusal, an overflow, a bad key: the turn failed, the local model did not vanish.
  expect(speechActions({ error: true, reason: 'context length exceeded' }, { seen: true, witness: false }).health).toBeNull();
});

test('the failure carries the reason the frame named, and the desk shows it under the bubble', () => {
  const frame = speechActions({ turnId: 'p1', takeIndex: 1, error: true, content: '[Connection to the void disrupted]', reason: 'context length exceeded' },
    { seen: true, witness: false });
  expect(frame.failure).toMatchObject({ type: 'ERROR', reason: 'context length exceeded', turnId: 'p1' });
  const state = run([{ type: 'USER_SENT', text: 'Question' }, frame.failure]);
  expect(state.messages.at(-1)).toMatchObject({ role: 'error', reason: 'context length exceeded', turnId: 'p1' });
  // A reason the bubble already says is never repeated beneath it.
  const said = speechActions({ error: true, content: 'The model server did not answer: refused', reason: 'refused' }, { seen: true, witness: false });
  expect(run([said.failure]).messages.at(-1).reason).toBeUndefined();
});

test('later speech updates the take without repeating first-frame stamp, start or health actions', () => {
  const data = Object.freeze({ turnId: 't1', takeIndex: 2, chunk: 'delta' });
  const later = speechActions(data, { seen: true, witness: false });
  expect(later).toMatchObject({ stamp: null, start: null, health: null, content: 'delta', take: { turnId: 't1', takeIndex: 2 } });
  expect(speechActions(data, { seen: false, witness: true }).health).toEqual({ type: 'ROUTE', live: true });
  expect(speechActions(data, { seen: false, witness: false }).health).toEqual({ type: 'LOCAL', reachable: true, standby: false });
});

test('speechless completion still stamps the real user message and settles thinking', () => {
  const actions = completionActions({ turnId: 'silent', metadata: { tokens: 0 } });
  const state = run([{ type: 'USER_SENT', text: 'Question' }, ...actions]);
  expect(state.messages.find((message) => message.role === 'user').turnId).toBe('silent');
  expect(state.thinking).toBe(false);
  expect(completionActions(undefined)).toEqual([{ type: 'COMPLETE', metadata: null }]);
});

test('speech content and refusal fallback precedence stay distinct', () => {
  const context = { seen: false, witness: true };
  expect(speechActions({ content: 'one', thought: 'two', chunk: 'three' }, context).content).toBe('one');
  expect(speechActions({ thought: 'two', chunk: 'three' }, context).content).toBe('two');
  expect(speechActions({ error: true, chunk: 'not an error explanation' }, context).failure.text).toBe('Connection disrupted');
});

test('retry notes normalize wire values with caller-supplied time', () => {
  expect(providerRetryAction({ attempt: '2', maxAttempts: '5', delayMs: '100', reason: 'busy' }, 456))
    .toEqual({ type: 'PROVIDER_RETRY', attempt: 2, maxAttempts: 5, delayMs: 100, reason: 'busy', at: 456 });
  expect(providerRetryAction({ attempt: 'bad', reason: 4 }, 789))
    .toMatchObject({ attempt: 0, maxAttempts: 0, delayMs: 0, reason: '', at: 789 });
});
