// The lazy history: what the display view leaves out is addressed in the desk's
// messages, rebuilt as segments that know where to fetch it, and found again in
// the turn's full rows. Pure functions, real inputs.
import { describe, expect, test } from 'vitest';
import { slimForDisplay } from '../../core/workspace/session-display.js';
import { toDisplayMessages } from '../../frontend/app/RelinkShell/workspace-sessions.js';
import { toHistoryMessages } from '../../frontend/app/RelinkShell/stream-reducer-messages.js';
import { pickLazy } from '../../frontend/app/RelinkShell/lazy-detail.js';

const IMAGE = 'data:image/png;base64,AAAA';
const ROWS = [
  { role: 'user', turnId: 't-1', content: 'look', images: [IMAGE] },
  { role: 'assistant', turnId: 't-1', content: 'first', thoughts: [{ text: 'thinking one', mark: 0 }], tools: [{ tool: 'fs/read', status: 'ok', summary: 's', detail: 'detail one', mark: 0 }] },
  { role: 'assistant', turnId: 't-1', content: 'second', thoughts: [{ text: 'thinking two', mark: 0 }], tools: [{ tool: 'fs/read', status: 'ok', summary: 's', detail: 'detail two', mark: 0 }] },
];
const WHERE = { neumaId: 'lane', sessionId: 'sess' };

describe('the lazy history', () => {
  test('every lazy item is addressed by lane, session, point, take, part and index', () => {
    const shown = toDisplayMessages(slimForDisplay(ROWS), 50, WHERE);
    expect(shown[0].images[0].ref).toEqual({ ...WHERE, turnId: 't-1', part: 'image', index: 0 });
    expect(shown[1].takeCount).toBe(2);
    expect(shown[1].takes[0].thoughts[0].ref).toEqual({ ...WHERE, turnId: 't-1', take: 1, part: 'thought', index: 0 });
    expect(shown[1].takes[1].tools[0].ref).toEqual({ ...WHERE, turnId: 't-1', take: 2, part: 'tool', index: 0 });
  });

  test('the segments keep the address and the size, and draw nothing invented', () => {
    const shown = toDisplayMessages(slimForDisplay(ROWS), 50, WHERE);
    const [ask, answer] = toHistoryMessages(shown, 0, 'h');
    expect(ask.segments[0]).toMatchObject({ kind: 'image', src: null, ref: { part: 'image' } });
    const thought = answer.segments.find((s) => s.kind === 'thought');
    expect(thought).toMatchObject({ text: '', chars: 'thinking two'.length, ref: { take: 2, part: 'thought' } });
    const tool = answer.segments.find((s) => s.kind === 'tool');
    expect(tool).toMatchObject({ detail: '', detailChars: 'detail two'.length, ref: { take: 2, part: 'tool' } });
  });

  test('the full rows give back exactly the part that was left out', () => {
    expect(pickLazy(ROWS, { part: 'image', index: 0 })).toBe(IMAGE);
    expect(pickLazy(ROWS, { part: 'thought', take: 1, index: 0 })).toBe('thinking one');
    expect(pickLazy(ROWS, { part: 'tool', take: 2, index: 0 })).toBe('detail two');
    expect(pickLazy(ROWS, { part: 'tool', take: 3, index: 0 })).toBeNull();
    expect(pickLazy([], { part: 'image', index: 0 })).toBeNull();
  });
});
