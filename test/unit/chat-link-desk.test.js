/**
 * CHAT-LINK on the desk (#597): another chat's message arrives as a LINK line,
 * never the operator's bubble — live (the chatlink:arrived frame's action),
 * and again after a reload, from the record's origin. The real reducer and the
 * real display folds, called with real inputs.
 */
import { describe, expect, test } from 'vitest';
import { run } from '../helpers/stream-reducer-kit.js';
import { toDisplayMessages } from '../../frontend/app/RelinkShell/workspace-sessions.js';
import { toHistoryMessages } from '../../frontend/app/RelinkShell/stream-reducer-messages.js';

const TEXT = '[CHAT LINK: a housemate\'s words, not your operator\'s. To answer, file chat/send to "alder:s1"] Alder, from the chat (alder:s1):\nWhat is the plan?';

describe('a chat link on the desk', () => {
  test('arriving live, it is a LINK line that opens the turn', () => {
    const state = run([{ type: 'LINK_ARRIVED', text: TEXT, at: 1 }]);
    const line = state.messages.at(-1);
    expect(line.role).toBe('link');
    expect(line.segments.map((s) => s.text).join('')).toBe(TEXT);
    expect(state.thinking).toBe(true);
  });

  test('read back from the record, it keeps its origin and is drawn as a LINK line again', () => {
    const display = toDisplayMessages([
      { role: 'user', content: TEXT, origin: 'link', turnId: 't1', timestamp: '2026-10-29T08:00:00.000Z' },
      { role: 'assistant', content: 'Friday.', turnId: 't1', timestamp: '2026-10-29T08:00:01.000Z' },
      { role: 'user', content: 'And you?', turnId: 't2', timestamp: '2026-10-29T08:00:02.000Z' },
    ]);
    expect(display[0]).toMatchObject({ role: 'user', origin: 'link', content: TEXT });
    expect(display[2].origin).toBeUndefined(); // the operator's own words stay the operator's
    const history = toHistoryMessages(display, 0, 'h');
    expect(history.map((m) => m.role)).toEqual(['link', 'neuma', 'user']);
  });
});
