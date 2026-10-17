/**
 * The pure item tables of the folder/file right-click menus: what each row
 * kind offers on each surface (FILES tree / FolderPicker rows + background /
 * FolderShelf), the pin label following the shelf state, the danger flag on
 * destruction, and the separator pruning that keeps the groups clean.
 * Proven directly — no React, no DOM (RULE 0).
 */

import { describe, test, expect } from 'vitest';
import {
  pruneSeparators, treeMenuItems, pickerMenuItems, shelfMenuItems,
} from '../../frontend/app/RelinkShell/files/files-menu.js';
import { moveSelection, isSelectable } from '../../frontend/components/DesktopContextMenu/context-menu-view.js';

const ids = (items) => items.map((it) => (it.kind === 'separator' ? '—' : it.id));

describe('pruneSeparators — the groups stay clean', () => {
  test('leading, trailing, and doubled separators collapse', () => {
    const sep = { kind: 'separator' };
    const a = { kind: 'item', id: 'a' };
    const b = { kind: 'item', id: 'b' };
    expect(pruneSeparators([sep, a, sep, sep, b, sep])).toEqual([a, { kind: 'separator' }, b]);
  });

  test('an empty build stays empty', () => {
    expect(pruneSeparators([{ kind: 'separator' }, { kind: 'separator' }])).toEqual([]);
  });
});

describe('treeMenuItems — the FILES tree rows', () => {
  const dir = { path: '/repo/src', type: 'dir' };
  const file = { path: '/repo/a.md', type: 'file' };

  test('a folder offers focus, creation, rename/delete, pin, copy', () => {
    expect(ids(treeMenuItems({ entry: dir, isRoot: false, pinned: false }))).toEqual([
      'focus', '—', 'new-file', 'new-folder', '—', 'rename', 'delete', '—', 'pin', 'refresh', 'copy-path', 'show-in-folder',
    ]);
  });

  test('a file offers open, rename/delete, copy — never pin or creation', () => {
    expect(ids(treeMenuItems({ entry: file, isRoot: false, pinned: false }))).toEqual([
      'open-file', '—', 'rename', 'delete', '—', 'refresh', 'copy-path', 'show-in-folder',
    ]);
  });

  test('an HTML file also offers OPEN IN BROWSER, right after OPEN', () => {
    expect(ids(treeMenuItems({ entry: { path: '/repo/out/GALLERY.HTML', type: 'file' }, isRoot: false, pinned: false }))).toEqual([
      'open-file', 'open-in-browser', '—', 'rename', 'delete', '—', 'refresh', 'copy-path', 'show-in-folder',
    ]);
    expect(ids(treeMenuItems({ entry: { path: '/repo/a.htm', type: 'file' }, isRoot: false, pinned: false })))
      .toContain('open-in-browser');
  });

  test('no other kind offers the browser — not markdown, not folders', () => {
    expect(ids(treeMenuItems({ entry: file, isRoot: false, pinned: false }))).not.toContain('open-in-browser');
    expect(ids(treeMenuItems({ entry: dir, isRoot: false, pinned: false }))).not.toContain('open-in-browser');
  });

  test('a root keeps close and loses rename/delete (backend law: an open root cannot be renamed or deleted)', () => {
    const items = treeMenuItems({ entry: { path: '/repo', type: 'dir' }, isRoot: true, pinned: true });
    expect(ids(items)).toEqual([
      'focus', '—', 'new-file', 'new-folder', '—', 'pin', 'refresh', 'copy-path', 'show-in-folder', '—', 'close-root',
    ]);
  });

  test('the pin label follows the shelf state; delete wears danger', () => {
    const pin = (p) => treeMenuItems({ entry: dir, isRoot: false, pinned: p }).find((i) => i.id === 'pin');
    expect(pin(false).label).toBe('PIN TO FAVORITES');
    expect(pin(true).label).toBe('UNPIN FAVORITE');
    const del = treeMenuItems({ entry: file, isRoot: false, pinned: false }).find((i) => i.id === 'delete');
    expect(del.danger).toBe(true);
  });
});

describe('pickerMenuItems — browsing rows and the current folder', () => {
  const dir = { path: '/repos/neuma', dir: true };
  const file = { path: '/repos/neuma/a.md', dir: false };

  test('a folder row: enter, open-as-pick, pin, copy', () => {
    expect(ids(pickerMenuItems({ entry: dir, pinned: false, pickFile: false }))).toEqual([
      'enter', 'pick', '—', 'pin', 'copy-path',
    ]);
  });

  test('file mode: a folder is never itself the pick; a file row IS the pick', () => {
    expect(ids(pickerMenuItems({ entry: dir, pinned: false, pickFile: true }))).toEqual([
      'enter', '—', 'pin', 'copy-path',
    ]);
    expect(ids(pickerMenuItems({ entry: file, pinned: false, pickFile: true }))).toEqual([
      'choose-file', 'copy-path',
    ]);
  });

  test('the list background carries the CURRENT folder: pick, new folder here, pin, copy', () => {
    expect(ids(pickerMenuItems({ entry: dir, pinned: true, pickFile: false, background: true }))).toEqual([
      'pick', 'new-folder-here', '—', 'pin', 'copy-path',
    ]);
    expect(ids(pickerMenuItems({ entry: dir, pinned: false, pickFile: true, background: true }))).toEqual([
      'new-folder-here', '—', 'pin', 'copy-path',
    ]);
  });
});

describe('shelfMenuItems — the macros spelled out', () => {
  test('a favorites row: open, unpin, copy — no dismiss', () => {
    expect(ids(shelfMenuItems({ pinned: true, recent: false }))).toEqual(['open', '—', 'pin', 'copy-path']);
    expect(shelfMenuItems({ pinned: true, recent: false }).find((i) => i.id === 'pin').label).toBe('UNPIN FAVORITE');
  });

  test('a recents row adds REMOVE FROM RECENTS', () => {
    expect(ids(shelfMenuItems({ pinned: false, recent: true }))).toEqual(['open', '—', 'pin', 'dismiss', 'copy-path']);
  });
});

describe('the item shape speaks the shared keyboard helpers', () => {
  test('moveSelection walks tree items and skips the separators', () => {
    const items = treeMenuItems({ entry: { path: '/d', type: 'dir' }, isRoot: false, pinned: false });
    let i = moveSelection(items, -1, 1);
    const walked = [];
    for (let step = 0; step < items.length * 2; step += 1) {
      walked.push(items[i].id);
      i = moveSelection(items, i, 1);
      if (items[i].id === walked[0]) break; // wrapped
    }
    expect(walked).toEqual(ids(items).filter((x) => x !== '—'));
    expect(items.every((it) => it.kind === 'separator' || isSelectable(it))).toBe(true);
  });
});
