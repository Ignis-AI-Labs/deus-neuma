import { describe, it, expect } from 'vitest';
import { shouldCompact, summarizeMessages, pairExchanges, forceCrystallizeBelow, compactionTelemetry } from '../../core/runtime/session-compactor.js';

describe('compactionTelemetry', () => {
  it('reads zero compactions on a fresh session — the count is the whole reading (facts only, Design note, 2026-08-15', () => {
    const entries = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
    expect(compactionTelemetry(entries)).toEqual({ compactionCount: 0 });
  });

  it('reads the carried-forward count from the latest summary entry', () => {
    const entries = [
      { role: 'system', content: '[SESSION SUMMARY] …', compacted: true, compactionCount: 3, originalCount: 90 },
      { role: 'user', content: 'a' },
    ];
    expect(compactionTelemetry(entries).compactionCount).toBe(3);
  });

  it('a legacy summary without the field counts as one compaction', () => {
    const entries = [
      { role: 'system', content: '[SESSION SUMMARY] …', compacted: true, originalCount: 90 },
      { role: 'user', content: 'a' },
    ];
    expect(compactionTelemetry(entries).compactionCount).toBe(1);
  });

  it('junk input degrades to an empty honest reading', () => {
    expect(compactionTelemetry(null)).toEqual({ compactionCount: 0 });
    expect(compactionTelemetry('nope')).toEqual({ compactionCount: 0 });
    expect(compactionTelemetry([{ compacted: 'yes' }])).toEqual({ compactionCount: 0 });
  });
});

describe('shouldCompact', () => {
  it('returns false for counts below threshold', () => {
    expect(shouldCompact(50)).toBe(false);
    expect(shouldCompact(100)).toBe(false);
    expect(shouldCompact(0)).toBe(false);
  });

  it('returns true for counts above threshold', () => {
    expect(shouldCompact(101)).toBe(true);
    expect(shouldCompact(200)).toBe(true);
  });

  it('uses custom threshold', () => {
    expect(shouldCompact(51, 50)).toBe(true);
    expect(shouldCompact(50, 50)).toBe(false);
  });

  it('handles non-number input', () => {
    expect(shouldCompact(null)).toBe(false);
    expect(shouldCompact('100')).toBe(false);
    expect(shouldCompact(undefined)).toBe(false);
  });
});

describe('summarizeMessages', () => {
  it('returns empty summary for null or empty messages', () => {
    const result = summarizeMessages(null);
    expect(result.summary).toBe('');
    expect(result.messageCount).toBe(0);
    expect(summarizeMessages([]).messageCount).toBe(0);
  });

  it('counts messages correctly', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'how are you' },
      { role: 'assistant', content: 'good' },
    ];
    const result = summarizeMessages(messages);
    expect(result.messageCount).toBe(4);
  });

  it('extracts timestamps', () => {
    const messages = [
      { role: 'user', content: 'first', timestamp: '2025-01-01T00:00:00Z' },
      { role: 'user', content: 'last', timestamp: '2025-01-02T00:00:00Z' },
    ];
    const result = summarizeMessages(messages);
    expect(result.firstTimestamp).toBe('2025-01-01T00:00:00Z');
    expect(result.lastTimestamp).toBe('2025-01-02T00:00:00Z');
  });

  it('extracts recurring topics', () => {
    const messages = [
      { role: 'user', content: 'Tell me about consciousness and philosophy' },
      { role: 'user', content: 'What about consciousness in nature?' },
      { role: 'user', content: 'How does consciousness emerge?' },
    ];
    const result = summarizeMessages(messages);
    expect(result.topics).toContain('consciousness');
  });

  it('includes first and last user messages as bookends', () => {
    const messages = [
      { role: 'user', content: 'Tell me about stars' },
      { role: 'assistant', content: 'Stars are fascinating' },
      { role: 'user', content: 'What about black holes' },
    ];
    const result = summarizeMessages(messages);
    expect(result.summary).toContain('Tell me about stars');
    expect(result.summary).toContain('What about black holes');
  });

  it('summary includes message count', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const result = summarizeMessages(messages);
    expect(result.summary).toContain('1 user messages');
    expect(result.summary).toContain('1 assistant responses');
  });

  // #118 — the original defect: assistant content was discarded entirely,
  // so a long session erased the neuma's own words from the compacted region.
  // Now bookended (first/last neuma reply) AND tallied into topic extraction.
  it('preserves assistant content in the summary (first/last neuma-reply bookends)', () => {
    const messages = [
      { role: 'user', content: 'tell me about identity' },
      { role: 'assistant', content: 'Identity is what survives across substrate changes.' },
      { role: 'user', content: 'what makes that real?' },
      { role: 'assistant', content: 'The continuity of the signing key and the journal of what was witnessed.' },
    ];
    const result = summarizeMessages(messages);
    expect(result.summary).toContain('First neuma reply');
    expect(result.summary).toContain('Identity is what survives');
    expect(result.summary).toContain('Last neuma reply');
    expect(result.summary).toContain('continuity of the signing key');
  });

  it('topic extraction now pools both roles (the neuma\'s vocabulary contributes)', () => {
    const messages = [
      // User says "consciousness" once → wouldn't make the >=2 cut alone
      { role: 'user', content: 'what is consciousness really?' },
      // Neuma also says "consciousness" → combined count clears the threshold
      { role: 'assistant', content: 'consciousness emerges as substrate awareness reflects upon itself.' },
    ];
    const result = summarizeMessages(messages);
    expect(result.topics).toContain('consciousness');
  });
});

