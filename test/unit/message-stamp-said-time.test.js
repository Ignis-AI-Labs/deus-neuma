// message-stamp-said-time.test.js — a reply shows WHEN IT WAS SAID, and the
// chat's start never passes for it.
//
// The sighting (2026-10-23, ~22:00 +07): a reply said that evening (an
// image/generate chip, then prose) sat under […]. That
// text is not a message stamp at all — it is formatDateTime's shape (comma,
// two-digit hour), the title line's: the chat was minted Sep 2 19:19 and,
// unnamed, wore its mint time as its name, in the message stamp's own
// register, on the line right above the transcript.
//
// Proven here on the real code, no mocks (RULE 0): the live reducer and the
// history fold both carry the reply's own moment, and the title line words
// the chat's start as a START, from the real en catalog.

import { describe, expect, it } from 'vitest';
import { reducer, initialState } from '../../frontend/app/RelinkShell/stream-reducer.js';
import { toDisplayMessages } from '../../frontend/app/RelinkShell/workspace-sessions.js';
import { chatTitleOf, chatTitleLine, sessionLabel } from '../../frontend/app/RelinkShell/stream-chats-view.js';
import { formatClockStamp, formatDateTime } from '../../frontend/utils/format.js';
import deskEn from '../../frontend/i18n/locales/en/desk.js';

const MINT = new Date(2026, 8, 2, 19, 19, 26); // the chat began Sep 2, 2026, 7:19 PM local
const SID = `session-${MINT.getTime()}`;
const SAID = new Date(2026, 9, 23, 22, 5); // the reply, Oct 23 2026, 10:05 PM local
const NOW = new Date(2026, 9, 23, 22, 10);
const started = (when) => deskEn.stream.chatStarted.replace('{{when}}', when);

// The hook stamps every action at its boundary (use-consciousness-stream.js);
// here the same stamps are given explicitly, minutes apart, like a real turn.
const at = (minutes) => SAID.getTime() + minutes * 60_000;

describe('the reply carries its own moment', () => {
  it('live: a finished reply after a render chip is stamped with today\'s time, never the chat\'s start', () => {
    const actions = [
      { type: 'USER_SENT', text: 'make the clip', at: at(-2) },
      { type: 'TOOL_OPEN', label: 'image/generate', at: at(-1) },
      { type: 'TOOL_RESULT', data: { tool: 'image/generate', status: 'ok', summary: 'generated 1 image(s) — 966KB video/mp4' }, at: at(0) },
      { type: 'SPEECH', text: 'Here it is.', at: at(0) },
      { type: 'COMPLETE', metadata: null, at: at(0) },
    ];
    const state = actions.reduce(reducer, initialState);
    const reply = state.messages.find((m) => m.role === 'neuma');
    expect(reply.streaming).toBe(false);
    expect(reply.segments.map((s) => s.kind)).toEqual(['tool', 'speech']);
    expect(formatClockStamp(reply.at, NOW)).toBe('10:04 PM');
    expect(formatClockStamp(reply.at, NOW)).not.toContain('Sep');
  });

  it('history: a reopened chat stamps each reply with its record\'s own time', () => {
    const records = [
      { role: 'user', content: 'hello', turnId: 't-old', timestamp: MINT.toISOString() },
      { role: 'assistant', content: 'hi', turnId: 't-old', timestamp: new Date(MINT.getTime() + 30_000).toISOString() },
      { role: 'user', content: 'make the clip', turnId: 't-now', timestamp: new Date(at(-2)).toISOString() },
      {
        role: 'assistant', content: 'Here it is.', turnId: 't-now', timestamp: SAID.toISOString(),
        tools: [{ tool: 'image/generate', status: 'ok', summary: 'generated 1 image(s) — 966KB video/mp4', mark: 0 }],
      },
    ];
    const state = reducer(initialState, { type: 'HISTORY', messages: toDisplayMessages(records) });
    const replies = state.messages.filter((m) => m.role === 'neuma');
    expect(replies).toHaveLength(2);
    expect(formatClockStamp(replies[0].at, NOW)).toBe('Sep 2 · 7:19 PM');
    expect(formatClockStamp(replies[1].at, NOW)).toBe('10:05 PM');
  });

  it('the reported text was never a message stamp — it is the chat\'s mint time in the title\'s shape', () => {
    expect(sessionLabel(SID)).toBe(formatDateTime(MINT.getTime()));
    expect(sessionLabel(SID).toUpperCase()).toBe('SEP 2, 2026, 07:19 PM');
    // A message stamp of that moment reads differently — the two can be told apart.
    expect(formatClockStamp(MINT, new Date(2027, 0, 1))).toBe('Sep 2, 2026 · 7:19 PM');
  });
});

describe('the title line says the chat STARTED then', () => {
  it('an unnamed chat\'s line reads as its start, not as a bare stamp', () => {
    const line = chatTitleLine(chatTitleOf({}, 'n1', SID), started);
    expect(line.name).toBe(`STARTED ${sessionLabel(SID)}`);
    expect(line.name).not.toBe(sessionLabel(SID));
    expect(line.stamp).toBe('');
  });

  it('a named chat keeps its name, the start riding beside it worded as a start', () => {
    const line = chatTitleLine(chatTitleOf({ [`n1:${SID}`]: 'THE CLIP' }, 'n1', SID), started);
    expect(line).toEqual({ name: 'THE CLIP', stamp: `STARTED ${sessionLabel(SID)}` });
  });
});
