// The context reading after a compaction: derived from the last recorded one,
// only the conversation re-counted, labelled approximate — and the one a resume
// replays until a turn measures again. Real events from the real builder.
import { describe, expect, test } from 'vitest';
import { buildCompositionEvent } from '../../core/runtime/context-composition.js';
import { compositionAfterCompaction, replayableComposition, summaryWords } from '../../backend/services/compacted-composition.js';

const conversation = (n, from = 0) => Array.from({ length: n }, (_, i) => ([
  { role: 'user', content: `question ${from + i} about the lighthouse and the long watch it keeps`, timestamp: `2026-10-22T06:${String(i).padStart(2, '0')}:00.000Z` },
  { role: 'assistant', content: `answer ${from + i}: the light keeps its watch through every night`, timestamp: `2026-10-22T06:${String(i).padStart(2, '0')}:30.000Z` },
])).flat();

const recordedFor = (rows) => buildCompositionEvent({
  sections: [
    { id: 'identity', label: 'IDENTITY', text: 'x'.repeat(8000) },
    { id: 'recentConversation', label: 'RECENT CONVERSATION', text: rows.map((m) => `${m.role}: ${m.content}`).join('\n\n') },
  ],
  usage: { promptTokens: 6000, completionTokens: 40 },
  standing: { promptTokens: 6000, source: 'measured' },
  budget: { contextTokens: 262144, source: 'runtime' },
});

describe('compacted-composition', () => {
  const before = conversation(30);
  const recorded = recordedFor(before);
  const summary = {
    role: 'system', content: '[SESSION SUMMARY — in your own words] We kept watch.', compacted: true,
    originalCount: 40, compactionCount: 1, authoredBy: 'self', timestamp: '2026-10-22T07:00:00.000Z',
  };
  const after = [summary, ...before.slice(-20)];

  test('only the conversation is re-counted; the reading falls and says it is an estimate', () => {
    const event = compositionAfterCompaction(recorded, after);
    expect(event.usage.source).toBe('approx');
    expect(event.usage.inputTokens).toBeLessThan(recorded.usage.inputTokens);
    expect(event.usage.outputTokens).toBe(0);
    const identity = event.sections.find((s) => s.id === 'identity');
    expect(identity).toEqual(recorded.sections.find((s) => s.id === 'identity'));
    const transcript = event.sections.find((s) => s.id === 'recentConversation');
    expect(transcript.tokenSource).toBe('approx');
    expect(transcript.chars).toBeLessThan(recorded.sections.find((s) => s.id === 'recentConversation').chars);
    expect(event.session).toEqual({ compactionCount: 1, atBoundary: false });
    expect(event.budget).toEqual(recorded.budget);
  });

  test('nothing honest to derive → null', () => {
    expect(compositionAfterCompaction(null, after)).toBeNull();
    expect(compositionAfterCompaction(buildCompositionEvent({ sections: [{ id: 'identity', label: 'I', text: 'x' }] }), after)).toBeNull();
  });

  test('a resume replays the post-compaction reading until a later turn records its own', () => {
    const recordedRows = after.map((m, i) => (i === after.length - 1 ? { ...m, composition: recorded } : m));
    const replay = replayableComposition(recordedRows);
    expect(replay.at).toBe(summary.timestamp);
    expect(replay.composition.afterCompaction).toBe(true);
    const later = { ...recordFreshTurn(), timestamp: '2026-10-22T08:00:00.000Z' };
    const replayLater = replayableComposition([...recordedRows, later]);
    expect(replayLater.composition).toBe(later.composition);
  });

  test('the summary words lose their tag', () => {
    expect(summaryWords(summary)).toBe('We kept watch.');
  });
});

function recordFreshTurn() {
  return { role: 'assistant', content: 'a new answer', composition: recordedFor(conversation(2, 90)) };
}
