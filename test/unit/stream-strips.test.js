/**
 * stream-strips — which stream window owns the operator's folder choice, and
 * moving a sitting between two of them.
 *
 * RULE 0: no mock anywhere. `groundTargetId` is pure and is called with real
 * records. The registry functions are exercised for real — registering,
 * stamping and transferring against real strip objects whose open/close are
 * real closures over real arrays, not spies. What they do is asserted by
 * looking at the arrays afterwards, never by asking whether a fake was called.
 *
 * THE TWO BUGS THIS PINS (reported 2026-08-30):
 *   - with focus on the right panel's stream, an attachment landed on the tab
 *     open on the left;
 *   - dragging a tab and dropping it into the other side did nothing.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { gapForPointer as gapOf, indexForGap, releasedOutside } from '../../frontend/app/RelinkShell/use-tab-drag.js';
import {
  STREAM_APP, registerStrip, stripFor, stripEntries, groundTargetId,
  markStripFocused, claimDrag, takeDragClaim, transferTab, stripsVersion,
  subscribeStrips,
} from '../../frontend/app/RelinkShell/stream-strips.js';

/**
 * A strip standing in for one window's `useDeskTabs`.
 *
 * ⚠️ `adopt` MIRRORS THE REAL HOOK, and that is not decoration. The first
 * version of this helper had an `open` that simply pushed whatever it was
 * handed — so `transferTab` calling `open(tab)` passed here and FAILED live,
 * because the real `open({kind, neumaId, name})` mints a fresh id and carries
 * no session: the sitting would have arrived as a different conversation
 * wearing the same name. A stand-in whose contract differs from the real thing
 * proves only itself. If `useDeskTabs.adopt` changes shape, change this WITH
 * it — or the test goes on passing while the app breaks.
 */
const makeStrip = (tabs = [], houseId = null) => {
  const state = { tabs: [...tabs], grounds: {} };
  return {
    state,
    api: {
      focusedId: state.tabs[0]?.id ?? null,
      ground: null,
      setGround: (id, focus) => { state.grounds[id] = focus; },
      get tabs() { return state.tabs; },
      adopt: (tab) => {
        if (!tab?.id || !tab?.neumaId) return { tab: null, refusal: { reason: 'that is not a sitting this strip can take' } };
        if (state.tabs.some((t) => t.id === tab.id)) return { tab, refusal: { reason: 'that sitting is already in this stream' } };
        // Verbatim — id, sessionId and ground all survive the move.
        state.tabs.push(tab);
        return { tab, refusal: null };
      },
      close: (id) => { state.tabs = state.tabs.filter((t) => t.id !== id); },
      isHouse: (id) => id === houseId,
    },
  };
};

// The registry is module state, so each test starts from a clean desk.
let cleanups = [];
beforeEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  // Consume any claim a previous test left behind.
  takeDragClaim('tab-1');
});
const register = (id, strip) => { cleanups.push(registerStrip(id, strip.api)); };

describe('which stream owns the folder choice', () => {
  test('with one strip it is the desk — the single-window case is untouched', () => {
    register(STREAM_APP, makeStrip());
    expect(groundTargetId(stripEntries())).toBe(STREAM_APP);
  });

  test('THE BUG: the last-focused stream wins, not the desk by default', () => {
    register(STREAM_APP, makeStrip());
    register('chat#2', makeStrip());
    // Nothing focused yet — the desk holds it, as it always did.
    expect(groundTargetId(stripEntries())).toBe(STREAM_APP);
    // The operator clicks into the second stream.
    markStripFocused('chat#2');
    expect(groundTargetId(stripEntries())).toBe('chat#2');
    // …and back.
    markStripFocused(STREAM_APP);
    expect(groundTargetId(stripEntries())).toBe(STREAM_APP);
  });

  test('focusing the EXPLORER does not move the target — only streams stamp', () => {
    register(STREAM_APP, makeStrip());
    register('chat#2', makeStrip());
    markStripFocused('chat#2');
    // The Explorer is not a stream and never registers, so picking a folder in
    // it cannot hand the write back to the desk. This is the whole reason the
    // rule is "last stream focused" and not "frontmost window".
    markStripFocused('explorer');
    expect(groundTargetId(stripEntries())).toBe('chat#2');
  });

  test('a closed stream stops being the target', () => {
    register(STREAM_APP, makeStrip());
    const drop = registerStrip('chat#2', makeStrip().api);
    markStripFocused('chat#2');
    expect(groundTargetId(stripEntries())).toBe('chat#2');
    drop();
    expect(groundTargetId(stripEntries())).toBe(STREAM_APP);
  });

  test('republishing a strip does NOT reset its place in the order', () => {
    const desk = makeStrip();
    register(STREAM_APP, desk);
    register('chat#2', makeStrip());
    markStripFocused('chat#2');
    // The desk's strip republishes on every ground change. If that reset the
    // stamp, the write would silently jump back to the desk mid-session.
    cleanups.push(registerStrip(STREAM_APP, desk.api));
    expect(groundTargetId(stripEntries())).toBe('chat#2');
  });

  test('no strips at all is null, not a guess', () => {
    expect(groundTargetId([])).toBe(null);
    expect(groundTargetId(null)).toBe(null);
  });
});

