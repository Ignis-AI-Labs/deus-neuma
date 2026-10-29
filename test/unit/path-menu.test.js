// path-menu — a named path offers a deliberate menu; only filesystem tool lines
// with an absolute path become doors.
import { describe, test, expect } from 'vitest';
import { toolLinePath, pathMenuItems, looksLikeFile } from '../../frontend/app/RelinkShell/path-menu.js';

describe('toolLinePath', () => {
  test('an fs act names its absolute path, and where it sits in the line', () => {
    expect(toolLinePath('read /srv/house/orla/charter.md')).toEqual({ path: '/srv/house/orla/charter.md', start: 5, end: 31 });
    expect(toolLinePath('edited /mnt/a/b.md')?.path).toBe('/mnt/a/b.md');
    expect(toolLinePath('listed /mnt/repo/')?.path).toBe('/mnt/repo');
    expect(toolLinePath('wrote C:\\Users\\orla\\x.txt')?.path).toBe('C:\\Users\\orla\\x.txt');
  });
  test('a failed act\'s door ends at the dash', () => {
    expect(toolLinePath('read /mnt/a/b.md — failed: ENOENT no such file')?.path).toBe('/mnt/a/b.md');
  });
  test('commands, relative paths and other tools stay text', () => {
    expect(toolLinePath('execute ls /tmp')).toBeNull();
    expect(toolLinePath('inspect python /x.py → exit 0')).toBeNull();
    expect(toolLinePath('read notes/rel.md')).toBeNull();
    expect(toolLinePath('retrieved tr_a5b36b1f_1_d1ee9f0f')).toBeNull();
    expect(toolLinePath(null)).toBeNull();
  });
});

describe('pathMenuItems', () => {
  test('a file opens; focusing is last, after a separator, and says it moves focus', () => {
    const items = pathMenuItems('/a/b.json', { desktop: true });
    expect(items.map((i) => i.id ?? '—')).toEqual(['open-file', 'show-in-folder', 'copy-path', '—', 'focus-folder']);
    expect(items.at(-1).label).toMatch(/changes this window’s focus/);
  });
  test('a markdown or text file presses into a PDF — one item per brand kit, and plain', () => {
    const kits = [{ id: 'ignis', name: 'Ignis AI Labs' }];
    const items = pathMenuItems('/a/charter.md', { kits });
    expect(items.map((i) => i.id ?? '—')).toEqual(['open-file', 'press:ignis', 'press:', 'copy-path', '—', 'focus-folder']);
    expect(items[1].label).toBe('Make PDF — Ignis AI Labs');
    expect(items[2].label).toBe('Make PDF — plain');
    expect(pathMenuItems('/a/notes.txt').map((i) => i.id)).toContain('press:');
    expect(pathMenuItems('/a/data.json', { kits }).some((i) => i.id?.startsWith('press:'))).toBe(false);
  });
  test('a folder offers no Open file; a browser gets no file-manager item', () => {
    expect(pathMenuItems('/a/dir').map((i) => i.id ?? '—')).toEqual(['copy-path', '—', 'focus-folder']);
  });
  test('looksLikeFile reads the last segment only', () => {
    expect(looksLikeFile('/a.b/dir')).toBe(false);
    expect(looksLikeFile('/a/notes.md')).toBe(true);
  });

  it('a page (a benchmark report) opens in the browser — on the desktop, for .html only', () => {
    expect(pathMenuItems('/r/desk-1.html', { desktop: true }).map((i) => i.id)).toContain('open-browser');
    expect(pathMenuItems('/r/desk-1.html').map((i) => i.id)).not.toContain('open-browser');
    expect(pathMenuItems('/r/desk-1.pdf', { desktop: true }).map((i) => i.id)).not.toContain('open-browser');
  });
});
