/**
 * PANE LAYOUT — the stream split, so several sittings are on screen at once.
 *
 * Design note, 2026-08-29: […]
 *
 * The laws that make that safe, and this file is all of them:
 *   1. a pane is a VIEW of a tab — the strip stays the one source of truth;
 *   2. a tab is in AT MOST ONE pane, ever;
 *   3. changing the shape never ends a conversation;
 *   4. exactly one pane hears the keyboard.
 *
 * Pure functions, real inputs, no mocks.
 */
import { describe, test, expect } from 'vitest';
import {
  LAYOUTS, MAX_PANES, AREA_NAMES, layoutFor, emptyPanes, setLayout, assignPane,
  paneOf, tabInPane, focusPane, prunePanes, activeTabId, showTab, isSplit,
  serializePanes, normalizePanes,
} from '../../core/runtime/pane-layout.js';

const tabs = (...ids) => ids.map((id) => ({ id }));
const quadWith = (...ids) => ids.reduce(
  (s, id, i) => (id ? assignPane(s, i, id) : s),
  setLayout(emptyPanes(), 'quad'),
);

describe('the shapes on offer', () => {
  test('EVERY SHAPE FOUNDER NAMED, and nothing past four', () => {
    expect(LAYOUTS.map((l) => l.key)).toEqual(['single', 'split-v', 'split-h', 'three', 'quad']);
    expect(LAYOUTS.map((l) => l.panes)).toEqual([1, 2, 2, 3, 4]);
    // […]
    expect(Math.max(...LAYOUTS.map((l) => l.panes))).toBe(MAX_PANES);
    expect(MAX_PANES).toBe(4);
  });

  test('both splits he asked for exist and are genuinely different', () => {
    const v = layoutFor('split-v');
    const h = layoutFor('split-h');
    expect(v.panes).toBe(2);
    expect(h.panes).toBe(2);
    expect(v.template).not.toBe(h.template);   // side by side vs stacked
    expect(v.columns).toBe('1fr 1fr');         // two columns, one row
    expect(h.rows).toBe('1fr 1fr');            // one column, two rows
  });

  test('every shape carries geometry for exactly its own panes', () => {
    // The grid and the pane count live in one record so they cannot drift —
    // a template naming an area no pane occupies paints an empty hole.
    for (const l of LAYOUTS) {
      const used = AREA_NAMES.slice(0, l.panes);
      for (const name of used) expect(l.template, l.key).toContain(name);
      for (const name of AREA_NAMES.slice(l.panes)) {
        expect(l.template, `${l.key} must not name ${name}`).not.toContain(name);
      }
    }
  });

  test('an unknown shape falls back to the plain stream, never to nothing', () => {
    expect(layoutFor('six-way').key).toBe('single');
    expect(layoutFor(undefined).key).toBe('single');
  });
});

describe('LAW: changing the shape never ends a conversation', () => {
  test('growing keeps every sitting exactly where it was', () => {
    // An operator splitting a view expects what they were reading to stay put.
    const two = assignPane(assignPane(setLayout(emptyPanes(), 'split-v'), 0, 't1'), 1, 't2');
    const four = setLayout(two, 'quad');
    expect(four.slots).toEqual(['t1', 't2', null, null]);
  });

  test('THE REGRESSION GUARD: shrinking drops the VIEW, never the tab', () => {
    // This is the one that could lose someone's work. Going 4 → 1 must leave
    // the three displaced sittings alone — they are still tabs on the strip,
    // still live, one press from view. The state only stops SHOWING them.
    const four = quadWith('t1', 't2', 't3', 't4');
    const one = setLayout(four, 'single');
    expect(one.slots).toEqual(['t1']);
    // Nothing here can close a tab — the model has no such power, which is
    // exactly why panes are views. Proven by the type of thing it returns:
    expect(Object.keys(one).sort()).toEqual(['focused', 'layout', 'slots']);
  });

  test('focus is carried into the new shape, clamped into panes that exist', () => {
    const four = focusPane(quadWith('t1', 't2', 't3', 't4'), 3);
    expect(setLayout(four, 'single').focused).toBe(0);
    expect(setLayout(four, 'three').focused).toBe(2);
    expect(setLayout(four, 'quad').focused).toBe(3);
  });

  test('an unknown shape is refused without disturbing the one in use', () => {
    const four = quadWith('t1', 't2');
    expect(setLayout(four, 'nonsense')).toBe(four);
  });
});

describe('LAW: a tab is in at most one pane', () => {
  test('THE CORE INVARIANT: placing a shown tab MOVES it, never copies it', () => {
    // Two panes on one session is two composers writing into one conversation
    // — the same error the tear-out law already refuses.
    const four = quadWith('t1', 't2');
    const moved = assignPane(four, 3, 't1');
    expect(moved.slots).toEqual([null, 't2', null, 't1']);
    expect(moved.slots.filter((id) => id === 't1')).toHaveLength(1);
  });

  test('no sequence of placements can duplicate a sitting', () => {
    let s = setLayout(emptyPanes(), 'quad');
    for (const pane of [0, 1, 2, 3, 1, 0, 3, 2, 0]) s = assignPane(s, pane, 't1');
    expect(s.slots.filter((id) => id === 't1')).toHaveLength(1);
  });

  test('emptying a pane takes nothing else with it, and does not move focus', () => {
    const four = focusPane(quadWith('t1', 't2', 't3'), 2);
    const cleared = assignPane(four, 0, null);
    expect(cleared.slots).toEqual([null, 't2', 't3', null]);
    expect(cleared.focused).toBe(2);
  });

  test('placing a sitting focuses its pane — you put it there to look at it', () => {
    expect(assignPane(setLayout(emptyPanes(), 'quad'), 2, 't9').focused).toBe(2);
  });

  test('a pane that does not exist is not written to', () => {
    const two = setLayout(emptyPanes(), 'split-v');
    for (const pane of [-1, 2, 99, 1.5, null, undefined, '1']) {
      expect(assignPane(two, pane, 't1'), String(pane)).toBe(two);
    }
  });
});

