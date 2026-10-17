/**
 * Tests for the user-files containment guard — the single hard boundary that
 * keeps the explorer inside the witness's chosen roots. Uses real temp dirs
 * and a real symlink so the resolve + startsWith + realpath defense is
 * exercised against the actual filesystem, not a mock.
 */

import { describe, expect, test, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync, statSync, utimesSync, rmSync } from 'fs';
import path from 'path';
import { containWithinRoots, setRoots, getRoots, createEntry, renamePath, deletePath, readFile, writeFile } from '../../backend/services/user-files.js';
import { createTempDir } from '../helpers/temp-fs.js';

describe('containWithinRoots', () => {
  let root;
  beforeEach(async () => {
    root = await createTempDir('uf-root');
    setRoots([root]);
  });

  test('a path inside a root resolves (even if it does not exist yet)', () => {
    const target = path.join(root, 'sub', 'file.txt');
    expect(containWithinRoots(target)).toBe(target);
  });

  test('an existing path inside a root resolves to its real path', () => {
    mkdirSync(path.join(root, 'sub'));
    const target = path.join(root, 'sub');
    expect(containWithinRoots(target)).toBe(target);
  });

  test('a `..` escape is rejected', () => {
    expect(() => containWithinRoots(path.join(root, '..', 'outside.txt'))).toThrow(/outside allowed roots/);
  });

  test('a non-absolute path is rejected', () => {
    expect(() => containWithinRoots('relative/path')).toThrow(/absolute/);
  });

  test('a partial-name sibling (/rootX vs /root) is rejected', () => {
    setRoots(['/foo/root']);
    expect(() => containWithinRoots('/foo/rootX/file')).toThrow(/outside allowed roots/);
  });

  test('a symlink inside a root pointing OUT is rejected', async () => {
    const outside = await createTempDir('uf-outside');
    writeFileSync(path.join(outside, 'secret.txt'), 'classified');
    symlinkSync(outside, path.join(root, 'escape'));
    // Lexically inside the root, but realpath lands outside → must be denied.
    expect(() => containWithinRoots(path.join(root, 'escape', 'secret.txt'))).toThrow(/outside allowed roots/);
  });

  test('multiple roots: a path in the second root is allowed', async () => {
    const second = await createTempDir('uf-root2');
    setRoots([root, second]);
    const target = path.join(second, 'ok.txt');
    expect(containWithinRoots(target)).toBe(target);
    expect(getRoots()).toContain(second);
  });
});

describe('createEntry / renamePath / deletePath — real filesystem, root-contained', () => {
  let root;
  beforeEach(async () => {
    root = await createTempDir('uf-crud');
    setRoots([root]);
  });

  test('creates a file and a folder, refusing to clobber', async () => {
    await createEntry(path.join(root, 'notes.txt'), 'file');
    await createEntry(path.join(root, 'sub'), 'dir');
    expect(existsSync(path.join(root, 'notes.txt'))).toBe(true);
    expect(existsSync(path.join(root, 'sub'))).toBe(true);
    await expect(createEntry(path.join(root, 'notes.txt'), 'file')).rejects.toThrow(/already exists/);
  });

  test('refuses to create when the parent does not exist', async () => {
    await expect(createEntry(path.join(root, 'missing', 'x.txt'), 'file')).rejects.toThrow(/Parent directory/);
  });

  test('renames a file, preserving contents', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'hello');
    const r = await renamePath(path.join(root, 'a.txt'), path.join(root, 'b.txt'));
    expect(r.path).toBe(path.join(root, 'b.txt'));
    expect(existsSync(path.join(root, 'a.txt'))).toBe(false);
    expect(readFileSync(path.join(root, 'b.txt'), 'utf8')).toBe('hello');
  });

  test('refuses to rename or delete an open root itself', async () => {
    // Target stays inside the root so the open-root guard (not containment) is
    // what rejects — renaming the root from under the explorer is the hazard.
    await expect(renamePath(root, path.join(root, 'hijack'))).rejects.toThrow(/open root/);
    await expect(deletePath(root)).rejects.toThrow(/open root/);
  });

  test('deletes a file, and a folder recursively', async () => {
    writeFileSync(path.join(root, 'gone.txt'), 'x');
    await deletePath(path.join(root, 'gone.txt'));
    expect(existsSync(path.join(root, 'gone.txt'))).toBe(false);

    mkdirSync(path.join(root, 'tree', 'deep'), { recursive: true });
    writeFileSync(path.join(root, 'tree', 'deep', 'f.txt'), 'y');
    await deletePath(path.join(root, 'tree'));
    expect(existsSync(path.join(root, 'tree'))).toBe(false);
  });

  test('a `..` escape on a mutating op is rejected', async () => {
    await expect(createEntry(path.join(root, '..', 'evil.txt'), 'file')).rejects.toThrow(/outside allowed roots/);
    await expect(deletePath(path.join(root, '..', 'anything'))).rejects.toThrow(/outside allowed roots/);
  });
});

