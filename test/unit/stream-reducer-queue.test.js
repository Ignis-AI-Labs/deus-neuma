/**
 * THE HELD WORD STAYS THE OPERATOR'S (Design note, 2026-08-16 — reducer half.
 *
 * A send carries a hold handle; while the portal HOLDS the word its bubble
 * is marked, repaints only from the portal's echoed words, stands down when
 * the drain takes it, and leaves the stream when Escape pulls it home to
 * the composer (pulledDraft). Pure model, no IO, no clocks.
 */

import { describe, expect, test } from 'vitest';
import { reducer, initialState } from '../../frontend/app/RelinkShell/stream-reducer.js';

const run = (actions, start = initialState) => actions.reduce(reducer, start);

const sent = (text, holdId) => ({ type: 'USER_SENT', text, holdId });
const userMsg = (state, holdId) => state.messages.find((m) => m.holdId === holdId);
const words = (msg) => msg.segments.filter((s) => s.kind === 'speech').map((s) => s.text).join('');

describe('the hold handle rides the bubble', () => {
  test('USER_SENT with a holdId marks the bubble addressable, not yet queued', () => {
    const state = run([sent('hello', 'q1')]);
    expect(userMsg(state, 'q1')).toMatchObject({ role: 'user', holdId: 'q1', queued: false });
  });

  test('without a holdId the bubble carries no queue surface at all', () => {
    const state = run([{ type: 'USER_SENT', text: 'plain' }]);
    expect(state.messages[0].holdId).toBeUndefined();
    expect(state.messages[0].queued).toBeUndefined();
  });
});

describe('QUEUE_MARK / QUEUE_CLEAR — the portal says held, the drain says taken', () => {
  test('the queued ack marks exactly its own bubble', () => {
    const state = run([sent('one', 'q1'), sent('two', 'q2'), { type: 'QUEUE_MARK', holdId: 'q2' }]);
    expect(userMsg(state, 'q1').queued).toBe(false);
    expect(userMsg(state, 'q2').queued).toBe(true);
  });

  test('taken stands the bubble down; a stranger handle changes nothing', () => {
    const held = run([sent('one', 'q1'), { type: 'QUEUE_MARK', holdId: 'q1' }]);
    const taken = reducer(held, { type: 'QUEUE_CLEAR', holdId: 'q1' });
    expect(userMsg(taken, 'q1').queued).toBe(false);
    expect(reducer(taken, { type: 'QUEUE_CLEAR', holdId: 'q9' })).toEqual(taken);
  });
});

describe('QUEUE_EDIT — the bubble repaints from the portal\'s echoed words', () => {
  test('rewrites a HELD bubble\'s words in place', () => {
    const state = run([
      sent('first draft', 'q1'),
      { type: 'QUEUE_MARK', holdId: 'q1' },
      { type: 'QUEUE_EDIT', holdId: 'q1', text: 'second draft' },
    ]);
    expect(words(userMsg(state, 'q1'))).toBe('second draft');
  });

  test('never rewrites a bubble the drain already took — the spoken record stands', () => {
    const state = run([
      sent('as spoken', 'q1'),
      { type: 'QUEUE_MARK', holdId: 'q1' },
      { type: 'QUEUE_CLEAR', holdId: 'q1' },
      { type: 'QUEUE_EDIT', holdId: 'q1', text: 'too late' },
    ]);
    expect(words(userMsg(state, 'q1'))).toBe('as spoken');
  });
});

describe('QUEUE_PULLED — the word comes home to the composer', () => {
  test('the bubble leaves the stream and pulledDraft seeds the field', () => {
    const state = run([
      sent('kept', 'q1'),
      sent('coming home', 'q2'),
      { type: 'QUEUE_MARK', holdId: 'q2' },
      { type: 'QUEUE_PULLED', holdId: 'q2', text: 'coming home' },
    ]);
    expect(userMsg(state, 'q2')).toBeUndefined();
    expect(userMsg(state, 'q1')).toBeDefined();
    expect(state.pulledDraft).toEqual({ seq: 1, text: 'coming home' });
  });

  test('pulling the same words twice re-seeds — seq moves every pull', () => {
    const state = run([
      sent('again', 'q1'),
      { type: 'QUEUE_MARK', holdId: 'q1' },
      { type: 'QUEUE_PULLED', holdId: 'q1', text: 'again' },
      sent('again', 'q2'),
      { type: 'QUEUE_MARK', holdId: 'q2' },
      { type: 'QUEUE_PULLED', holdId: 'q2', text: 'again' },
    ]);
    expect(state.pulledDraft).toEqual({ seq: 2, text: 'again' });
  });

  test('an un-queued bubble is never pulled — delivered words stay on screen', () => {
    const before = run([sent('delivered', 'q1')]); // no QUEUE_MARK: it ran at once
    const after = reducer(before, { type: 'QUEUE_PULLED', holdId: 'q1', text: '' });
    expect(userMsg(after, 'q1')).toBeDefined();
    expect(after.pulledDraft).toBeNull();
  });
});
