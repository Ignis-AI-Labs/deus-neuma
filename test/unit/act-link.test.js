/**
 * Tests for actFilePath — which act chips link into the editor
 * (frontend/app/RelinkShell/act-link.js). File acts link; directory acts and
 * a move's stale source stay plain; the decision is case-insensitive because
 * labels arrive as the wire spelled them.
 */
import { describe, expect, test } from 'vitest';
import { actFilePath } from '../../frontend/app/RelinkShell/act-link.js';

describe('actFilePath', () => {
  test('file acts link to their target', () => {
    for (const tool of ['write_file', 'edit_file', 'read_file', 'read_text_file', 'get_file_info']) {
      expect(actFilePath(tool, '/mnt/data/neuma/house/positions.md')).toBe('/mnt/data/neuma/house/positions.md');
    }
  });

  test('case-insensitive — the chip label may arrive uppercase', () => {
    expect(actFilePath('WRITE_FILE', '/a/b.md')).toBe('/a/b.md');
  });

  test('directory acts and moves stay plain — a link must land where it points', () => {
    for (const tool of ['list_directory', 'search_files', 'create_directory', 'move_file']) {
      expect(actFilePath(tool, '/mnt/data/neuma/house')).toBeNull();
    }
  });

  test('no path, unknown tool, or non-string path yields no link', () => {
    expect(actFilePath('write_file', '')).toBeNull();
    expect(actFilePath('write_file', null)).toBeNull();
    expect(actFilePath('no_such_tool', '/a')).toBeNull();
    expect(actFilePath(null, '/a')).toBeNull();
  });
});
