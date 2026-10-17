/**
 * The desk's path primitives — the semantics three filed defects hinge on.
 *
 * This bed was written for #269 seam 3 to pin CURRENT behaviour, including the
 * trailing-separator defect, […] That fix has now landed (#224/#227) and
 * that assertion is flipped below, which is the review signal it was left for.
 *
 * The Windows cases are the ones that matter, and they are exact paths from the
 * two field reports: on Windows `dirOf` returned `/` for every path, so a being's
 * write never refreshed the Explorer (#224), and `startsWith('/')` discarded
 * every folder, so FAVORITES and RECENTS could never populate (#227).
 *
 * THE SEPARATOR IS READ FROM THE PATH'S SHAPE. So the POSIX regression #262
 * measured — and the separator-agnostic `Math.max(lastIndexOf('/'),
 * lastIndexOf('\\'))` that #224's own body proposed — cannot happen: a backslash
 * inside an absolute POSIX path stays filename data. There is a test for exactly
 * that below, because it is the trap this fix had to avoid.
 */
import { describe, it, expect } from 'vitest';
import { dirOf, baseName, isAbsolutePath, pathCrumbs } from '../../frontend/utils/path.js';

describe('dirOf — the parent that must reveal a change', () => {
  it('walks one level up an absolute path', () => {
    expect(dirOf('/a/b/c')).toBe('/a/b');
    expect(dirOf('/workspace/repos/neuma/file.txt')).toBe('/workspace/repos/neuma');
  });

  it('a top-level entry falls back to the root', () => {
    expect(dirOf('/a')).toBe('/');
  });

  it('a relative path keeps its relative parent', () => {
    expect(dirOf('rel/x')).toBe('rel');
  });

  it('FIXED (#224): a trailing separator yields the PARENT, not the path itself', () => {
    // `create_directory` announces `/root/newdir/`; the refresh must re-list
    // /root — the parent that reveals the new folder — and not the new empty
    // folder itself (#269 finding 3).
    expect(dirOf('/root/newdir/')).toBe('/root');
    expect(dirOf('C:\\root\\newdir\\')).toBe('C:\\root');
  });

  it('degenerate inputs stay inside the contract', () => {
    expect(dirOf('/')).toBe('/');
    expect(dirOf('')).toBe('/');
    expect(dirOf('name-with-no-slash')).toBe('/');
    expect(dirOf(null)).toBe('/');
    expect(dirOf(undefined)).toBe('/');
  });

  // The witnessed case, verbatim from #224: `C:\repos\Neuma Testing` was open and
  // empty, Ostrel wrote into it, the act ledger recorded the write — and the
  // Explorer showed nothing, because this returned '/'.
  it('WINDOWS: a drive path yields its real parent, not the POSIX root', () => {
    expect(dirOf('C:\\repos\\Neuma Testing\\ostrel-explorer-01.txt')).toBe('C:\\repos\\Neuma Testing');
    expect(dirOf('C:\\a\\b\\c')).toBe('C:\\a\\b');
  });

  it('WINDOWS: a drive root is the floor a parent cannot go below', () => {
    expect(dirOf('C:\\a')).toBe('C:\\');
    expect(dirOf('C:\\')).toBe('C:\\');
  });

  it('WINDOWS: forward slashes after a drive letter are separators too', () => {
    expect(dirOf('C:/a/b')).toBe('C:/a');
  });

  it('WINDOWS: a UNC share is the floor for paths beneath it', () => {
    expect(dirOf('\\\\srv\\share\\a\\b')).toBe('\\\\srv\\share\\a');
    expect(dirOf('\\\\srv\\share\\a')).toBe('\\\\srv\\share');
    expect(dirOf('\\\\srv\\share')).toBe('\\\\srv\\share');
  });

  // THE TRAP. #224's body proposed splitting on both separators unconditionally;
  // #262 measured the regression that causes. A backslash is legal filename data
  // on POSIX, and an absolute POSIX path is never Windows-shaped.
  it('POSIX: a backslash inside an absolute path is FILENAME DATA, not a separator', () => {
    expect(dirOf('/home/x/notes\\draft.md')).toBe('/home/x');
    expect(baseName('/home/x/notes\\draft.md')).toBe('notes\\draft.md');
  });
});

describe('baseName — the label a row shows', () => {
  it('takes the last segment on either platform', () => {
    expect(baseName('/a/b/c.md')).toBe('c.md');
    expect(baseName('C:\\repos\\Neuma Testing\\f.txt')).toBe('f.txt');
  });

  it('tolerates a trailing separator', () => {
    expect(baseName('/a/b/')).toBe('b');
    expect(baseName('C:\\a\\b\\')).toBe('b');
  });

  it('a drive root labels itself — there is nothing else honest to call it', () => {
    expect(baseName('C:\\')).toBe('C:\\');
  });

  it('empty input is empty, never a crash', () => {
    expect(baseName('')).toBe('');
    expect(baseName()).toBe('');
  });
});

describe('isAbsolutePath — the guard every desk surface shares', () => {
  it('accepts every absolute shape the desk actually receives', () => {
    expect(isAbsolutePath('/mnt/repo')).toBe(true);
    expect(isAbsolutePath('C:\\repos\\Neuma Testing')).toBe(true);
    expect(isAbsolutePath('c:/repos')).toBe(true);          // lowercase drive, forward slashes
    expect(isAbsolutePath('\\\\srv\\share')).toBe(true);    // UNC
  });

  it('rejects the relative and the malformed', () => {
    expect(isAbsolutePath('repos/thing')).toBe(false);
    expect(isAbsolutePath('notes\\draft.md')).toBe(false);  // relative, or a POSIX filename
    expect(isAbsolutePath('C:')).toBe(false);               // a drive with no root separator
    expect(isAbsolutePath('')).toBe(false);
    expect(isAbsolutePath(null)).toBe(false);
    expect(isAbsolutePath(42)).toBe(false);
  });
});

describe('pathCrumbs — the picker address trail', () => {
  it('walks a POSIX path root-first, each crumb its own absolute path', () => {
    expect(pathCrumbs('/mnt/data')).toEqual([
      { label: '/', path: '/' },
      { label: 'mnt', path: '/mnt' },
      { label: 'data', path: '/mnt/data' },
    ]);
  });

  it('the root alone is one crumb; a trailing separator adds none', () => {
    expect(pathCrumbs('/')).toEqual([{ label: '/', path: '/' }]);
    expect(pathCrumbs('/home/founder/')).toEqual([
      { label: '/', path: '/' },
      { label: 'home', path: '/home' },
      { label: 'founder', path: '/home/founder' },
    ]);
  });

  it('keeps a POSIX backslash as filename data', () => {
    expect(pathCrumbs('/a/notes\\draft').map((c) => c.label)).toEqual(['/', 'a', 'notes\\draft']);
  });

  it('walks Windows drive and UNC paths in their own separator', () => {
    expect(pathCrumbs('C:\\Users\\founder')).toEqual([
      { label: 'C:\\', path: 'C:\\' },
      { label: 'Users', path: 'C:\\Users' },
      { label: 'founder', path: 'C:\\Users\\founder' },
    ]);
    expect(pathCrumbs('\\\\srv\\share\\docs').map((c) => c.path)).toEqual(['\\\\srv\\share', '\\\\srv\\share\\docs']);
  });

  it('a relative or empty path has no trail', () => {
    expect(pathCrumbs('docs/a')).toEqual([]);
    expect(pathCrumbs('')).toEqual([]);
  });
});
