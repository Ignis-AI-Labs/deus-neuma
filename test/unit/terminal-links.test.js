import { describe, test, expect } from 'vitest';
import { linksIn, linkAt, doorsIn, doorAt, pathsIn, terminalPathFor, terminalCellAt, TERMINAL_LINK_ITEMS } from '../../frontend/app/RelinkShell/terminal/terminal-links.js';

describe('terminal URLs', () => {
  test('finds the Vite local and network addresses with their exact cells', () => {
    const line = '  ➜  Local:   http://localhost:5173/  ➜  Network: http://127.0.0.1:4173/';
    expect(linksIn(line).map((link) => link.url)).toEqual(['http://localhost:5173/', 'http://127.0.0.1:4173/']);
    const local = linksIn(line)[0];
    expect(linkAt(line, local.start + 1)).toEqual(local);
    expect(linkAt(line, local.end)).toEqual(local);
    expect(linkAt(line, local.end + 1)).toBeNull();
  });

  test('trims sentence punctuation but preserves the URL path and query', () => {
    expect(linksIn('open https://example.test/run?x=1&y=2).')[0].url).toBe('https://example.test/run?x=1&y=2');
  });

  test('rejects non-http schemes, malformed URLs, and cells away from links', () => {
    expect(linksIn('file:///tmp/a smb://server/share no-url')).toEqual([]);
    expect(linkAt('plain terminal output', 4)).toBeNull();
  });

  test('maps pointer coordinates into cells and refuses points outside the screen', () => {
    const rect = { left: 100, top: 50, width: 800, height: 400 };
    expect(terminalCellAt({ clientX: 180, clientY: 90, rect, cols: 80, rows: 40 })).toEqual({ x: 9, y: 5 });
    expect(terminalCellAt({ clientX: 99, clientY: 90, rect, cols: 80, rows: 40 })).toBeNull();
    expect(terminalCellAt({ clientX: 180, clientY: 90, rect: { ...rect, width: 0 }, cols: 80, rows: 40 })).toBeNull();
  });

  test('finds absolute, relative, and root-file paths, stripping editor line suffixes', () => {
    expect(pathsIn('/workspace/repos/project-vugotis/docs/design/ref.png').map((door) => door.value))
      .toContain('/workspace/repos/project-vugotis/docs/design/ref.png');
    expect(pathsIn('backend/services/image-forge/parameterizer.js:177').map((door) => door.value))
      .toContain('backend/services/image-forge/parameterizer.js');
    expect(pathsIn('AGENTS.md TODO.md').map((door) => door.value)).toEqual(['AGENTS.md', 'TODO.md']);
    expect(doorAt('read docs/design/ref.png', 7).value).toBe('docs/design/ref.png');
  });

  test('resolves relative paths against the terminal cwd and leaves commands alone', () => {
    expect(terminalPathFor('docs/design/ref.png', '/workspace/repos/project-vugotis'))
      .toBe('/workspace/repos/project-vugotis/docs/design/ref.png');
    expect(terminalPathFor('/mnt/absolute/file.md', '/other')).toBe('/mnt/absolute/file.md');
    expect(pathsIn('npm run dev git diff --check')).toEqual([]);
  });

  test('URLs and paths share one hit-test without overlap', () => {
    const doors = doorsIn('open http://localhost:5173/ then /mnt/file.md');
    expect(doors.map((door) => door.kind)).toEqual(['url', 'path']);
  });

  test('offers both browser destinations', () => {
    expect(TERMINAL_LINK_ITEMS.map((item) => item.id)).toEqual(['integrated', 'external']);
  });
});