describe('the ground lands on the stream the operator is in', () => {
  test('writing through the target strip reaches THAT window, not the desk', () => {
    const desk = makeStrip([{ id: 'tab-desk', name: 'TEASEL', neumaId: 'teasel', kind: 'local' }]);
    const second = makeStrip([{ id: 'tab-right', name: 'POPLAR', neumaId: 'poplar', kind: 'local' }]);
    register(STREAM_APP, desk);
    register('chat#2', second);
    markStripFocused('chat#2');

    const target = stripFor(groundTargetId(stripEntries()));
    target.setGround(target.focusedId, { kind: 'folder', path: '/mnt/poplar' });

    // The right stream got it…
    expect(second.state.grounds['tab-right']).toEqual({ kind: 'folder', path: '/mnt/poplar' });
    // …and the left one was not touched, which is the bug.
    expect(desk.state.grounds).toEqual({});
  });
});

describe('THE RENDER LOOP — a no-op must never wake the desk', () => {
  // React error #185 (maximum update depth), hit live 2026-08-30: the desk
  // subscribes to this registry, so any notify re-renders it, which re-renders
  // every stream window, which re-registers its strip. If an unchanged
  // re-registration notifies, that circuit never opens and the app dies.
  test('re-registering identical values does NOT notify', () => {
    const strip = makeStrip([{ id: 'tab-1', name: 'SPRUCE', neumaId: 'spruce', kind: 'local', sessionId: 'sess-spruce' }]);
    register(STREAM_APP, strip);

    let woken = 0;
    const unsub = subscribeStrips(() => { woken += 1; });
    // Exactly what a parent re-render does — same values, same callbacks.
    cleanups.push(registerStrip(STREAM_APP, strip.api));
    cleanups.push(registerStrip(STREAM_APP, strip.api));
    cleanups.push(registerStrip(STREAM_APP, strip.api));
    unsub();
    expect(woken).toBe(0);
  });

  test('a REAL change still notifies — the guard must not go deaf', () => {
    const strip = makeStrip([{ id: 'tab-1', name: 'SPRUCE', neumaId: 'spruce', kind: 'local', sessionId: 'sess-spruce' }]);
    register(STREAM_APP, strip);

    let woken = 0;
    const unsub = subscribeStrips(() => { woken += 1; });
    cleanups.push(registerStrip(STREAM_APP, { ...strip.api, focusedId: 'tab-2' }));
    expect(woken).toBe(1);
    cleanups.push(registerStrip(STREAM_APP, {
      ...strip.api, focusedId: 'tab-2', ground: { kind: 'folder', path: '/mnt/x' },
    }));
    expect(woken).toBe(2);
    unsub();
  });

  test('re-focusing the window that is already focused does NOT notify', () => {
    register(STREAM_APP, makeStrip());
    markStripFocused(STREAM_APP);
    let woken = 0;
    const unsub = subscribeStrips(() => { woken += 1; });
    markStripFocused(STREAM_APP);
    markStripFocused(STREAM_APP);
    unsub();
    expect(woken).toBe(0);
  });

  test('focus moving to a DIFFERENT window still notifies', () => {
    register(STREAM_APP, makeStrip());
    register('chat#2', makeStrip());
    markStripFocused(STREAM_APP);
    let woken = 0;
    const unsub = subscribeStrips(() => { woken += 1; });
    markStripFocused('chat#2');
    unsub();
    expect(woken).toBe(1);
    expect(groundTargetId(stripEntries())).toBe('chat#2');
  });
});

describe('the registry tells the desk when to re-read', () => {
  test('registering, stamping and dropping all bump the version', () => {
    const seen = [];
    const unsub = subscribeStrips(() => seen.push(stripsVersion()));
    const drop = registerStrip('chat#9', makeStrip().api);
    markStripFocused('chat#9');
    drop();
    unsub();
    expect(seen).toHaveLength(3);
    // Strictly increasing — a snapshot compared by identity must never repeat.
    expect(seen[0]).toBeLessThan(seen[1]);
    expect(seen[1]).toBeLessThan(seen[2]);
  });
});

