// fs-browse-mkdir.test.js — the picker's NEW FOLDER on real disk: a clean
// segment lands as a directory; everything path-shaped about the name is
// refused before mkdir is ever reached.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDirIn } from '../../backend/services/fs-browse.js';

let parent;

beforeEach(() => { parent = mkdtempSync(path.join(os.tmpdir(), 'mkdir-')); });
afterEach(() => { rmSync(parent, { recursive: true, force: true }); });

describe('createDirIn — the picker makes a place', () => {
  it('creates the folder and returns its absolute path', async () => {
    const { path: created } = await createDirIn(parent, ' annex ');
    expect(created).toBe(path.join(parent, 'annex'));
    expect(existsSync(created)).toBe(true);
  });

  it('refuses an existing target rather than silently reusing it', async () => {
    await createDirIn(parent, 'annex');
    await expect(createDirIn(parent, 'annex')).rejects.toThrow(/already exists/);
  });

  it.each([
    ['relative parent', 'not/absolute', 'annex', /absolute/],
    ['empty name', null, '   ', /1-128/],
    ['overlong name', null, 'x'.repeat(129), /1-128/],
    ['separator in name', null, 'a/b', /single clean path segment/],
    ['backslash in name', null, 'a\\b', /single clean path segment/],
    ['dot-dot traversal', null, '..', /single clean path segment/],
    ['bare dot', null, '.', /single clean path segment/],
    ['newline in name', null, 'a\nb', /single clean path segment/],
    ['tab in name', null, 'a\tb', /single clean path segment/],
  ])('refuses %s', async (_label, badParent, name, msg) => {
    await expect(createDirIn(badParent ?? parent, name)).rejects.toThrow(msg);
  });

  it('a missing parent surfaces ENOENT', async () => {
    await expect(createDirIn(path.join(parent, 'missing'), 'annex'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(existsSync(path.join(parent, 'missing', 'annex'))).toBe(false);
  });

  it('refuses a parent that is a regular file', async () => {
    const file = path.join(parent, 'a-file');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, 'x');
    await expect(createDirIn(file, 'annex')).rejects.toThrow(/not a directory/);
    expect(existsSync(path.join(file, 'annex'))).toBe(false);
  });

  it('a race-created twin surfaces as the friendly already-exists refusal (mkdir is the truth)', async () => {
    await createDirIn(parent, 'annex');
    // The pre-check is gone — mkdir's own EEXIST maps to the refusal.
    await expect(createDirIn(parent, 'annex')).rejects.toMatchObject({ code: 'EEXIST' });
  });
});
