import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createTempDir } from '../helpers/temp-fs.js';
import { openablePath } from '../../frontend/app/RelinkShell/path-link.js';
import { browseDir } from '../../backend/services/fs-browse.js';

const require = createRequire(import.meta.url);
const { browserTargetFor, browserRealTargetFor } = require('../../electron/open-in-browser.cjs');

describe('P6-141/P6-148 path doors', () => {
  it('refuses UNC, extended UNC and traversal before opening', () => {
    for (const hostile of ['\\\\host\\share\\x', '\\\\?\\UNC\\host\\share\\x', '//host/share/x', '/tmp/work/../outside', 'C:\\work\\..\\outside']) {
      expect(openablePath(hostile)).toBeNull();
      expect(browserTargetFor(hostile, ['/tmp'])).toBeNull();
    }
    expect(openablePath('C:\\work\\file.html')).toBe('C:\\work\\file.html');
    expect(openablePath('/tmp/name\\draft.md')).toBe('/tmp/name\\draft.md');
  });

  it('keeps legitimate browser files contained and refuses real symlink escapes', async () => {
    const root = await createTempDir('browser-root');
    const outside = await createTempDir('browser-outside');
    const inside = path.join(root, 'page.html');
    const escaped = path.join(outside, 'escape.html');
    await fs.writeFile(inside, '<p>inside</p>');
    await fs.writeFile(escaped, '<p>outside</p>');
    const link = path.join(root, 'link.html');
    await fs.symlink(escaped, link);
    expect(browserRealTargetFor(inside, [root])).toBe(`file://${inside}`);
    expect(browserTargetFor(`${root}-sibling/page.html`, [root])).toBeNull();
    expect(browserRealTargetFor(link, [root])).toBeNull();
    expect(browserRealTargetFor(escaped, [root])).toBeNull();
  });

  it('refuses UNC in the real browse service and still reads a real local directory', async () => {
    await expect(browseDir('\\\\host\\share')).rejects.toMatchObject({ code: 'EINVAL' });
    const root = await createTempDir('browse-local');
    await fs.writeFile(path.join(root, 'page.html'), 'ok');
    const result = await browseDir(root, { includeFiles: true });
    expect(result.path).toBe(root);
    expect(result.entries.map((entry) => entry.name)).toContain('page.html');
  });
});
