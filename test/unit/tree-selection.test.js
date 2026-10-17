/**
 * tree-selection — the Explorer's multi-select grammar, proven pure (RULE 0:
 * pure functions, real inputs, real outputs, no mock anywhere).
 */
import { describe, it, expect } from 'vitest';
import { applyRowClick, EMPTY_SELECTION, visiblePaths } from '../../frontend/app/RelinkShell/files/tree-selection.js';

const view = {
  roots: ['/r'],
  expanded: new Set(['/r', '/r/src']),
  childrenMap: {
    '/r': [
      { path: '/r/src', type: 'dir', name: 'src' },
      { path: '/r/.env.example', type: 'file', name: '.env.example', hidden: true },
      { path: '/r/a.md', type: 'file', name: 'a.md' },
    ],
    '/r/src': [
      { path: '/r/src/one.js', type: 'file', name: 'one.js' },
      { path: '/r/src/two.js', type: 'file', name: 'two.js' },
    ],
  },
  showHidden: false,
};

describe('visiblePaths mirrors the render traversal', () => {
  it('walks roots, expanded dirs in place, hidden rows filtered', () => {
    expect(visiblePaths(view)).toEqual(['/r', '/r/src', '/r/src/one.js', '/r/src/two.js', '/r/a.md']);
  });
  it('shows hidden rows when dotfiles are on', () => {
    expect(visiblePaths({ ...view, showHidden: true }))
      .toEqual(['/r', '/r/src', '/r/src/one.js', '/r/src/two.js', '/r/.env.example', '/r/a.md']);
  });
  it('an expanded dir whose children have not loaded contributes only itself', () => {
    expect(visiblePaths({ ...view, childrenMap: { '/r': view.childrenMap['/r'] } }))
      .toEqual(['/r', '/r/src', '/r/a.md']);
  });
});

describe('applyRowClick — plain, ctrl, shift', () => {
  const order = visiblePaths(view);

  it('a plain click selects exactly the one row and anchors there', () => {
    const s = applyRowClick(EMPTY_SELECTION, '/r/a.md', {});
    expect([...s.paths]).toEqual(['/r/a.md']);
    expect(s.anchor).toBe('/r/a.md');
  });

  it('ctrl toggles membership in, then out, moving the anchor', () => {
    let s = applyRowClick(EMPTY_SELECTION, '/r/src/one.js', {});
    s = applyRowClick(s, '/r/a.md', { ctrl: true });
    expect([...s.paths].sort()).toEqual(['/r/a.md', '/r/src/one.js']);
    expect(s.anchor).toBe('/r/a.md');
    s = applyRowClick(s, '/r/src/one.js', { ctrl: true });
    expect([...s.paths]).toEqual(['/r/a.md']);
    expect(s.anchor).toBe('/r/src/one.js');
  });

  it('shift selects the visible range from the anchor, in either direction', () => {
    let s = applyRowClick(EMPTY_SELECTION, '/r/src', {});
    s = applyRowClick(s, '/r/src/two.js', { shift: true }, order);
    expect([...s.paths]).toEqual(['/r/src', '/r/src/one.js', '/r/src/two.js']);
    expect(s.anchor).toBe('/r/src'); // anchor holds, so the next shift re-aims
    s = applyRowClick(s, '/r', { shift: true }, order);
    expect([...s.paths].sort()).toEqual(['/r', '/r/src']);
  });

  it('ctrl+shift extends the standing set with the range', () => {
    let s = applyRowClick(EMPTY_SELECTION, '/r/a.md', {});
    s = applyRowClick(s, '/r', { ctrl: true });
    s = applyRowClick(s, '/r/src/one.js', { ctrl: true, shift: true }, order);
    expect([...s.paths].sort()).toEqual(['/r', '/r/a.md', '/r/src', '/r/src/one.js']);
  });

  it('shift with no anchor, or an anchor no longer visible, degrades to a plain select', () => {
    const noAnchor = applyRowClick(EMPTY_SELECTION, '/r/a.md', { shift: true }, order);
    expect([...noAnchor.paths]).toEqual(['/r/a.md']);
    const gone = applyRowClick({ paths: new Set(['/x']), anchor: '/x' }, '/r/a.md', { shift: true }, order);
    expect([...gone.paths]).toEqual(['/r/a.md']);
  });
});
