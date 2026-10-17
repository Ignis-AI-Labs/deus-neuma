/**
 * THE GALLERY's containment + classification, over a REAL temp filesystem.
 * No fs mock anywhere (RULE 0): a mocked symlink would prove nothing about
 * whether a real symlink can walk out of an allowed root, which is the only
 * property standing between "read this folder" and "read this disk".
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  kindOf, mimeOf, isInsideRoot, scanRoot, resolveInRoot, MAX_DEPTH,
} from '../../backend/services/gallery/media-scan.js';

let base;
let root;
let outside;
beforeEach(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'gallery-'));
  root = path.join(base, 'allowed');
  outside = path.join(base, 'private');
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, 'secret.png'), 'SECRET');
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const asRoot = () => ({ id: 'r', label: 'R', dir: root });

describe('kindOf / mimeOf — pure', () => {
  test('images and videos are told apart by extension', () => {
    expect(kindOf('a.png')).toBe('image');
    expect(kindOf('a.JPEG')).toBe('image');
    expect(kindOf('a.mp4')).toBe('video');
    expect(kindOf('a.WEBM')).toBe('video');
  });

  test('non-media is not media', () => {
    for (const n of ['a.txt', 'a.json', 'a', 'a.exe', '']) expect(kindOf(n)).toBeNull();
  });

  test('mime is served from the extension', () => {
    expect(mimeOf('a.png')).toBe('image/png');
    expect(mimeOf('a.mp4')).toBe('video/mp4');
    expect(mimeOf('a.weird')).toBe('application/octet-stream');
  });
});

describe('isInsideRoot — pure', () => {
  test('a sibling with the root as a NAME PREFIX is outside', () => {
    // The bug a bare startsWith would have: /media/photos-private is not
    // inside /media/photos.
    expect(isInsideRoot('/media/photos-private/x.png', '/media/photos')).toBe(false);
    expect(isInsideRoot('/media/photos/x.png', '/media/photos')).toBe(true);
    expect(isInsideRoot('/media/photos', '/media/photos')).toBe(true);
  });

  test('empty inputs are outside', () => {
    expect(isInsideRoot('', '/a')).toBe(false);
    expect(isInsideRoot('/a/b', '')).toBe(false);
  });
});

describe('scanRoot — real files', () => {
  test('finds media, skips non-media and hidden files', async () => {
    writeFileSync(path.join(root, 'a.png'), 'x');
    writeFileSync(path.join(root, 'b.mp4'), 'x');
    writeFileSync(path.join(root, 'notes.txt'), 'x');
    writeFileSync(path.join(root, '.hidden.png'), 'x');
    const { items } = await scanRoot(asRoot());
    expect(items.map((i) => i.name).sort()).toEqual(['a.png', 'b.mp4']);
    expect(items.find((i) => i.name === 'b.mp4').kind).toBe('video');
  });

  test('walks subfolders and reports root-relative paths', async () => {
    mkdirSync(path.join(root, 'sub', 'deeper'), { recursive: true });
    writeFileSync(path.join(root, 'sub', 'deeper', 'c.png'), 'x');
    const { items } = await scanRoot(asRoot());
    expect(items[0].rel).toBe(path.join('sub', 'deeper', 'c.png'));
  });

  test('does NOT follow a symlinked directory out of the root', async () => {
    // The escape a naive recursive walk makes: a link to somewhere private.
    symlinkSync(outside, path.join(root, 'escape'), 'dir');
    const { items } = await scanRoot(asRoot());
    expect(items.find((i) => i.name === 'secret.png')).toBeUndefined();
    expect(items).toHaveLength(0);
  });

  test('drops a symlinked FILE whose real path is outside the root', async () => {
    symlinkSync(path.join(outside, 'secret.png'), path.join(root, 'linked.png'));
    const { items } = await scanRoot(asRoot());
    expect(items).toHaveLength(0);
  });

  test('stops at the depth bound instead of walking forever', async () => {
    let deep = root;
    for (let i = 0; i <= MAX_DEPTH + 2; i += 1) {
      deep = path.join(deep, `d${i}`);
      mkdirSync(deep, { recursive: true });
      writeFileSync(path.join(deep, `f${i}.png`), 'x');
    }
    const { items } = await scanRoot(asRoot());
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(MAX_DEPTH + 1);
  });

  test('a missing folder reports an error rather than throwing', async () => {
    const r = await scanRoot({ id: 'x', label: 'X', dir: path.join(base, 'nope') });
    expect(r.error).toBe('folder not found');
    expect(r.items).toEqual([]);
  });
});

describe('resolveInRoot — the serve path', () => {
  test('resolves a real file inside the root', async () => {
    writeFileSync(path.join(root, 'a.png'), 'x');
    expect(await resolveInRoot(asRoot(), 'a.png')).toBe(path.join(await import('fs').then((m) => m.promises.realpath(root)), 'a.png'));
  });

  test('refuses traversal out of the root', async () => {
    expect(await resolveInRoot(asRoot(), '../private/secret.png')).toBeNull();
    expect(await resolveInRoot(asRoot(), 'sub/../../private/secret.png')).toBeNull();
  });

  test('refuses an absolute path outright', async () => {
    expect(await resolveInRoot(asRoot(), path.join(outside, 'secret.png'))).toBeNull();
  });

  test('refuses a symlink that escapes, even though it lives inside', async () => {
    symlinkSync(path.join(outside, 'secret.png'), path.join(root, 'linked.png'));
    expect(await resolveInRoot(asRoot(), 'linked.png')).toBeNull();
  });

  test('refuses a directory and a missing file', async () => {
    mkdirSync(path.join(root, 'adir'), { recursive: true });
    expect(await resolveInRoot(asRoot(), 'adir')).toBeNull();
    expect(await resolveInRoot(asRoot(), 'ghost.png')).toBeNull();
    expect(await resolveInRoot(asRoot(), '')).toBeNull();
  });
});
