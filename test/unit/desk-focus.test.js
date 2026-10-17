/**
 * The pure core of a desk window's working focus (Wave 1, D1/D7/D11): the
 * boundary validator over anything claiming to be a focus, equality, the
 * strip label, the space frame a focus stamps (delegating to the REAL
 * projectSpaceFrame — folder/null stamp nothing), and the D11 spawn/restore
 * decision. Proven directly with real inputs — no React, no mocks.
 */

import { describe, test, expect } from 'vitest';
import {
  normalizeFocus, normalizeSlot, focusEquals, focusProject, focusLabel, focusSpaceFrame,
  focusToolFrame, resolveSpawnFocus, sittingGround,
} from '../../frontend/app/RelinkShell/desk-focus.js';
import { projectSpaceFrame } from '../../frontend/app/RelinkShell/project-space.js';

const PROJECTS = [
  {
    id: 'p1', name: 'Voice Layer', folder: '/repos/voice',
    folders: [{ path: '/repos/voice', isRepo: true, branch: 'main' }],
  },
  { id: 'p2', name: 'Folderless', folders: [] },
  {
    id: 'p3', name: 'Notes', folder: '/repos/notes',
    folders: [{ path: '/repos/notes', isRepo: false }],
  },
];

describe('normalizeFocus — the boundary validator', () => {
  test('a valid project focus passes, rebuilt by explicit field-picking', () => {
    expect(normalizeFocus({ kind: 'project', id: 'p1' })).toEqual({ kind: 'project', id: 'p1' });
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
    const raw = JSON.parse('{"kind":"project","id":"x","__proto__":{"polluted":true}}');
    const out = normalizeFocus(raw);
    expect(out).toEqual({ kind: 'project', id: 'x' });
    expect(out.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined(); // Object.prototype untouched
  });

  test('inherited fields do not count — Object.hasOwn discipline', () => {
    expect(normalizeFocus(Object.create({ kind: 'project', id: 'p1' }))).toBeNull();
  });

  test('non-objects and null are null', () => {
    for (const raw of [null, undefined, 'project', 42, true, ['project']]) {
      expect(normalizeFocus(raw)).toBeNull();
    }
  });

  test('an unknown or miscased kind is null', () => {
    expect(normalizeFocus({ kind: 'PROJECT', id: 'p1' })).toBeNull();
    expect(normalizeFocus({ kind: 'file', path: '/a' })).toBeNull();
    expect(normalizeFocus({ id: 'p1' })).toBeNull(); // no kind at all
  });

  test('a project focus needs a non-empty string id', () => {
    expect(normalizeFocus({ kind: 'project' })).toBeNull();
    expect(normalizeFocus({ kind: 'project', id: '' })).toBeNull();
    expect(normalizeFocus({ kind: 'project', id: 7 })).toBeNull();
    expect(normalizeFocus({ kind: 'project', id: null })).toBeNull();
  });

  test('a folder focus needs a non-empty ABSOLUTE string path', () => {
    expect(normalizeFocus({ kind: 'folder' })).toBeNull();
    expect(normalizeFocus({ kind: 'folder', path: '' })).toBeNull();
    expect(normalizeFocus({ kind: 'folder', path: 'repos/voice' })).toBeNull();
    expect(normalizeFocus({ kind: 'folder', path: '../../etc' })).toBeNull();
    expect(normalizeFocus({ kind: 'folder', path: ['/a'] })).toBeNull();
  });

  test('control characters in id or path are rejected', () => {
    // Built with fromCharCode — the harness mangles \uXXXX literals.
    const nul = String.fromCharCode(0);
    const nl = String.fromCharCode(10);
    const esc = String.fromCharCode(27);
    const del = String.fromCharCode(127);
    expect(normalizeFocus({ kind: 'folder', path: `/tmp/${nul}x` })).toBeNull();
    expect(normalizeFocus({ kind: 'folder', path: `/tmp/a${nl}b` })).toBeNull();
    expect(normalizeFocus({ kind: 'folder', path: `/tmp/${del}` })).toBeNull();
    expect(normalizeFocus({ kind: 'project', id: `p${esc}1` })).toBeNull();
  });
});

describe('focusEquals — value equality over normalized focus', () => {
  test('null equals null and nothing else', () => {
    expect(focusEquals(null, null)).toBe(true);
    expect(focusEquals(null, { kind: 'project', id: 'p1' })).toBe(false);
    expect(focusEquals({ kind: 'folder', path: '/a' }, null)).toBe(false);
  });

  test('same kind + same identity is equal; anything else is not', () => {
    expect(focusEquals({ kind: 'project', id: 'p1' }, { kind: 'project', id: 'p1' })).toBe(true);
    expect(focusEquals({ kind: 'project', id: 'p1' }, { kind: 'project', id: 'p2' })).toBe(false);
    expect(focusEquals({ kind: 'folder', path: '/a' }, { kind: 'folder', path: '/a' })).toBe(true);
    expect(focusEquals({ kind: 'folder', path: '/a' }, { kind: 'folder', path: '/b' })).toBe(false);
    expect(focusEquals({ kind: 'project', id: '/a' }, { kind: 'folder', path: '/a' })).toBe(false);
  });
});

describe('focusProject — resolving a focus against the projects list', () => {
  test('project focus resolves to the exact fetched project', () => {
    expect(focusProject({ kind: 'project', id: 'p1' }, PROJECTS)).toBe(PROJECTS[0]);
  });

  test('folder focus, no focus, a stale id, or no list resolve to null', () => {
    expect(focusProject({ kind: 'folder', path: '/repos/voice' }, PROJECTS)).toBeNull();
    expect(focusProject(null, PROJECTS)).toBeNull();
    expect(focusProject({ kind: 'project', id: 'gone' }, PROJECTS)).toBeNull();
    expect(focusProject({ kind: 'project', id: 'p1' }, null)).toBeNull();
  });
});

describe('focusLabel — what the strip shows (D7)', () => {
  test('project focus → name + working-folder badge with branch', () => {
    expect(focusLabel({ kind: 'project', id: 'p1' }, PROJECTS)).toEqual({
      kind: 'project', name: 'Voice Layer', folder: { name: 'voice', branch: 'main' },
    });
  });

  test('project without a working folder → name, no folder badge', () => {
    expect(focusLabel({ kind: 'project', id: 'p2' }, PROJECTS)).toEqual({
      kind: 'project', name: 'Folderless', folder: null,
    });
  });

  test('project whose working folder is not a repo → badge without branch', () => {
    expect(focusLabel({ kind: 'project', id: 'p3' }, PROJECTS)).toEqual({
      kind: 'project', name: 'Notes', folder: { name: 'notes', branch: null },
    });
  });

  test('folder focus → basename, branch when a project already knows the repo', () => {
    expect(focusLabel({ kind: 'folder', path: '/repos/voice' }, PROJECTS)).toEqual({
      kind: 'folder', folder: { name: 'voice', branch: 'main' },
    });
    expect(focusLabel({ kind: 'folder', path: '/somewhere/else' }, PROJECTS)).toEqual({
      kind: 'folder', folder: { name: 'else', branch: null },
    });
    expect(focusLabel({ kind: 'folder', path: '/a/b' }, null)).toEqual({
      kind: 'folder', folder: { name: 'b', branch: null },
    });
  });

  test('no focus or a stale project id → null (the strip renders nothing)', () => {
    expect(focusLabel(null, PROJECTS)).toBeNull();
    expect(focusLabel({ kind: 'project', id: 'gone' }, PROJECTS)).toBeNull();
  });
});

describe('focusSpaceFrame — memory scoping (D7: bare folder stamps NOTHING)', () => {
  test('project focus delegates to the REAL projectSpaceFrame', () => {
    const out = focusSpaceFrame({ kind: 'project', id: 'p1' }, PROJECTS);
    expect(out).toEqual(projectSpaceFrame(PROJECTS[0]));
    expect(out).toEqual({ space: { id: 'p1', kind: 'project', label: 'Voice Layer' } });
  });

  test('bare-folder focus stamps nothing — exactly the no-project frame', () => {
    expect(focusSpaceFrame({ kind: 'folder', path: '/repos/voice' }, PROJECTS))
      .toEqual(projectSpaceFrame(null));
    expect(focusSpaceFrame({ kind: 'folder', path: '/repos/voice' }, PROJECTS)).toEqual({});
  });

  test('no focus or a stale project id stamps nothing', () => {
    expect(focusSpaceFrame(null, PROJECTS)).toEqual({});
    expect(focusSpaceFrame({ kind: 'project', id: 'gone' }, PROJECTS)).toEqual({});
  });

  test('the frame spreads cleanly into a portal frame, adding nothing under folder focus', () => {
    const base = { thought: 'hi', companion: 'Cael' };
    expect({ ...base, ...focusSpaceFrame({ kind: 'project', id: 'p1' }, PROJECTS) })
      .toEqual({ ...base, space: { id: 'p1', kind: 'project', label: 'Voice Layer' } });
    expect({ ...base, ...focusSpaceFrame({ kind: 'folder', path: '/a' }, PROJECTS) }).toEqual(base);
  });
});

describe('focusToolFrame — disposable coding source hint', () => {
  test('folder focus carries its absolute path without adding memory scope', () => {
    const focus = { kind: 'folder', path: '/repos/voice' };
    expect(focusToolFrame(focus, PROJECTS)).toEqual({ toolWorkspace: '/repos/voice' });
    expect(focusSpaceFrame(focus, PROJECTS)).toEqual({});
    expect(focusToolFrame({ kind: 'folder', path: '/somewhere/else' }, PROJECTS))
      .toEqual({ toolWorkspace: '/somewhere/else' });
  });

  test('project focus resolves through the project working folder', () => {
    expect(focusToolFrame({ kind: 'project', id: 'p1' }, PROJECTS))
      .toEqual({ toolWorkspace: '/repos/voice' });
  });

  test('missing, stale, and folderless focus grant no tool workspace hint', () => {
    expect(focusToolFrame(null, PROJECTS)).toEqual({});
    expect(focusToolFrame({ kind: 'project', id: 'gone' }, PROJECTS)).toEqual({});
    expect(focusToolFrame({ kind: 'project', id: 'p2' }, PROJECTS)).toEqual({});
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
  const stored = { kind: 'project', id: 'p1' };

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
