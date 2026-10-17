/**
 * Pure tests for the Explorer panel's decision helpers (Wave 3):
 *   focusRootsOf            — D6 tree scoping (folder / project / null lens)
 *   focusOwner              — the widen-to-project affordance's target
 *   releaseFocusOnRootClose — D9 second half: root close releases the focus
 *   normalizePanel          — persisted collapse-state boundary validation
 */

import { describe, expect, test } from 'vitest';
import {
  focusRootsOf, focusOwner, releaseFocusOnRootClose,
} from '../../frontend/app/RelinkShell/desk-focus.js';
import {
  normalizeDeskPrefs, normalizePanel, clampPanelWidth,
  PANEL_WIDTH_MIN, PANEL_WIDTH_MAX, PANEL_WIDTH_DEFAULT,
} from '../../frontend/app/windowing/window-storage.js';

const projects = [
  { id: 'p1', name: 'Alpha', folder: '/a', folders: [{ path: '/a' }, { path: '/b' }] },
  { id: 'p2', name: 'Beta', folders: [] },
];

describe('focusRootsOf', () => {
  test('folder focus scopes to exactly that folder', () => {
    expect(focusRootsOf({ kind: 'folder', path: '/x' }, projects, ['/x', '/y'])).toEqual(['/x']);
  });

  test('project focus scopes to the project folders', () => {
    expect(focusRootsOf({ kind: 'project', id: 'p1' }, projects, ['/z'])).toEqual(['/a', '/b']);
  });

  test('a project with no folders scopes to nothing', () => {
    expect(focusRootsOf({ kind: 'project', id: 'p2' }, projects, ['/z'])).toEqual([]);
  });

  test('null focus and a stale project id fall back to allRoots', () => {
    expect(focusRootsOf(null, projects, ['/x'])).toEqual(['/x']);
    expect(focusRootsOf({ kind: 'project', id: 'ghost' }, projects, ['/x'])).toEqual(['/x']);
  });

  test('allRoots defaults to null — the unscoped lens', () => {
    expect(focusRootsOf(null, projects)).toBeNull();
  });
});

describe('focusOwner', () => {
  test('a focused folder some project already holds is owned by it', () => {
    expect(focusOwner({ kind: 'folder', path: '/b' }, projects)?.id).toBe('p1');
  });

  test('an unowned folder, a project focus, and no focus own nothing', () => {
    expect(focusOwner({ kind: 'folder', path: '/nowhere' }, projects)).toBeNull();
    expect(focusOwner({ kind: 'project', id: 'p1' }, projects)).toBeNull();
    expect(focusOwner(null, projects)).toBeNull();
    expect(focusOwner({ kind: 'folder', path: '/b' }, null)).toBeNull();
  });
});

describe('releaseFocusOnRootClose', () => {
  test('closing the focused folder root releases the focus', () => {
    expect(releaseFocusOnRootClose({ kind: 'folder', path: '/a' }, '/a')).toBe(true);
  });

  test('closing any other root, or under project/no focus, releases nothing', () => {
    expect(releaseFocusOnRootClose({ kind: 'folder', path: '/a' }, '/b')).toBe(false);
    expect(releaseFocusOnRootClose({ kind: 'project', id: 'p1' }, '/a')).toBe(false);
    expect(releaseFocusOnRootClose(null, '/a')).toBe(false);
  });
});

describe('normalizePanel', () => {
  test('a valid state is kept, extras dropped', () => {
    expect(normalizePanel({ collapsed: true, __proto__: { x: 1 }, junk: 1 })).toEqual({ collapsed: true });
    expect(normalizePanel({ collapsed: false })).toEqual({ collapsed: false });
  });

  test('garbage degrades to expanded', () => {
    for (const raw of [null, undefined, [], 'x', 7, {}, { collapsed: 'yes' }]) {
      expect(normalizePanel(raw)).toEqual({ collapsed: false });
    }
  });
});

describe('normalizeDeskPrefs — asking is the law of the default', () => {
  test('an explicit boolean survives, extras dropped', () => {
    expect(normalizeDeskPrefs({ confirmDelete: false, junk: 1 })).toEqual({ confirmDelete: false });
    expect(normalizeDeskPrefs({ confirmDelete: true })).toEqual({ confirmDelete: true });
  });

  test('garbage NEVER silences the confirmation — everything else degrades to asking', () => {
    for (const raw of [null, undefined, [], 'x', 7, {}, { confirmDelete: 'no' }, { confirmDelete: 0 }]) {
      expect(normalizeDeskPrefs(raw)).toEqual({ confirmDelete: true });
    }
  });
});

/**
 * The rail's WIDTH — Design note, 2026-07-30: […]
 *
 * A fixed 300px rail is a guess about someone else's monitor, font size and how
 * deep their tree nests. The clamp is the load-bearing part: this value round-
 * trips through localStorage, where anything at all can be written, and it
 * lands directly in a CSS length.
 */
describe('clampPanelWidth — the rail is the operator’s, within reason', () => {
  test('an ordinary width passes through', () => {
    expect(clampPanelWidth(420)).toBe(420);
  });

  test('the bounds hold from both sides', () => {
    expect(clampPanelWidth(10)).toBe(PANEL_WIDTH_MIN);
    expect(clampPanelWidth(99999)).toBe(PANEL_WIDTH_MAX);
    expect(clampPanelWidth(PANEL_WIDTH_MIN)).toBe(PANEL_WIDTH_MIN);
    expect(clampPanelWidth(PANEL_WIDTH_MAX)).toBe(PANEL_WIDTH_MAX);
  });

  test('a fractional drag settles on a whole pixel', () => {
    expect(clampPanelWidth(301.6)).toBe(302);
  });

  test('junk off localStorage falls to the default, never NaN into a CSS length', () => {
    for (const junk of [undefined, null, 'wide', NaN, Infinity, -Infinity, {}, []]) {
      expect(clampPanelWidth(junk)).toBe(PANEL_WIDTH_DEFAULT);
    }
  });

  test('the band is usable — a rail can be narrow, and it can be generous', () => {
    expect(PANEL_WIDTH_MIN).toBeLessThan(PANEL_WIDTH_DEFAULT);
    expect(PANEL_WIDTH_MAX).toBeGreaterThan(PANEL_WIDTH_DEFAULT);
  });
});

describe('normalizePanel carries a width WITHOUT inventing one', () => {
  test('a persisted width survives the round trip, clamped', () => {
    expect(normalizePanel({ collapsed: false, width: 480 })).toEqual({ collapsed: false, width: 480 });
    expect(normalizePanel({ collapsed: true, width: 99999 })).toEqual({ collapsed: true, width: PANEL_WIDTH_MAX });
  });

  test('a junk width is repaired rather than rejecting the whole record', () => {
    expect(normalizePanel({ collapsed: false, width: 'huge' })).toEqual({ collapsed: false, width: PANEL_WIDTH_DEFAULT });
  });

  test('NO width stays absent — the stream rail shares this validator and has none', () => {
    expect(normalizePanel({ collapsed: true })).toEqual({ collapsed: true });
    expect(normalizePanel({ collapsed: false })).toEqual({ collapsed: false });
  });

  test('the collapse contract is untouched — a bad record still reads as expanded', () => {
    for (const bad of [null, undefined, 'x', [], { collapsed: 'yes' }]) {
      expect(normalizePanel(bad)).toEqual({ collapsed: false });
    }
  });
});
