/**
 * The drop decision — pure, so the tree's behavior is pinned without a DOM:
 * where an OS drop LANDS (folder row → inside it, file row → beside it,
 * nowhere → nowhere), what counts as an OS file drag, and the browser
 * drag-out's DownloadURL shape.
 */
import { describe, it, expect } from 'vitest';
import { dropDirForRow, dragCarriesFiles, downloadUrlFor } from '../../frontend/app/RelinkShell/files/files-drop.js';

describe('dropDirForRow — the file manager\'s own grammar', () => {
  it('a folder row takes the drop INTO itself', () => {
    expect(dropDirForRow({ path: '/home/founder/plans', type: 'dir' })).toBe('/home/founder/plans');
  });

  it('a file row takes the drop BESIDE itself — its parent', () => {
    expect(dropDirForRow({ path: '/home/founder/plans/report.pdf', type: 'file' })).toBe('/home/founder/plans');
    expect(dropDirForRow({ path: '/report.pdf', type: 'file' })).toBe('/');
  });

  it('nothing usable, no place — the pane never guesses a folder', () => {
    expect(dropDirForRow(null)).toBeNull();
    expect(dropDirForRow({})).toBeNull();
    expect(dropDirForRow({ path: '' })).toBeNull();
  });
});

describe('dragCarriesFiles', () => {
  it('Files in the types means the OS is offering files', () => {
    expect(dragCarriesFiles({ types: ['Files'] })).toBe(true);
    expect(dragCarriesFiles({ types: ['text/plain'] })).toBe(false);
    expect(dragCarriesFiles(null)).toBe(false);
    expect(dragCarriesFiles({})).toBe(false);
  });
});

describe('downloadUrlFor — the browser drag-out', () => {
  const raw = (p) => `/api/v1/user/files/raw?path=${encodeURIComponent(p)}&token=t`;

  it('a file row yields a Chromium DownloadURL with its name and the raw URL', () => {
    expect(downloadUrlFor({ path: '/home/founder/plans/report.pdf', name: 'report.pdf', type: 'file' }, raw))
      .toBe(`application/octet-stream:report.pdf:${raw('/home/founder/plans/report.pdf')}`);
  });

  it('a folder has no single-file form — null, and the caller says so', () => {
    expect(downloadUrlFor({ path: '/home/founder/plans', type: 'dir' }, raw)).toBeNull();
    expect(downloadUrlFor(null, raw)).toBeNull();
  });
});
