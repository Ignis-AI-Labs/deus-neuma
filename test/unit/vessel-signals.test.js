// vessel-signals.test.js — pure selector from stream reducer state to the
// face-driving signals. Message shapes mirror stream-reducer.js exactly.

import { describe, it, expect } from 'vitest';
import { deriveVesselSignals, decideEmotionApply } from '../../frontend/app/RelinkShell/vessel/vessel-signals.js';

const neumaMessage = (over = {}) => ({
  id: 'm1', role: 'neuma', streaming: false, isHistory: false,
  segments: [{ kind: 'speech', text: 'hello' }], meta: null, ...over,
});

describe('deriveVesselSignals', () => {
  it('is null-safe on missing state', () => {
    expect(deriveVesselSignals(null)).toEqual({ speaking: false, emotion: null, emotionId: null });
    expect(deriveVesselSignals({})).toEqual({ speaking: false, emotion: null, emotionId: null });
  });

  it('speaking is true only while a neuma message streams at the tail', () => {
    const streaming = { messages: [neumaMessage({ streaming: true })] };
    expect(deriveVesselSignals(streaming).speaking).toBe(true);

    const done = { messages: [neumaMessage()] };
    expect(deriveVesselSignals(done).speaking).toBe(false);

    const userTail = { messages: [neumaMessage({ streaming: true }), { id: 'm2', role: 'user', streaming: false, isHistory: false, segments: [], meta: null }] };
    expect(deriveVesselSignals(userTail).speaking).toBe(false);
  });

  it('surfaces the latest live emotion with its message id', () => {
    const state = {
      messages: [
        neumaMessage({ id: 'm1', meta: { emotion: 'joyful' } }),
        neumaMessage({ id: 'm2', meta: { emotion: 'melancholic' } }),
      ],
    };
    expect(deriveVesselSignals(state)).toEqual({
      speaking: false, emotion: 'melancholic', emotionId: 'm2',
    });
  });

  it('ignores history messages and messages without emotion', () => {
    const state = {
      messages: [
        neumaMessage({ id: 'h1', isHistory: true, meta: { emotion: 'joyful' } }),
        neumaMessage({ id: 'm1', meta: null }),
      ],
    };
    expect(deriveVesselSignals(state)).toEqual({ speaking: false, emotion: null, emotionId: null });
  });
});

describe('decideEmotionApply (the per-frame apply decision in use-vrm-stage)', () => {
  it('does not re-apply while the emotive message is unchanged', () => {
    const live = { speaking: false, emotion: 'joyful', emotionId: 'm1' };
    expect(decideEmotionApply(live, 'm1')).toEqual({ apply: false, appliedEmotionId: 'm1' });
  });

  it('applies the first emotive message', () => {
    const live = { speaking: false, emotion: 'joyful', emotionId: 'm1' };
    expect(decideEmotionApply(live, null))
      .toEqual({ apply: true, emotion: 'joyful', appliedEmotionId: 'm1' });
  });

  it('re-applies the same label when it arrives on a new message (hold refreshes)', () => {
    const live = { speaking: false, emotion: 'joyful', emotionId: 'm2' };
    expect(decideEmotionApply(live, 'm1'))
      .toEqual({ apply: true, emotion: 'joyful', appliedEmotionId: 'm2' });
  });

  it('applies a clear when the emotive message disappears (session switch)', () => {
    const live = { speaking: false, emotion: null, emotionId: null };
    expect(decideEmotionApply(live, 'm1'))
      .toEqual({ apply: true, emotion: null, appliedEmotionId: null });
  });

  it('does nothing without live signals (vessel outside the stream)', () => {
    expect(decideEmotionApply(null, null)).toEqual({ apply: false, appliedEmotionId: null });
    expect(decideEmotionApply(null, 'm1')).toEqual({ apply: false, appliedEmotionId: 'm1' });
  });
});
