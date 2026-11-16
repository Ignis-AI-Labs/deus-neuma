/**
 * Tests for stream-chats-view — the pure derivation behind the stream's chat
 * title line and the CHATS rail (frontend/app/RelinkShell/stream-chats-view.js).
 * Real inputs, real outputs — no mock anywhere (the pure-function case RULE 0
 * admits).
 */
import { describe, it, expect } from 'vitest';
import {
  sessionLabel, chatTitleOf, chatRows, shortStamp, shortWhen, filterRows,
  rowTip, tipPlacement, threadRows, shownRows,
} from '../../frontend/app/RelinkShell/stream-chats-view.js';
import { formatDateTime } from '../../frontend/utils/format.js';

const MS = 1755229380000; // a fixed real instant
const SID = `session-${MS}`;

describe('sessionLabel', () => {
  it('renders a session id as its mint timestamp', () => {
    expect(sessionLabel(SID)).toBe(formatDateTime(MS));
    expect(sessionLabel(SID)).not.toBe(SID);
  });

  it('falls back to the raw id when it carries no timestamp', () => {
    expect(sessionLabel('session-abc')).toBe('session-abc');
    expect(sessionLabel('weird')).toBe('weird');
  });
});

describe('chatTitleOf', () => {
  it('nothing bound → null (a fresh sitting is NEW CHAT, said by the component)', () => {
    expect(chatTitleOf({}, 'n1', null)).toBeNull();
  });

  it('a named chat wears its name, stamp riding beside', () => {
    const t = chatTitleOf({ [`n1:${SID}`]: 'MIRROR LOOP DESIGN' }, 'n1', SID);
    expect(t.title).toBe('MIRROR LOOP DESIGN');
    expect(t.named).toBe(true);
    expect(t.stamp).toBe(sessionLabel(SID));
  });

  it('an unnamed chat wears its timestamp as the title', () => {
    const t = chatTitleOf({}, 'n1', SID);
    expect(t.title).toBe(sessionLabel(SID));
    expect(t.named).toBe(false);
  });

  it('another being\'s label for the same session id never leaks in', () => {
    const t = chatTitleOf({ [`n2:${SID}`]: 'THEIRS' }, 'n1', SID);
    expect(t.named).toBe(false);
  });
});

describe('the rail\'s short forms', () => {
  // Design note, 2026-08-25: […]. The long
  // form ate so much of a 220px rail that chat NAMES truncated to five
  // characters — the list said when every chat happened and refused to say
  // what any of them were about.
  it('stamps MM/DD/YY', () => {
    expect(shortStamp(SID)).toMatch(/^\d{2}\/\d{2}\/\d{2}$/);
    const d = new Date(MS);
    expect(shortStamp(SID)).toBe(
      `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear() % 100).padStart(2, '0')}`,
    );
  });

  it('an UNNAMED chat keeps its time, or a day of chats is one repeated row', () => {
    // The date alone cannot name a chat: several sittings a day is ordinary,
    // and a column of identical '08/15/25' rows is not navigable.
    const morning = 'session-1755229380000';
    const later = 'session-1755269380000';
    expect(shortStamp(morning)).toBe(shortStamp(later));
    expect(shortWhen(morning)).not.toBe(shortWhen(later));
    expect(shortWhen(SID)).toMatch(/^\d{2}\/\d{2}\/\d{2} \d{1,2}:\d{2} (AM|PM)$/);
  });

  it('an id with no timestamp yields no stamp, never a wrong one', () => {
    expect(shortStamp('session-abc')).toBe('');
    expect(shortWhen('session-abc')).toBe('session-abc');
  });
});

describe('filterRows', () => {
  const rows = [
    { label: 'MIRROR LOOP DESIGN', stamp: '08/21/26' },
    { label: '08/15/26 9:03 AM', stamp: '08/15/26' },
  ];

  it('an empty query is EVERY row, never zero', () => {
    expect(filterRows(rows, '')).toHaveLength(2);
    expect(filterRows(rows, '   ')).toHaveLength(2);
    expect(filterRows(rows, null)).toHaveLength(2);
  });

  it('matches the name and the stamp, case-insensitively', () => {
    expect(filterRows(rows, 'mirror')).toHaveLength(1);
    expect(filterRows(rows, '08/15')).toHaveLength(1);
    expect(filterRows(rows, 'MIRROR')[0].label).toBe('MIRROR LOOP DESIGN');
  });

  it('no match is an empty list, not a throw', () => {
    expect(filterRows(rows, 'zzz')).toEqual([]);
    expect(filterRows(null, 'x')).toEqual([]);
  });
});