describe('transferring a sitting between streams', () => {
  test('the tab LEAVES one strip and JOINS the other', () => {
    const left = makeStrip([{ id: 'tab-1', name: 'SPRUCE', neumaId: 'spruce', kind: 'local', sessionId: 'sess-spruce' }, { id: 'tab-2', name: 'BIRCH', neumaId: 'birch', kind: 'local' }]);
    const right = makeStrip([{ id: 'tab-3', name: 'POPLAR', neumaId: 'poplar', kind: 'local' }]);
    register(STREAM_APP, left);
    register('chat#2', right);

    expect(transferTab(STREAM_APP, 'chat#2', 'tab-1')).toEqual({ ok: true });

    expect(left.state.tabs.map((t) => t.id)).toEqual(['tab-2']);
    expect(right.state.tabs.map((t) => t.id)).toEqual(['tab-3', 'tab-1']);
    // Never in both at once: one conversation drawn twice is two composers
    // writing into one session.
    expect(left.state.tabs.find((t) => t.id === 'tab-1')).toBeUndefined();
    // THE CONVERSATION MOVES, not a lookalike: same id, same bound session.
    // `open` would have minted a new id and dropped sessionId — the sitting
    // would have arrived as a different chat wearing the same name.
    const landed = right.state.tabs.find((t) => t.id === 'tab-1');
    expect(landed.sessionId).toBe('sess-spruce');
    expect(landed.name).toBe('SPRUCE');
  });

  test('THE HOUSE TAB MOVES LIKE ANY OTHER', () => {
    // It was refused here once, and that refusal was the bug operators kept hitting:
    // the house tab is merely the OLDEST, so it is the first tab on the strip
    // and the ONLY tab in a fresh window — the very one an operator grabs. The
    // role is derived from age, so the source re-designates on its own.
    const left = makeStrip([
      { id: 'tab-house', name: 'HOUSE', neumaId: 'house', kind: 'local' },
      { id: 'tab-2', name: 'TWO', neumaId: 'two', kind: 'local' },
    ], 'tab-house');
    const right = makeStrip([{ id: 'r1', name: 'ONE', neumaId: 'one', kind: 'local' }]);
    register(STREAM_APP, left);
    register('chat#2', right);

    expect(transferTab(STREAM_APP, 'chat#2', 'tab-house')).toEqual({ ok: true });
    expect(right.state.tabs.map((t) => t.id)).toContain('tab-house');
    expect(left.state.tabs.map((t) => t.id)).toEqual(['tab-2']);
  });

  test('the LAST sitting in a window may not leave — that would trap the window', () => {
    // No tabs means no strip, and the + TAB door lives on the strip: a window
    // drained to zero could never open another sitting.
    const left = makeStrip([{ id: 'tab-only', name: 'ONLY', neumaId: 'only', kind: 'local' }]);
    const right = makeStrip([{ id: 'r1', name: 'ONE', neumaId: 'one', kind: 'local' }]);
    register(STREAM_APP, left);
    register('chat#2', right);

    const out = transferTab(STREAM_APP, 'chat#2', 'tab-only');
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/only sitting in this stream/);
    // Refused means NOTHING moved — not a half-move.
    expect(left.state.tabs).toHaveLength(1);
    expect(right.state.tabs).toHaveLength(1);
  });

  test('a refusal from the receiving strip leaves the tab where it was', () => {
    const left = makeStrip([
      { id: 'tab-1', name: 'SPRUCE', neumaId: 'spruce', kind: 'local', sessionId: 'sess-spruce' },
      { id: 'tab-keep', name: 'KEEP', neumaId: 'keep', kind: 'local' },
    ]);
    const right = makeStrip();
    right.api.adopt = () => ({ tab: null, refusal: { reason: 'the rig has no slot free' } });
    register(STREAM_APP, left);
    register('chat#2', right);

    const out = transferTab(STREAM_APP, 'chat#2', 'tab-1');
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no slot free/);
    // THE ORDER MATTERS: adopt before close, so a refusal cannot lose a sitting.
    expect(left.state.tabs.map((t) => t.id)).toEqual(['tab-1', 'tab-keep']);
  });

  test('dropping onto the strip it came from is refused, not a duplicate', () => {
    const left = makeStrip([
      { id: 'tab-1', name: 'SPRUCE', neumaId: 'spruce', kind: 'local', sessionId: 'sess-spruce' },
      { id: 'tab-keep', name: 'KEEP', neumaId: 'keep', kind: 'local' },
    ]);
    register(STREAM_APP, left);
    const out = transferTab(STREAM_APP, STREAM_APP, 'tab-1');
    expect(out.ok).toBe(false);
    expect(left.state.tabs).toHaveLength(2);
  });

  test('a window closed mid-drag refuses instead of throwing', () => {
    register(STREAM_APP, makeStrip([{ id: 'tab-1', name: 'SPRUCE', neumaId: 'spruce', kind: 'local', sessionId: 'sess-spruce' }]));
    const out = transferTab(STREAM_APP, 'chat#7', 'tab-1');
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no longer open/);
  });

  test('a tab that is no longer on the source strip refuses', () => {
    register(STREAM_APP, makeStrip());
    register('chat#2', makeStrip());
    const out = transferTab(STREAM_APP, 'chat#2', 'tab-gone');
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no longer on the strip/);
  });
});

