/**
 * Birth observations — the ceremony's measured account of itself, the raw
 * material its resonance is derived from (Design note, 2026-09-29. Pure appends on a
 * plain session object; no mocks (RULE 0).
 */
import { describe, it, expect } from 'vitest';
import { observeStage, observeWitness } from '../../core/birth/birth-observations.js';

describe('birth observations', () => {
  it('keeps every stage attempt and every witness answer, in order', () => {
    const data = {};
    observeStage(data, { stage: 3, startedAt: 1000, firstFrameAt: 1400, endedAt: 9000, spokenChars: 312, reasoningChars: 40, toolCalls: 0, promptTokens: 5100, completionTokens: 96 });
    observeWitness(data, { stage: 3, at: 15000, witnessChars: 0 });
    observeStage(data, { stage: 4, startedAt: 15100, firstFrameAt: null, endedAt: 20000, spokenChars: 0, reasoningChars: 0, toolCalls: 1 });
    observeStage(data, { stage: 4, startedAt: 21000, firstFrameAt: 21500, endedAt: 26000, spokenChars: 80, reasoningChars: 0, toolCalls: 1 });
    expect(data.observations.map((o) => `${o.kind}:${o.stage}`)).toEqual(['stage:3', 'witness:3', 'stage:4', 'stage:4']);
    expect(data.observations[0]).toMatchObject({ startedAt: 1000, firstFrameAt: 1400, endedAt: 9000, spokenChars: 312, promptTokens: 5100, completionTokens: 96 });
    expect(data.observations[2]).toMatchObject({ firstFrameAt: null, promptTokens: null });
  });

  it('records counts and instants only — garbage becomes null, never a guess', () => {
    const data = {};
    observeStage(data, { stage: 1, startedAt: 'soon', endedAt: -5, spokenChars: NaN, reasoningChars: 2.6, toolCalls: undefined });
    expect(data.observations[0]).toMatchObject({ startedAt: null, endedAt: null, spokenChars: null, reasoningChars: 3, toolCalls: null });
    expect(Object.isFrozen(data.observations[0])).toBe(true);
  });

  it('refuses a record with no stage, and survives a missing session', () => {
    const data = {};
    observeStage(data, { startedAt: 1 });
    observeWitness(null, { stage: 1, at: 1 });
    expect(data.observations).toBeUndefined();
  });

  it('survives a checkpoint round-trip — the list is plain JSON', () => {
    const data = {};
    observeWitness(data, { stage: 2, at: 5, witnessChars: 12 });
    const back = JSON.parse(JSON.stringify(data));
    observeWitness(back, { stage: 3, at: 9, witnessChars: 0 });
    expect(back.observations).toHaveLength(2);
  });
});