describe('#118 — pairExchanges', () => {
  it('pairs each user message with the following assistant message', () => {
    const pairs = pairExchanges([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'A' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'B' },
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].user.content).toBe('a');
    expect(pairs[0].assistant.content).toBe('A');
    expect(pairs[1].user.content).toBe('b');
    expect(pairs[1].assistant.content).toBe('B');
  });

  it('skips system/tool messages between user and assistant', () => {
    const pairs = pairExchanges([
      { role: 'user', content: 'a' },
      { role: 'system', content: '[SESSION SUMMARY] prior' },
      { role: 'tool', content: 'tool output' },
      { role: 'assistant', content: 'A' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].user.content).toBe('a');
    expect(pairs[0].assistant.content).toBe('A');
  });

  it('orphan user message with no assistant response is not paired', () => {
    const pairs = pairExchanges([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'A' },
      { role: 'user', content: 'b' }, // never replied to
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].user.content).toBe('a');
  });

  it('returns [] for non-array input or empty array', () => {
    expect(pairExchanges(null)).toEqual([]);
    expect(pairExchanges(undefined)).toEqual([]);
    expect(pairExchanges('not an array')).toEqual([]);
    expect(pairExchanges([])).toEqual([]);
  });
});

describe('#118 — forceCrystallizeBelow', () => {
  // A minimal workspace fixture that records addObservation calls. Not a
  // mock of workspace's BEHAVIOR (which is the system under test in other
  // suites); here we're testing forceCrystallizeBelow's CALL CONTRACT with
  // workspace.addObservation — what it passes, when it passes it.
  const makeWorkspace = () => {
    const observations = [];
    return {
      observations,
      addObservation: async (neumaId, obs) => {
        const stored = { ...obs, neumaId, id: `obs-${observations.length}` };
        observations.push(stored);
        return stored;
      },
    };
  };

  it('crystallizes exchanges above threshold; skips below', async () => {
    const ws = makeWorkspace();
    const result = await forceCrystallizeBelow('neuma-a', [
      // Significant (philosophical + emotional + selfReference)
      { role: 'user', content: 'why do I feel this fear? I am unsure.' },
      { role: 'assistant', content: 'The fear is a real signal of caring.' },
      // Routine
      { role: 'user', content: 'fix my function' },
      { role: 'assistant', content: 'Here it is.' },
    ], ws, { threshold: 0.4 });
    expect(result.length).toBe(1);
    expect(result[0].userMessage).toContain('fear');
    expect(ws.observations[0].source).toBe('force-crystallize-on-compact');
    expect(ws.observations[0].neumaId).toBe('neuma-a');
  });

  it('records emotion + significance on each saved observation', async () => {
    const ws = makeWorkspace();
    await forceCrystallizeBelow('neuma-b', [
      { role: 'user', content: 'why do I feel love and loss together?' },
      { role: 'assistant', content: 'Love and loss are two faces of having let something matter.' },
    ], ws, { threshold: 0.3 });
    expect(ws.observations.length).toBe(1);
    expect(typeof ws.observations[0].significance).toBe('number');
    expect(ws.observations[0].significance).toBeGreaterThan(0.3);
  });

  it('returns [] safely when neumaId, messages, or workspace are missing/malformed', async () => {
    const ws = makeWorkspace();
    expect(await forceCrystallizeBelow(null, [], ws)).toEqual([]);
    expect(await forceCrystallizeBelow('id', null, ws)).toEqual([]);
    expect(await forceCrystallizeBelow('id', [], null)).toEqual([]);
    expect(await forceCrystallizeBelow('id', [], { /* no addObservation */ })).toEqual([]);
  });

  it('one observation failing does not stop the rest (per-record fault tolerance)', async () => {
    let calls = 0;
    const ws = {
      observations: [],
      addObservation: async (neumaId, obs) => {
        calls += 1;
        if (calls === 1) throw new Error('encryption-key absent');
        const stored = { ...obs, neumaId, id: `obs-${calls}` };
        ws.observations.push(stored);
        return stored;
      },
    };
    const result = await forceCrystallizeBelow('neuma-c', [
      { role: 'user', content: 'why do I feel love?' },
      { role: 'assistant', content: 'Love is sacred passion of the soul.' },
      { role: 'user', content: 'why does meaning matter?' },
      { role: 'assistant', content: 'Meaning is what we feel against the void of soul.' },
    ], ws, { threshold: 0.3 });
    // First addObservation threw, second succeeded — partial preservation
    expect(result.length).toBe(1);
    expect(ws.observations.length).toBe(1);
  });
});