describe('LAW: exactly one pane hears the keyboard', () => {
  test('focus is a single index, always inside the panes that exist', () => {
    const four = quadWith('t1', 't2', 't3', 't4');
    for (const p of [0, 1, 2, 3]) expect(focusPane(four, p).focused).toBe(p);
  });

  test('a focus outside the shape is IGNORED, never clamped into a stranger', () => {
    // Clamping would silently hand the keyboard to a pane the operator did
    // not choose — worse than doing nothing, because it looks deliberate.
    const four = focusPane(quadWith('t1', 't2', 't3', 't4'), 1);
    for (const p of [-1, 4, 99, null, 'a']) expect(focusPane(four, p).focused).toBe(1);
  });

  test('the window always has a bound sitting to answer for', () => {
    // Title and controls read this. A split with the live pane empty must
    // still name SOMEBODY, or the chrome answers for nobody.
    const four = focusPane(quadWith(null, 't2', 't3'), 0);
    expect(tabInPane(four, 0)).toBeNull();
    expect(activeTabId(four)).toBe('t2');
    expect(activeTabId(focusPane(four, 2))).toBe('t3');
    expect(activeTabId(setLayout(emptyPanes(), 'quad'))).toBeNull();
  });
});

describe('showing a tab without being told where', () => {
  test('a sitting already on screen just takes focus — nothing is rearranged', () => {
    const four = focusPane(quadWith('t1', 't2', 't3'), 0);
    const shown = showTab(four, 't3');
    expect(shown.slots).toEqual(four.slots);
    expect(shown.focused).toBe(2);
  });

  test('a new sitting takes the FIRST empty pane', () => {
    const four = quadWith('t1', null, 't3');
    expect(showTab(four, 't9').slots).toEqual(['t1', 't9', 't3', null]);
  });

  test('with every pane full it replaces the FOCUSED one — the operator’s own cursor', () => {
    // The least surprising thing to displace is where you are already looking,
    // and the displaced sitting is still a tab on the strip.
    const four = focusPane(quadWith('t1', 't2', 't3', 't4'), 1);
    expect(showTab(four, 't9').slots).toEqual(['t1', 't9', 't3', 't4']);
  });
});

describe('reconciling with the strip', () => {
  test('a CLOSED tab empties its pane and keeps the shape', () => {
    // An operator who split into four still has four panes after closing one
    // conversation, and the empty pane invites the next.
    const four = quadWith('t1', 't2', 't3', 't4');
    const pruned = prunePanes(four, tabs('t1', 't3'));
    expect(pruned.slots).toEqual(['t1', null, 't3', null]);
    expect(pruned.layout).toBe('quad');
  });

  test('an empty strip empties every pane rather than pointing at ghosts', () => {
    expect(prunePanes(quadWith('t1', 't2'), []).slots).toEqual([null, null, null, null]);
    expect(prunePanes(quadWith('t1'), null).slots).toEqual([null, null, null, null]);
  });

  test('paneOf answers honestly for a sitting that is not shown', () => {
    const four = quadWith('t1', 't2');
    expect(paneOf(four, 't2')).toBe(1);
    expect(paneOf(four, 't7')).toBe(-1);
    expect(paneOf(four, null)).toBe(-1);
  });
});

describe('the single pane is still just the stream', () => {
  test('unsplit is not "a grid of one" — the desk paints no pane chrome', () => {
    expect(isSplit(emptyPanes())).toBe(false);
    expect(isSplit(setLayout(emptyPanes(), 'split-v'))).toBe(true);
    expect(isSplit(setLayout(setLayout(emptyPanes(), 'quad'), 'single'))).toBe(false);
  });
});

describe('surviving a restart', () => {
  test('the SHAPE is remembered and the sittings with it', () => {
    const four = focusPane(quadWith('t1', null, 't3', 't4'), 2);
    const restored = normalizePanes(JSON.parse(JSON.stringify(serializePanes(four))));
    expect(restored).toEqual(four);
  });

  test('a corrupt record becomes the plain stream, never a half-built grid', () => {
    for (const bad of [null, undefined, 42, 'quad', [], { layout: 'quad', slots: 'nope' }]) {
      const r = normalizePanes(bad);
      expect(r.slots.length, JSON.stringify(bad)).toBe(layoutFor(r.layout).panes);
      expect(r.focused).toBeGreaterThanOrEqual(0);
      expect(r.focused).toBeLessThan(r.slots.length);
    }
  });

  test('a stored record can never restore a DUPLICATED sitting', () => {
    // Hand-edited or version-skewed storage must not be able to break the one
    // invariant the live model enforces.
    const r = normalizePanes({ layout: 'quad', slots: ['t1', 't1', 't1', 't2'], focused: 0 });
    expect(r.slots).toEqual(['t1', null, null, 't2']);
  });

  test('a stored record is trimmed to its own shape', () => {
    expect(normalizePanes({ layout: 'split-v', slots: ['a', 'b', 'c', 'd'], focused: 3 }).slots)
      .toEqual(['a', 'b']);
    expect(normalizePanes({ layout: 'quad', slots: ['a'], focused: 0 }).slots)
      .toEqual(['a', null, null, null]);
  });
});
