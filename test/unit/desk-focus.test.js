/**
 * The pure core of a desk window's working focus (Wave 1, D1/D7/D11): the
 * boundary validator over anything claiming to be a focus, equality, the
 * strip label, the coding-source hint a focus carries, and the D11
 * spawn/restore decision. A focus is a folder or nothing — Projects were
 * removed (Design note, 2026-11-10, so a saved project focus loads as nothing.
 * Proven directly with real inputs — no React, no mocks.
 */

import { describe, test, expect } from 'vitest';
import {
  normalizeFocus, normalizeSlot, focusEquals, focusLabel,
  focusToolFrame, resolveSpawnFocus, sittingGround,
} from '../../frontend/app/RelinkShell/desk-focus.js';

describe('normalizeFocus — the boundary validator', () => {
  test('a saved PROJECT focus (Projects removed 2026-11-10) loads as nothing', () => {
    expect(normalizeFocus({ kind: 'project', id: 'p1' })).toBeNull();
  });

  test('a valid folder focus passes (absolute path)', () => {
    expect(normalizeFocus({ kind: 'folder', path: '/repos/voice' })).toEqual({ kind: 'folder', path: '/repos/voice' });
  });

  test('extra fields are dropped on the floor — the input is never spread', () => {
    const out = normalizeFocus({ kind: 'folder', path: '/a', id: 'smuggled', extra: 1 });
    expect(out).toEqual({ kind: 'folder', path: '/a' });
    expect(Object.keys(out)).toEqual(['kind', 'path']);
  });

  test('a hostile __proto__ key (as parsed JSON delivers it) is discarded and pollutes nothing', () => {
    const raw = JSON.parse('{"kind":"folder","path":"/x","__proto__":{"polluted":true}}');
    const out = normalizeFocus(raw);
    expect(out).toEqual({ kind: 'folder', path: '/x' });
    expect(out.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined(); // Object.prototype untouched
  });

  test('inherited fields do not count — Object.hasOwn discipline', () => {
    expect(normalizeFocus(Object.create({ kind: 'folder', path: '/a' }))).toBeNull();
  });

  test('non-objects and null are null', () => {
    for (const raw of [null, undefined, 'folder', 42, true, ['folder']]) {
      expect(normalizeFocus(raw)).toBeNull();
    }
  });

  test('an unknown or miscased kind is null', () => {
    expect(normalizeFocus({ kind: 'FOLDER', path: '/a' })).toBeNull();
    expect(normalizeFocus({ kind: 'file', path: '/a' })).toBeNull();
    expect(normalizeFocus({ path: '/a' })).toBeNull(); // no kind at all
  });

  test('a folder focus needs a non-empty ABSOLUTE string path', () => {
    expect(normalizeFocus({ kind: 'folder' })).toBeNull();
    expect(normalizeFocus({ kind: 'folder', path: '' })).toBeNull();
    expect(normalizeFocus({ kind: 'folder', path: 'repos/voice' })).toBeNull();
    expect(normalizeFocus({ kind: 'folder', path: '../../etc' })).toBeNull();
    expect(normalizeFocus({ kind: 'folder', path: ['/a'] })).toBeNull();
  });

  test('control characters in a path are rejected', () => {
    // Built with fromCharCode — the harness mangles \uXXXX literals.
    const nul = String.fromCharCode(0);
    const nl = String.fromCharCode(10);
    const esc = String.fromCharCode(27);
    const del = String.fromCharCode(127);
    expect(normalizeFocus({ kind: 'folder', path: `/tmp/${nul}x` })).toBeNull();
    expect(normalizeFocus({ kind: 'folder', path: `/tmp/a${nl}b` })).toBeNull();
    expect(normalizeFocus({ kind: 'folder', path: `/tmp/${del}` })).toBeNull();
    expect(normalizeFocus({ kind: 'folder', path: `/tmp/a${esc}b` })).toBeNull();
  });
});

describe('focusEquals — value equality over normalized focus', () => {
  test('null equals null and nothing else', () => {
    expect(focusEquals(null, null)).toBe(true);
    expect(focusEquals(null, { kind: 'folder', path: '/a' })).toBe(false);
    expect(focusEquals({ kind: 'folder', path: '/a' }, null)).toBe(false);
  });

  test('the same folder is equal; another folder is not', () => {
    expect(focusEquals({ kind: 'folder', path: '/a' }, { kind: 'folder', path: '/a' })).toBe(true);
    expect(focusEquals({ kind: 'folder', path: '/a' }, { kind: 'folder', path: '/b' })).toBe(false);
  });
});

describe('focusLabel — what the strip shows (D7)', () => {
  test('folder focus → its basename', () => {
    expect(focusLabel({ kind: 'folder', path: '/repos/voice' })).toEqual({ kind: 'folder', folder: { name: 'voice' } });
    expect(focusLabel({ kind: 'folder', path: '/a/b' })).toEqual({ kind: 'folder', folder: { name: 'b' } });
  });

  test('no focus → null (the strip renders nothing)', () => {
    expect(focusLabel(null)).toBeNull();
    expect(focusLabel(undefined)).toBeNull();
  });
});

describe('focusToolFrame — disposable coding source hint', () => {
  test('folder focus carries its absolute path and no memory space — every chat is general', () => {
    const frame = focusToolFrame({ kind: 'folder', path: '/repos/voice' });
    expect(frame).toEqual({ toolWorkspace: '/repos/voice' });
    expect(frame).not.toHaveProperty('space');
    expect(focusToolFrame({ kind: 'folder', path: '/somewhere/else' }))
      .toEqual({ toolWorkspace: '/somewhere/else' });
  });

  test('nothing in focus grants no tool workspace hint', () => {
    expect(focusToolFrame(null)).toEqual({});
    expect(focusToolFrame(undefined)).toEqual({});
  });

  test('the frame spreads cleanly into a portal frame', () => {
    const base = { thought: 'hi', companion: 'Cael' };
    expect({ ...base, ...focusToolFrame({ kind: 'folder', path: '/a' }) }).toEqual({ ...base, toolWorkspace: '/a' });
    expect({ ...base, ...focusToolFrame(null) }).toEqual(base);
  });
});

describe('sittingGround — one sitting, one ground, never a sibling’s (2026-09-01)', () => {
  const MINE = { kind: 'folder', path: '/repos/mine' };
  const WINDOW = { kind: 'folder', path: '/repos/window' };
  const SIBLING = { kind: 'folder', path: '/repos/sibling' };

  test('the sitting’s OWN ground wins when it has chosen one', () => {
    expect(sittingGround(MINE, WINDOW)).toBe(MINE);
  });

  test('an unassigned sitting never inherits the window lens', () => {
    expect(sittingGround(null, WINDOW)).toBeNull();
    expect(sittingGround(undefined, WINDOW)).toBeNull();
  });

  test('THE LEAK LAW: the answer is never a THIRD ground', () => {
    // The 2026-09-01 bug read the FOCUSED tab's ground as the fallback for a
    // background sitting's frames. The helper takes exactly two inputs, so a
    // sibling's lens cannot be reached — this test pins that contract.
    expect(sittingGround(null, WINDOW)).not.toBe(SIBLING);
    expect(sittingGround(MINE, SIBLING)).toBe(MINE);
  });

  test('no sitting ground and no window lens is honestly NOTHING', () => {
    expect(sittingGround(null, null)).toBeNull();
    expect(sittingGround(undefined, undefined)).toBeNull();
  });
});

describe('resolveSpawnFocus — the D11 spawn/restore decision', () => {
  const stored = { kind: 'folder', path: '/repos/voice' };

  test('the main desk (slot 1) ALWAYS restores — fresh launch included', () => {
    expect(resolveSpawnFocus(1, false, stored)).toBe(stored);
    expect(resolveSpawnFocus(1, true, stored)).toBe(stored);
    expect(resolveSpawnFocus(1, false, null)).toBeNull();
    expect(resolveSpawnFocus(1, true, null)).toBeNull();
  });

  test('desks ≥ 2 open unfocused on fresh spawn (no marker), whatever is stored', () => {
    expect(resolveSpawnFocus(2, false, stored)).toBeNull();
    expect(resolveSpawnFocus(3, false, stored)).toBeNull();
    expect(resolveSpawnFocus(2, false, null)).toBeNull();
  });

  test('desks ≥ 2 restore on reload (marker present)', () => {
    expect(resolveSpawnFocus(2, true, stored)).toBe(stored);
    expect(resolveSpawnFocus(3, true, stored)).toBe(stored);
    expect(resolveSpawnFocus(2, true, null)).toBeNull();
  });

  test('a non-integer slot follows main-desk discipline — same law as slotSegment', () => {
    expect(resolveSpawnFocus(undefined, false, stored)).toBe(stored);
    expect(resolveSpawnFocus('2', false, stored)).toBe(stored);
    expect(resolveSpawnFocus(1.5, false, stored)).toBe(stored);
  });
});

describe('normalizeSlot', () => {
  test('integers ≥ 1 pass through; everything else is the main desk', () => {
    expect(normalizeSlot(1)).toBe(1);
    expect(normalizeSlot(4)).toBe(4);
    expect(normalizeSlot(0)).toBe(1);
    expect(normalizeSlot('')).toBe(1);
    expect(normalizeSlot('2')).toBe(1);
    expect(normalizeSlot(null)).toBe(1);
    expect(normalizeSlot(undefined)).toBe(1);
    expect(normalizeSlot(1.5)).toBe(1);
  });
});

describe('normalized focus is frozen', () => {
  test('mutation through the context cannot alter a focus token', () => {
    const f = normalizeFocus({ kind: 'folder', path: '/tmp/x' });
    expect(Object.isFrozen(f)).toBe(true);
    expect(() => { 'use strict'; f.path = '/etc'; }).toThrow(TypeError);
    expect(f.path).toBe('/tmp/x');
  });
});

// UX-006 (#227), the PREDICTED half of that issue, now covered: a folder focus
// is validated on read from persistence, and the guard required `startsWith('/')`
// — so an in-session Windows focus worked and never survived a restart.
describe('WINDOWS folder focus survives persistence (#227)', () => {
  test('a persisted Windows folder focus is kept', () => {
    expect(normalizeFocus({ kind: 'folder', path: 'C:\\repos\\Neuma Testing' }))
      .toEqual({ kind: 'folder', path: 'C:\\repos\\Neuma Testing' });
  });

  test('a UNC folder focus is kept', () => {
    expect(normalizeFocus({ kind: 'folder', path: '\\\\srv\\share\\docs' }))
      .toEqual({ kind: 'folder', path: '\\\\srv\\share\\docs' });
  });

  test('a relative path is still refused', () => {
    expect(normalizeFocus({ kind: 'folder', path: 'repos/thing' })).toBeNull();
  });

  test('control characters are still refused', () => {
    expect(normalizeFocus({ kind: 'folder', path: 'C:\\repos\\bad\u0007name' })).toBeNull();
  });
});