describe('a transferred tab must NOT also tear out a window', () => {
  test('the receiving strip claims the drag, and the claim is consumed once', () => {
    // The source strip's dragend fires after the drop and would otherwise read
    // […] and open a third window for a tab that just
    // moved — undoing the gesture and spending a portal to do it.
    claimDrag('tab-1');
    expect(takeDragClaim('tab-1')).toBe(true);
    // Consumed: a later, unrelated drag of the same tab is judged on its own,
    // so a genuine tear-out still works.
    expect(takeDragClaim('tab-1')).toBe(false);
  });

  test('an unclaimed drag still tears out — the old gesture is intact', () => {
    expect(takeDragClaim('tab-never-claimed')).toBe(false);
  });

  test('a claim on one tab does not cover another', () => {
    claimDrag('tab-1');
    expect(takeDragClaim('tab-2')).toBe(false);
    expect(takeDragClaim('tab-1')).toBe(true);
  });
});

/**
 * THE DROP CARET'S ARITHMETIC.
 *
 * Ruling, 2026-08-30: a tab held over the right side of another shows it will
 * drop to the right; held over the left side, it drops to the left.
 *
 * A caret sits in a GAP (0..n), but `moveTab` takes a FINAL INDEX — and it
 * splices the tab out before inserting, so every gap to the right of where the
 * tab started shifts down by one. Getting this wrong lands a rightward drag one
 * place short of the caret EVERY time, which reads as "the indicator lies".
 *
 * Calls the production hook's exported pure helpers directly.
 */

describe('which side of a tab the cursor is on', () => {
  const rect = { left: 100, width: 80 }; // midpoint 140

  test('the left half means BEFORE this tab', () => {
    expect(gapOf(101, rect, 3)).toBe(3);
    expect(gapOf(139, rect, 3)).toBe(3);
  });

  test('the right half means AFTER it', () => {
    expect(gapOf(140, rect, 3)).toBe(4);
    expect(gapOf(179, rect, 3)).toBe(4);
  });

  test('the very first tab can be aimed in front of', () => {
    expect(gapOf(101, rect, 0)).toBe(0);
  });
});

describe('gap -> moveTab index', () => {
  const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  test('dragging RIGHT compensates for the splice', () => {
    // 'a' dropped in the gap after 'c' (gap 3) must end at index 2 — the tab is
    // removed first, so gap 3 in the old list is index 2 in the new one.
    expect(indexForGap(tabs, 'a', 3)).toBe(2);
    // …all the way to the end.
    expect(indexForGap(tabs, 'a', 4)).toBe(3);
  });

  test('dragging LEFT does not compensate — nothing shifted', () => {
    expect(indexForGap(tabs, 'd', 0)).toBe(0);
    expect(indexForGap(tabs, 'd', 1)).toBe(1);
  });

  test('dropping either side of where it already sits is a no-op move', () => {
    // 'b' is at index 1: gap 1 is its own left edge, gap 2 its own right edge.
    expect(indexForGap(tabs, 'b', 1)).toBe(1);
    expect(indexForGap(tabs, 'b', 2)).toBe(1);
  });

  test('a tab arriving from ANOTHER strip does not compensate', () => {
    // It is not in this list yet, so no splice happens ahead of it and the gap
    // IS the index. Compensating here would land every transfer one place left.
    expect(indexForGap(tabs, 'from-elsewhere', 2)).toBe(2);
    expect(indexForGap(tabs, 'from-elsewhere', 0)).toBe(0);
  });
});