// THE TWO-WAY BRIDGE (Design note, 2026-07-28 — the upload's name law and the
// binary acts, real temp disk.
describe('sanitizeUploadName / suffixedName (pure)', () => {
  it('a plain name passes; paths, traversal, and dot-names are refused', async () => {
    const { sanitizeUploadName } = await import('../../backend/services/user-files.js');
    expect(sanitizeUploadName('culture.png')).toBe('culture.png');
    expect(sanitizeUploadName('.env')).toBe('.env');
    expect(() => sanitizeUploadName('../evil.txt')).toThrow(/plain file name|refusing/);
    expect(() => sanitizeUploadName('a/b.txt')).toThrow(/plain file name/);
    expect(() => sanitizeUploadName('a\\b.txt')).toThrow(/plain file name/);
    expect(() => sanitizeUploadName('..')).toThrow(/refusing/);
    expect(() => sanitizeUploadName('')).toThrow(/needs a file name/);
  });

  it('the collision form keeps the extension and the dotfile dot', async () => {
    const { suffixedName } = await import('../../backend/services/user-files.js');
    expect(suffixedName('report.pdf', 2)).toBe('report (2).pdf');
    expect(suffixedName('archive.tar.gz', 3)).toBe('archive.tar (3).gz');
    expect(suffixedName('noext', 2)).toBe('noext (2)');
    expect(suffixedName('.env', 2)).toBe('.env (2)');
  });
});

describe('writeBinary / resolveBinaryFile — real filesystem, root-contained', () => {
  let root;
  beforeEach(async () => {
    root = await createTempDir('uf-bridge');
    setRoots([root]);
  });

  test('bytes land byte-for-byte; a collision suffixes and never clobbers', async () => {
    const { writeBinary } = await import('../../backend/services/user-files.js');
    const bytes = Buffer.from([1, 2, 3, 4, 5]);
    const first = await writeBinary(root, 'pic.bin', bytes);
    expect(first).toMatchObject({ name: 'pic.bin', renamed: false, size: 5 });
    expect(readFileSync(first.path).equals(bytes)).toBe(true);

    const second = await writeBinary(root, 'pic.bin', Buffer.from([9, 9]));
    expect(second.name).toBe('pic (2).bin');
    expect(second.renamed).toBe(true);
    expect(readFileSync(first.path).equals(bytes)).toBe(true); // the original stands
  });

  test('a missing folder, an escape, and oversize are refused honestly', async () => {
    const { writeBinary, UPLOAD_MAX_BYTES } = await import('../../backend/services/user-files.js');
    await expect(writeBinary(path.join(root, 'gone'), 'x.bin', Buffer.from([1]))).rejects.toThrow(/not an existing folder/);
    await expect(writeBinary('/tmp', 'x.bin', Buffer.from([1]))).rejects.toThrow(/outside allowed roots/);
    await expect(writeBinary(root, 'x.bin', Buffer.alloc(UPLOAD_MAX_BYTES + 1, 1))).rejects.toThrow(/bridge carries up to/);
  });

  test('resolveBinaryFile answers the real path + size for a file, and refuses a directory', async () => {
    const { resolveBinaryFile } = await import('../../backend/services/user-files.js');
    writeFileSync(path.join(root, 'note.txt'), 'hello');
    const { real, size } = await resolveBinaryFile(path.join(root, 'note.txt'));
    expect(real).toBe(path.join(root, 'note.txt'));
    expect(size).toBe(5);
    mkdirSync(path.join(root, 'afolder'));
    await expect(resolveBinaryFile(path.join(root, 'afolder'))).rejects.toThrow(/Not a file/);
    await expect(resolveBinaryFile('/etc/hostname')).rejects.toThrow(/outside allowed roots/);
  });
});

describe('#235 — conditional write (real filesystem)', () => {
  let root;
  beforeEach(async () => {
    root = await createTempDir('uf-conflict');
    setRoots([root]);
  });

  test('readFile stamps the mtime the buffer was read at', async () => {
    const f = path.join(root, 'a.txt');
    writeFileSync(f, 'first');
    const r = await readFile(f);
    expect(r.mtimeMs).toBe(statSync(f).mtimeMs);
  });

  test('a save carrying the read stamp lands and returns the fresh one', async () => {
    const f = path.join(root, 'a.txt');
    writeFileSync(f, 'first');
    const { mtimeMs } = await readFile(f);
    const w = await writeFile(f, 'second', mtimeMs);
    expect(readFileSync(f, 'utf8')).toBe('second');
    expect(w.mtimeMs).toBe(statSync(f).mtimeMs);
  });

  test('disk moved since the read → CONFLICT, and the external work survives', async () => {
    const f = path.join(root, 'a.txt');
    writeFileSync(f, 'first');
    const { mtimeMs } = await readFile(f);
    writeFileSync(f, 'external work');
    // Two writes can share a millisecond stamp; push mtime forward so the
    // divergence is deterministic, the way real elapsed time would.
    utimesSync(f, new Date(), new Date(Date.now() + 2000));
    await expect(writeFile(f, 'stale buffer', mtimeMs)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(readFileSync(f, 'utf8')).toBe('external work');
  });

  test('the file removed since the read → CONFLICT, nothing recreated', async () => {
    const f = path.join(root, 'a.txt');
    writeFileSync(f, 'first');
    const { mtimeMs } = await readFile(f);
    rmSync(f);
    await expect(writeFile(f, 'stale buffer', mtimeMs)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(existsSync(f)).toBe(false);
  });

  test('no precondition stated → the unconditional path stands (a being tool call)', async () => {
    const f = path.join(root, 'a.txt');
    writeFileSync(f, 'first');
    utimesSync(f, new Date(), new Date(Date.now() + 2000));
    await writeFile(f, 'unconditional');
    expect(readFileSync(f, 'utf8')).toBe('unconditional');
  });

  test('a malformed precondition is refused, never silently ignored', async () => {
    const f = path.join(root, 'a.txt');
    writeFileSync(f, 'first');
    await expect(writeFile(f, 'x', 'not-a-number')).rejects.toThrow(/finite number/);
  });
});

describe('setRoots — empty stays empty, home is not implied', () => {
  test('setRoots([]) does not fall back to the home directory', () => {
    setRoots([]);
    expect(getRoots()).toEqual([]);
  });
});