describe('chatRows', () => {
  const s2 = 'session-1755229500000';
  it('lists one-on-ones with labels, marks the live one, excludes councils', () => {
    const rows = chatRows(
      [s2, SID, 'council-123'],
      { [`n1:${SID}`]: 'NAMED' },
      'n1',
      s2,
    );
    expect(rows.map((r) => r.id)).toEqual([s2, SID]);
    expect(rows[0].live).toBe(true);
    expect(rows[0].named).toBe(false);
    expect(rows[1].label).toBe('NAMED');
    expect(rows[1].live).toBe(false);
    // The rail wears the short stamp; the exact instant still rides the row
    // for its hover title, so short on screen never means lost.
    expect(rows[1].stamp).toBe(shortStamp(SID));
    expect(rows[1].full).toBe(sessionLabel(SID));
    // …and an unnamed row is named by its short date AND time.
    expect(rows[0].label).toBe(shortWhen(s2));
  });

  it('junk input degrades to an empty list, never a throw', () => {
    expect(chatRows(null, null, null, null)).toEqual([]);
  });
});

describe('rowTip — the whole name, for a rail that must truncate it', () => {
  it('a named chat says its name AND the exact instant it was minted', () => {
    const [row] = chatRows([SID], { [`n1:${SID}`]: 'THE MIRROR LOOP' }, 'n1', null);
    expect(rowTip(row)).toBe(`THE MIRROR LOOP — ${sessionLabel(SID)}`);
    // What the ellipsis eats on screen is genuinely recoverable on hover.
    expect(rowTip(row)).toContain(row.label);
  });

  it('an unnamed chat already wears its time — the tip is the long form alone', () => {
    const [row] = chatRows([SID], {}, 'n1', null);
    expect(rowTip(row)).toBe(sessionLabel(SID));
  });

  it('junk degrades to an empty string, never a throw or "undefined"', () => {
    expect(rowTip(null)).toBe('');
    expect(rowTip({})).toBe('');
  });
});

describe('tipPlacement — a fixed layer, because the rail clips its own overflow', () => {
  const view = { width: 1600, height: 900 };

  it('anchors to the row: right of the rail\'s left edge, level with the row', () => {
    expect(tipPlacement({ top: 300, left: 1312 }, view)).toEqual({ top: 300, right: 296 });
  });

  it('a row near the bottom keeps its tip on screen', () => {
    expect(tipPlacement({ top: 890, left: 1312 }, view).top).toBe(828);
  });

  it('a row at the very top never sits flush against the edge', () => {
    expect(tipPlacement({ top: 0, left: 1312 }, view).top).toBe(8);
  });

  it('junk rect or viewport degrades to an on-screen corner, never NaN', () => {
    const p = tipPlacement(null, null);
    expect(Number.isFinite(p.top) && Number.isFinite(p.right)).toBe(true);
    expect(p).toEqual({ top: 8, right: 8 });
  });
});

describe('sub-chats are filed under the chat they were spawned from', () => {
  const [A, B, C1, C2, D, ORPHAN] = ['session-1000000000001', 'session-1000000000002', 'session-1000000000003', 'session-1000000000004', 'session-1000000000005', 'session-1000000000006'];
  // newest first, as the list arrives
  const sessions = [ORPHAN, D, C2, C1, B, A];
  const threads = { [C1]: { parent: B, kind: 'clone', title: 'Clone 1: read the docs' }, [C2]: { parent: B, kind: 'clone', title: 'Clone 2: check prices' }, [D]: { parent: C1, kind: 'clone', title: '' }, [ORPHAN]: { parent: 'session-1999999999999', kind: 'clone', title: 'Clone 1: lost parent' } };

  it('each sub-chat follows its parent, oldest first, two levels at most; one whose parent is gone stands alone', () => {
    const rows = chatRows(sessions, { [`n:${B}`]: 'Funding' }, 'n', C2, threads);
    expect(rows.map((r) => [r.id, r.depth, r.parent, r.subs])).toEqual([[ORPHAN, 0, null, 0], [B, 0, null, 3], [C1, 1, B, 0], [C2, 1, B, 0], [D, 1, B, 0], [A, 0, null, 0]]);
    // An unnamed sub-chat wears what it was spawned to do, never a bare time.
    expect(rows.find((r) => r.id === C1).label).toBe('Clone 1: read the docs');
    expect(rows.find((r) => r.id === D).label).toBe(shortWhen(D));
    expect(rows.find((r) => r.id === B).label).toBe('Funding');
  });

  it('without links every chat is an ordinary chat', () => {
    expect(chatRows(sessions, {}, 'n', null).every((r) => r.depth === 0 && r.parent === null && r.subs === 0)).toBe(true);
    expect(threadRows([], threads)).toEqual([]);
  });

  it('sub-chats stay folded until their parent is opened; the one on screen always shows', () => {
    const rows = chatRows(sessions, {}, 'n', C2, threads);
    expect(shownRows(rows).map((r) => r.id)).toEqual([ORPHAN, B, C2, A]);
    expect(shownRows(rows, new Set([B])).map((r) => r.id)).toEqual([ORPHAN, B, C1, C2, D, A]);
  });
});
