// The DREAMS pane's pure pieces: how a dream's length, time and words read,
// and which pane an address opens (the app icon's "Record a dream" shortcut).
import { describe, expect, it } from 'vitest';
import { clockOf, whenOf, wordsOf } from '../../frontend/app/PocketShell/dream-format.js';
import { PANES, openingOf } from '../../frontend/app/PocketShell/pocket-opening.js';

describe('dream format', () => {
  it('reads a length the way a clock does', () => {
    expect(clockOf(0)).toBe('0:00');
    expect(clockOf(7_400)).toBe('0:07');
    expect(clockOf(261_000)).toBe('4:21');
    expect(clockOf(3_723_000)).toBe('1:02:03');
    expect(clockOf(null)).toBe('0:00');
  });

  it('reads when it was dreamt in the phone\'s own time', () => {
    const local = new Date(2026, 9, 8, 5, 12); // THU 8 OCT 2026, 05:12 local
    expect(whenOf(local.toISOString())).toBe('THU 8 OCT · 05:12');
    expect(whenOf('not a date')).toBe('—');
  });

  it('says where the words stand', () => {
    expect(wordsOf({ state: 'done', text: 'a house of glass' })).toEqual({ words: 'a house of glass', waiting: false, failed: false });
    expect(wordsOf({ state: 'done', text: '' }).words).toBe('(no words were heard)');
    expect(wordsOf({ state: 'failed', error: 'engine down' })).toMatchObject({ failed: true, waiting: false });
    expect(wordsOf({ state: 'working' })).toMatchObject({ waiting: true });
    expect(wordsOf(undefined)).toMatchObject({ waiting: true });
  });
});

describe('the pocket opening', () => {
  it('DREAMS is a pane', () => {
    expect(PANES.map(([id]) => id)).toContain('dreams');
  });

  it('the shortcut opens DREAMS recording; the journal shortcut opens it still', () => {
    expect(openingOf('?pane=dreams&record=1')).toEqual({ pane: 'dreams', record: true });
    expect(openingOf('?pane=dreams')).toEqual({ pane: 'dreams', record: false });
  });

  it('no ask, an unknown pane, or record anywhere else opens the stream without recording', () => {
    expect(openingOf('')).toEqual({ pane: 'stream', record: false });
    expect(openingOf('?pane=nowhere&record=1')).toEqual({ pane: 'stream', record: false });
    expect(openingOf('?pane=chats&record=1')).toEqual({ pane: 'chats', record: false });
  });
});
