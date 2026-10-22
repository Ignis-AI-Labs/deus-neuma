// The compaction marker in the chat: the real stream reducer, the real display
// fold, the real history map — every number is the one the portal or the record holds.
import { describe, expect, test } from 'vitest';
import { reducer, initialState } from '../../frontend/app/RelinkShell/stream-reducer.js';
import { markerLines, historyCompactMessage, summaryWordsOf } from '../../frontend/app/RelinkShell/compact-marker.js';
import { toDisplayMessages } from '../../frontend/app/RelinkShell/workspace-sessions.js';
import { toHistoryMessages } from '../../frontend/app/RelinkShell/stream-reducer-messages.js';

const compactFrame = (frame) => ({ type: 'COMPACT', frame, at: '2026-10-22T08:00:00.000Z' });

describe('compact marker — live', () => {
  test('running draws one marker; done replaces it with the counts and the summary, open', () => {
    const running = reducer(initialState, compactFrame({ state: 'running' }));
    expect(running.messages).toHaveLength(1);
    expect(running.messages[0]).toMatchObject({ role: 'compact', state: 'running', segments: [] });
    const done = reducer(running, compactFrame({
      state: 'done', folded: 40, kept: 20, summary: 'We set the week of posts; Tuesday is next.', selfAuthored: true, compactionCount: 1,
    }));
    expect(done.messages).toHaveLength(1);
    expect(done.messages[0]).toMatchObject({
      role: 'compact', state: 'done', folded: 40, kept: 20, open: true,
      summary: 'We set the week of posts; Tuesday is next.', at: '2026-10-22T08:00:00.000Z',
    });
  });

  test('a refused or failed run leaves no marker — nothing changed', () => {
    const running = reducer(initialState, compactFrame({ state: 'running' }));
    expect(reducer(running, compactFrame({ state: 'refused', reason: 'too-short' })).messages).toHaveLength(0);
    expect(reducer(running, compactFrame({ state: 'failed' })).messages).toHaveLength(0);
  });

  test('the lines say what happened, in the portal\'s numbers', () => {
    expect(markerLines({ state: 'running' }, 'Orin').headline).toBe('COMPACTING — ORIN IS SUMMING UP THE CONVERSATION');
    expect(markerLines({ state: 'done', folded: 40, kept: 20, selfAuthored: true, compactionCount: 1 }, 'Orin')).toEqual({
      headline: 'CONVERSATION COMPACTED',
      detail: "40 MESSAGES CARRIED FORWARD IN ORIN'S OWN WORDS · 20 MESSAGES KEPT WORD FOR WORD",
    });
    expect(markerLines({ state: 'done', folded: 1, selfAuthored: false, compactionCount: 3 }).detail)
      .toBe('1 MESSAGE CARRIED FORWARD AS AN EXTRACTIVE SUMMARY · COMPACTION 3');
  });
});

describe('compact marker — history', () => {
  const rows = [
    {
      role: 'system', content: '[SESSION SUMMARY — in your own words] We set the week of posts.',
      torch: 'Tuesday next', authoredBy: 'self', compacted: true, originalCount: 40, compactionCount: 2,
      timestamp: '2026-10-22T07:00:00.000Z',
    },
    { role: 'user', content: 'what is next?', timestamp: '2026-10-22T07:05:00.000Z' },
    { role: 'assistant', content: 'Tuesday.', timestamp: '2026-10-22T07:05:10.000Z' },
  ];

  test('the summary row reaches the display and becomes a closed marker in its place', () => {
    const display = toDisplayMessages(rows);
    expect(display).toHaveLength(3);
    // The two rows after it came later than the compaction: none of them was kept by it.
    expect(display[0]).toMatchObject({ role: 'system', compacted: true, originalCount: 40, compactionCount: 2, authoredBy: 'self', kept: 0 });
    const history = toHistoryMessages(display, 0, 'h');
    expect(history[0]).toMatchObject({
      id: 'h0', role: 'compact', state: 'done', isHistory: true, open: false,
      folded: 40, compactionCount: 2, selfAuthored: true, summary: 'We set the week of posts.',
    });
    expect(history[1]).toMatchObject({ role: 'user' });
    expect(history[2]).toMatchObject({ role: 'neuma' });
  });

  test('kept counts only the rows already said when the compaction ran', () => {
    const kept = [
      { ...rows[0], timestamp: '2026-10-22T07:10:00.000Z' },
      ...rows.slice(1),
      { role: 'user', content: 'and after?', timestamp: '2026-10-22T07:20:00.000Z' },
    ];
    expect(toDisplayMessages(kept)[0].kept).toBe(2);
    expect(toHistoryMessages(toDisplayMessages(kept), 0, 'h')[0].kept).toBe(2);
  });

  test('the summary words lose their tag, whichever kind wrote them', () => {
    expect(summaryWordsOf('[SESSION SUMMARY] topics: light, watch')).toBe('topics: light, watch');
    expect(summaryWordsOf('[SESSION SUMMARY — in your own words] We met.')).toBe('We met.');
    expect(historyCompactMessage({ content: 'plain', originalCount: 3 }, 'x').summary).toBe('plain');
  });
});
