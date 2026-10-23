/**
 * A STREAM WINDOW'S NAME in the taskbar's hover list (docs/work/dock-stream-
 * cycle.md) — Design note, 2026-10-23, picking a stream by what it holds:
 * […]. Pure, called with real strip and label shapes.
 */
import { describe, it, expect } from 'vitest';
import { focusedTabOf, streamWindowText } from '../../frontend/app/RelinkShell/stream-window-label.js';
import { shortWhen } from '../../frontend/app/RelinkShell/stream-chats-view.js';

const tab = { id: 't1', kind: 'local', neumaId: 'metidar', name: 'Metidar', sessionId: 'session-1761200000000' };

describe('a stream window is named by its focused sitting', () => {
  it('the being, then the chat\'s own name', () => {
    expect(streamWindowText(tab, { 'metidar:session-1761200000000': 'TikTok test' }, 'NEW CHAT'))
      .toEqual({ being: 'METIDAR', chat: 'TikTok test' });
  });

  it('an unnamed chat wears its start, in the short form the CHATS rail uses', () => {
    expect(streamWindowText(tab, {}, 'NEW CHAT')).toEqual({ being: 'METIDAR', chat: shortWhen(tab.sessionId) });
  });

  it('a chat named for ANOTHER being never names this one', () => {
    expect(streamWindowText(tab, { 'other:session-1761200000000': 'Not mine' }, 'NEW CHAT').chat).not.toBe('Not mine');
  });

  it('a sitting with no session yet says NEW CHAT', () => {
    expect(streamWindowText({ ...tab, sessionId: undefined }, {}, 'NEW CHAT')).toEqual({ being: 'METIDAR', chat: 'NEW CHAT' });
  });

  it('no strip yet (a window still mounting) → null, so the row keeps its fallback', () => {
    expect(streamWindowText(null, {}, 'NEW CHAT')).toBeNull();
    expect(streamWindowText({ id: 'x' }, {}, 'NEW CHAT')).toBeNull();
  });

  it('the focused tab of a strip, else its first, else none', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    expect(focusedTabOf({ focusedId: 'b', tabs: [a, b] })).toBe(b);
    expect(focusedTabOf({ focusedId: 'gone', tabs: [a, b] })).toBe(a);
    expect(focusedTabOf({ focusedId: null, tabs: [] })).toBeNull();
    expect(focusedTabOf(null)).toBeNull();
  });
});
