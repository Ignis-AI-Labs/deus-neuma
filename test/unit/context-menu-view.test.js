// Pure view logic for the in-page desktop context menu — labels, keyboard
// walk, viewport clamping. The Electron-side template builder has its own
// suite (electron-context-menu.test.js); this covers the renderer half.
import { describe, it, expect } from 'vitest';
import {
  itemLabel, isSelectable, moveSelection, clampPosition, ROLE_LABELS,
} from '../../frontend/components/DesktopContextMenu/context-menu-view.js';

describe('itemLabel', () => {
  it('suggestions read as the word itself — content keeps its case', () => {
    expect(itemLabel({ kind: 'suggestion', word: 'keepsake' })).toBe('keepsake');
  });

  it('add-to-dictionary quotes the word inside uppercase chrome', () => {
    expect(itemLabel({ kind: 'add-to-dictionary', word: 'neuma' })).toBe('ADD “neuma” TO DICTIONARY');
  });

  it('edit roles use the chrome labels', () => {
    expect(itemLabel({ kind: 'role', role: 'selectAll' })).toBe('SELECT ALL');
    expect(itemLabel({ kind: 'role', role: 'cut' })).toBe(ROLE_LABELS.cut);
  });

  it('an unknown role still renders something readable', () => {
    expect(itemLabel({ kind: 'role', role: 'undo' })).toBe('UNDO');
  });
});

describe('moveSelection', () => {
  const items = [
    { kind: 'suggestion', word: 'a' },
    { kind: 'separator' },
    { kind: 'role', role: 'copy' },
  ];

  it('walks down from nothing to the first selectable', () => {
    expect(moveSelection(items, -1, 1)).toBe(0);
  });

  it('skips separators', () => {
    expect(moveSelection(items, 0, 1)).toBe(2);
    expect(moveSelection(items, 2, -1)).toBe(0);
  });

  it('wraps around both ways', () => {
    expect(moveSelection(items, 2, 1)).toBe(0);
    expect(moveSelection(items, 0, -1)).toBe(2);
  });

  it('returns -1 when nothing is selectable', () => {
    expect(moveSelection([{ kind: 'separator' }], -1, 1)).toBe(-1);
  });

  it('isSelectable rejects only separators', () => {
    expect(isSelectable({ kind: 'separator' })).toBe(false);
    expect(isSelectable({ kind: 'role', role: 'copy' })).toBe(true);
  });
});

describe('clampPosition', () => {
  const size = { menuW: 200, menuH: 100, viewW: 1000, viewH: 800 };

  it('leaves an in-bounds position alone', () => {
    expect(clampPosition({ x: 300, y: 300 }, size)).toEqual({ x: 300, y: 300 });
  });

  it('pulls an overflowing position back inside with a margin', () => {
    expect(clampPosition({ x: 950, y: 780 }, size)).toEqual({ x: 1000 - 200 - 8, y: 800 - 100 - 8 });
  });

  it('never goes past the top-left margin', () => {
    expect(clampPosition({ x: -20, y: 0 }, size)).toEqual({ x: 8, y: 8 });
  });
});