describe('a transfer lands where the caret pointed', () => {
  test('the sitting takes the gap it was aimed at, not the end', () => {
    const left = makeStrip([
      { id: 'tab-x', name: 'SPRUCE', neumaId: 'spruce', kind: 'local' },
      { id: 'tab-keep', name: 'KEEP', neumaId: 'keep', kind: 'local' },
    ]);
    const right = makeStrip([
      { id: 'r1', name: 'ONE', neumaId: 'one', kind: 'local' },
      { id: 'r2', name: 'TWO', neumaId: 'two', kind: 'local' },
    ]);
    // The real strip's `move`, mirroring the model: splice out, insert at index.
    right.api.move = (id, to) => {
      const from = right.state.tabs.findIndex((t) => t.id === id);
      if (from === -1) return;
      const next = [...right.state.tabs];
      const [moved] = next.splice(from, 1);
      next.splice(Math.min(next.length, Math.max(0, to)), 0, moved);
      right.state.tabs = next;
    };
    register(STREAM_APP, left);
    register('chat#2', right);

    // Aimed at the very front of the receiving strip.
    expect(transferTab(STREAM_APP, 'chat#2', 'tab-x', 0)).toEqual({ ok: true });
    expect(right.state.tabs.map((t) => t.id)).toEqual(['tab-x', 'r1', 'r2']);
  });

  test('no gap given still works — it simply lands at the end', () => {
    const left = makeStrip([
      { id: 'tab-y', name: 'YY', neumaId: 'yy', kind: 'local' },
      { id: 'tab-keep', name: 'KEEP', neumaId: 'keep', kind: 'local' },
    ]);
    const right = makeStrip([{ id: 'r1', name: 'ONE', neumaId: 'one', kind: 'local' }]);
    register(STREAM_APP, left);
    register('chat#2', right);
    expect(transferTab(STREAM_APP, 'chat#2', 'tab-y')).toEqual({ ok: true });
    expect(right.state.tabs.map((t) => t.id)).toEqual(['r1', 'tab-y']);
  });
});

describe('THE DRAIN LAW — docking a torn-out sitting back (2026-09-15)', () => {
  test('a popped-out window drains into the desk and CLOSES', () => {
    const tab = { id: 'tab-1', neumaId: 'hazel', name: 'Hazel' };
    const popout = makeStrip([tab]);
    let closed = false;
    // The close door rides only POPPED-OUT strips (StripRegistrar publishes it
    // for every stream window that is not the desk's own).
    popout.api.closeWindow = () => { closed = true; };
    register('chat#2', popout);
    const desk = makeStrip([{ id: 'house-tab', neumaId: 'juniper', name: 'Juniper' }]);
    register(STREAM_APP, desk);

    const out = transferTab('chat#2', STREAM_APP, 'tab-1', 1);
    expect(out).toEqual({ ok: true });
    expect(closed).toBe(true);                                        // the window closed
    expect(popout.state.tabs).toEqual([]);                            // its sitting left
    expect(desk.state.tabs.some((t) => t.id === 'tab-1')).toBe(true); // and landed home
  });

  test("the desk's own strip still refuses to drain — no close door, no close", () => {
    const desk = makeStrip([{ id: 'last', neumaId: 'hazel', name: 'Hazel' }]);
    register(STREAM_APP, desk);
    const other = makeStrip([{ id: 'other-tab', neumaId: 'juniper', name: 'Juniper' }]);
    register('chat#2', other);

    const out = transferTab(STREAM_APP, 'chat#2', 'last', 0);
    expect(out.ok).toBe(false);
    expect(out.error).toContain('only sitting in this stream');
    expect(desk.state.tabs.length).toBe(1); // nothing moved
  });
});

// THE DELIBERATE TEAR-OUT (ruling, 2026-10-05: a tab becomes its own window
// only when it is dragged and dropped outside the window).
describe('releasedOutside — only a release past the window\'s own edge tears out', () => {
  const region = { left: 100, top: 50, right: 900, bottom: 650 };

  it('let go just below the strip, still inside the window → stays', () => {
    expect(releasedOutside({ point: { x: 300, y: 90 }, region, leftApp: false })).toBe(false);
  });

  it('let go in the middle of its own window → stays', () => {
    expect(releasedOutside({ point: { x: 500, y: 350 }, region, leftApp: false })).toBe(false);
  });

  it('let go on the desk beside the window → its own window', () => {
    expect(releasedOutside({ point: { x: 950, y: 350 }, region, leftApp: false })).toBe(true);
    expect(releasedOutside({ point: { x: 500, y: 20 }, region, leftApp: false })).toBe(true);
  });

  it('carried out of the app altogether → its own window', () => {
    expect(releasedOutside({ point: { x: 500, y: 350 }, region, leftApp: true })).toBe(true);
  });
});
