// Path links and live file refresh — the two halves of […].
import { describe, it, expect } from 'vitest';
import { openablePath } from '../../frontend/app/RelinkShell/path-link.js';
import { changedPath } from '../../frontend/app/RelinkShell/files-refresh.js';

describe('openablePath — which code spans are doors', () => {
  it('opens a plain absolute path', () => {
    expect(openablePath('/workspace/repos/neuma/repos')).toBe('/workspace/repos/neuma/repos');
    expect(openablePath('/chronicle')).toBe('/chronicle');
  });

  it('tolerates the whitespace and trailing punctuation a being writes', () => {
    expect(openablePath('  /mnt/thing  ')).toBe('/mnt/thing');
    expect(openablePath('/mnt/thing.')).toBe('/mnt/thing');
    expect(openablePath('/mnt/thing,')).toBe('/mnt/thing');
  });

  it('treats a trailing separator as the same door', () => {
    expect(openablePath('/mnt/thing/')).toBe('/mnt/thing');
  });

  it('keeps a real extension — a dot inside the name is not punctuation', () => {
    expect(openablePath('/mnt/repo/001_the_first_void.md')).toBe('/mnt/repo/001_the_first_void.md');
  });

  it('leaves relative paths and prose as plain text', () => {
    // Relative to WHAT — the lane, the ground, the desk? No single answer.
    expect(openablePath('src/index.js')).toBeNull();
    expect(openablePath('./notes')).toBeNull();
    expect(openablePath('npm run build')).toBeNull();
    expect(openablePath('write_file')).toBeNull();
  });

  it('refuses a command that merely begins with a slash', () => {
    // `/usr/bin/env node` is an instruction, not a place. A link that lands
    // somewhere wrong is worse than text.
    expect(openablePath('/bin/ls -la')).toBeNull();
    expect(openablePath('/usr/bin/rm -rf /tmp/x')).toBeNull();
  });

  it('refuses multi-line spans, protocol-relative URLs, and junk', () => {
    expect(openablePath('/mnt/a\n/mnt/b')).toBeNull();
    expect(openablePath('//example.com/thing')).toBeNull();
    expect(openablePath('/')).toBeNull();
    expect(openablePath('')).toBeNull();
    expect(openablePath(null)).toBeNull();
    expect(openablePath(42)).toBeNull();
  });

  it('refuses control characters — a path is never a UI injection', () => {
    expect(openablePath(`/mnt/${String.fromCharCode(27)}[31m`)).toBeNull();
    expect(openablePath(`/mnt/a${String.fromCharCode(0)}b`)).toBeNull();
  });

  it('allows a path with spaces in it', () => {
    expect(openablePath('/mnt/my folder/notes')).toBe('/mnt/my folder/notes');
  });

  // #227 — every path a being named on Windows was unclickable, because this
  // guard read `startsWith('/')`.
  it('a Windows path is a door too', () => {
    expect(openablePath('C:\\repos\\Neuma Testing')).toBe('C:\\repos\\Neuma Testing');
    expect(openablePath('C:\\repos\\Neuma Testing\\')).toBe('C:\\repos\\Neuma Testing');
    expect(openablePath('\\\\srv\\share\\docs')).toBe('\\\\srv\\share\\docs');
  });

  it('still refuses what is not a place', () => {
    expect(openablePath('repos/thing')).toBeNull();     // relative
    expect(openablePath('//host/share')).toBeNull();    // URL-shaped, not a local path
    expect(openablePath('/bin/ls -la')).toBeNull();     // a command
  });
});

// `parentDir` is GONE: it was the third hand-rolled reimplementation of dirOf on
// this desk (with FilesApp's and files-drop's), and each one carried the same
// POSIX-only assumption. PathOpener uses the shared `dirOf`, whose own bed is
// test/unit/path-utils.test.js.

describe('changedPath — what makes the Explorer re-list', () => {
  // The live bug (Design note, 2026-07-26: two beings created repos/chronicle and
  // wrote a file into it; the Explorer kept showing the tree from mount.
  it('announces a directory creation and a write', () => {
    expect(changedPath({ tool: 'create_directory', status: 'ok', path: '/g/repos/chronicle' }))
      .toBe('/g/repos/chronicle');
    expect(changedPath({ tool: 'filesystem/write_file', ok: true, path: '/g/repos/chronicle/001.md' }))
      .toBe('/g/repos/chronicle/001.md');
  });

  it('covers every mutating act', () => {
    for (const tool of ['write_file', 'edit_file', 'create_file', 'create_directory', 'move_file', 'rename_file', 'delete_file']) {
      expect(changedPath({ tool, status: 'ok', path: '/g/x' }), tool).toBe('/g/x');
    }
  });

  it('stays silent on reads — the tree must not churn while a being looks around', () => {
    for (const tool of ['read_file', 'read_text_file', 'list_directory', 'search_files', 'get_file_info']) {
      expect(changedPath({ tool, status: 'ok', path: '/g/x' }), tool).toBeNull();
    }
  });

  it('stays silent on a refused or errored act — a denial is not a change', () => {
    expect(changedPath({ tool: 'write_file', ok: false, path: '/g/x' })).toBeNull();
    expect(changedPath({ tool: 'write_file', status: 'denied', path: '/g/x' })).toBeNull();
    expect(changedPath({ tool: 'write_file', status: 'error', path: '/g/x' })).toBeNull();
  });

  it('stays silent when the frame carries no path', () => {
    expect(changedPath({ tool: 'write_file', status: 'ok' })).toBeNull();
    expect(changedPath(null)).toBeNull();
    expect(changedPath({})).toBeNull();
  });
});
