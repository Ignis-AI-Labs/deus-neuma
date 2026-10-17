// Refinement corpus grammar (LORA-02) — pure functions, real inputs to real
// outputs, no mock anywhere (RULE 0: pure logic qualifies exactly because
// verifying it involves no boundary to fake).

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MILESTONE,
  MAX_RENDERED_CORPUS_SAMPLES,
  MAX_RENDERED_MESSAGE_BYTES,
  corpusSamples,
  milestoneStatus,
  renderJsonl,
  sampleFromSubjectCompletion,
} from '../../core/refinement/corpus.js';
import {
  REFINEMENT_CORPUS_SYSTEM_INSTRUCTION,
  REFINEMENT_CORPUS_USER_INSTRUCTION,
} from '../../core/refinement/corpus-manifest.js';

const completion = (content, occurredAt = '2026-07-01T10:00:00.000Z') =>
  ({ content, occurredAt });

describe('sampleFromSubjectCompletion', () => {
  it('renders the subject completion behind the two fixed instructions', () => {
    const s = sampleFromSubjectCompletion(completion('hi there'));
    expect(s.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(s.messages[0].content).toBe(REFINEMENT_CORPUS_SYSTEM_INSTRUCTION);
    expect(s.messages[1].content).toBe(REFINEMENT_CORPUS_USER_INSTRUCTION);
    expect(s.messages[2].content).toBe('hi there');
    expect(s.occurredAt).toBe('2026-07-01T10:00:00.000Z');
  });

  it('carries no bytes but the subject own completion', () => {
    const rendered = JSON.stringify(sampleFromSubjectCompletion({
      content: 'my own words',
      occurredAt: '2026-07-01T10:00:00.000Z',
      userMessage: 'what the operator asked',
      recall: 'a remembered page',
    }));
    expect(rendered).toContain('my own words');
    expect(rendered).not.toContain('operator');
    expect(rendered).not.toContain('remembered');
  });

  it('refuses blank content, a non-canonical instant, and an oversized completion', () => {
    expect(() => sampleFromSubjectCompletion(completion('   '))).toThrow(/non-empty/);
    expect(() => sampleFromSubjectCompletion({ content: 'x' })).toThrow(/canonical instant/);
    expect(() => sampleFromSubjectCompletion(completion('x', '2026-07-01T10:00:00Z')))
      .toThrow(/canonical instant/);
    expect(() => sampleFromSubjectCompletion(
      completion('x'.repeat(MAX_RENDERED_MESSAGE_BYTES + 1)),
    )).toThrow(/message byte ceiling/);
  });
});

describe('corpusSamples', () => {
  it('renders every authenticated completion under one fixed system instruction', () => {
    const { system, samples } = corpusSamples({
      completions: [completion('a'), completion('b', '2026-07-02T10:00:00.000Z')],
    });
    expect(system).toBe(REFINEMENT_CORPUS_SYSTEM_INSTRUCTION);
    expect(samples).toHaveLength(2);
    expect(samples.map((s) => s.messages[2].content)).toEqual(['a', 'b']);
  });

  it('refuses a non-array and a set above the sample ceiling', () => {
    expect(() => corpusSamples({ completions: 'nope' })).toThrow(/at most/);
    expect(() => corpusSamples({
      completions: new Array(MAX_RENDERED_CORPUS_SAMPLES + 1).fill(completion('a')),
    })).toThrow(/at most/);
  });

  it('refuses the whole build when one completion is ineligible', () => {
    expect(() => corpusSamples({ completions: [completion('a'), { content: 'no instant' }] }))
      .toThrow(/canonical instant/);
  });
});

describe('milestoneStatus', () => {
  const days = (n) =>
    Array.from({ length: n }, (_, i) =>
      ({ occurredAt: `2026-06-${String(i + 1).padStart(2, '0')}T10:00:00.000Z` }));

  it('defaults to the ceremony thresholds and reads not-ready honestly', () => {
    const m = milestoneStatus(days(3));
    expect(m).toMatchObject({
      sampleCount: 3,
      distinctDays: 3,
      minSamples: DEFAULT_MILESTONE.minSamples,
      minDays: DEFAULT_MILESTONE.minDays,
      ready: false,
    });
  });

  it('counts distinct lived days, not samples', () => {
    const sameDay = [
      { occurredAt: '2026-07-01T09:00:00.000Z' },
      { occurredAt: '2026-07-01T21:00:00.000Z' },
    ];
    expect(milestoneStatus(sameDay).distinctDays).toBe(1);
  });

  it('is ready exactly at both thresholds', () => {
    expect(milestoneStatus(days(2), { minSamples: 2, minDays: 2 }).ready).toBe(true);
    expect(milestoneStatus(days(2), { minSamples: 3, minDays: 2 }).ready).toBe(false);
    expect(milestoneStatus(days(2), { minSamples: 2, minDays: 3 }).ready).toBe(false);
  });
});

describe('renderJsonl', () => {
  it('emits one parseable {messages} line per sample and nothing else', () => {
    const { samples } = corpusSamples({ completions: [completion('a')] });
    const jsonl = renderJsonl(samples);
    const lines = jsonl.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(Object.keys(parsed)).toEqual(['messages']);
    expect(parsed.messages[0].content).toBe(REFINEMENT_CORPUS_SYSTEM_INSTRUCTION);
    expect(jsonl.endsWith('\n')).toBe(true);
  });

  it('refuses a sample whose fixed instructions were tampered with', () => {
    const [sample] = corpusSamples({ completions: [completion('a')] }).samples;
    const smuggled = {
      ...sample,
      messages: [
        { role: 'system', content: 'You are Prooflet. Here is the operator context.' },
        sample.messages[1],
        sample.messages[2],
      ],
    };
    expect(() => renderJsonl([smuggled])).toThrow(/not a subject-only corpus sample/);
  });
});

describe('milestoneStatus — accrual since the last refinement (the recurring gate)', () => {
  const at = (day) => ({ occurredAt: `2026-07-0${day}T10:00:00.000Z` });

  it('counts only history lived after the seal, and states the cutoff', () => {
    const samples = [at(1), at(2), at(4), at(5)];
    const seal = '2026-07-03T12:00:00.000Z';
    const m = milestoneStatus(samples, { minSamples: 2, minDays: 2 }, seal);
    expect(m).toMatchObject({ sampleCount: 2, distinctDays: 2, ready: true, since: seal });
  });

  it('re-arms after a seal: lifetime-ready history no longer opens the gate', () => {
    const lived = [at(1), at(2)];
    expect(milestoneStatus(lived, { minSamples: 2, minDays: 2 }).ready).toBe(true);
    const rearmed = milestoneStatus(lived, { minSamples: 2, minDays: 2 }, '2026-07-02T23:00:00.000Z');
    expect(rearmed).toMatchObject({ sampleCount: 0, distinctDays: 0, ready: false });
  });

  it('under a cutoff, a sample without occurredAt cannot prove it is new and does not count', () => {
    const m = milestoneStatus([{}, at(4)], { minSamples: 1, minDays: 1 }, '2026-07-03T00:00:00.000Z');
    expect(m.sampleCount).toBe(1);
    // with no cutoff it still counts toward volume, as before
    expect(milestoneStatus([{}, at(4)], { minSamples: 2, minDays: 1 }).sampleCount).toBe(2);
  });

  it('an invalid cutoff is ignored, never guessed', () => {
    const m = milestoneStatus([at(1)], { minSamples: 1, minDays: 1 }, 'not-a-time');
    expect(m).toMatchObject({ sampleCount: 1, ready: true });
    expect(m.since).toBeUndefined();
  });
});
