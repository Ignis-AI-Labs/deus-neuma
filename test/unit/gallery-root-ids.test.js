/**
 * A GALLERY ROOT'S ID NAMES ONE FOLDER (security seat, 2026-10-19). The id was
 * the folder path's first 22 base64url characters — 16 bytes — so every
 * folder sharing a 16-byte prefix (`/home/someone/a`, `/home/someone/b`, every
 * lane under one workspaces root) shared an id, and /file and DELETE by id
 * reached whichever row came first. The id is now the whole path, hashed; a
 * row stored under the old id keeps it and still resolves.
 *
 * The real fold and lookup, real inputs (RULE 0).
 */
import { applyRootChange, rootById, rootIdOf } from '../../backend/services/gallery/gallery-roots.js';

describe('gallery root ids', () => {
  test('two folders that share a long prefix get two ids, and each id finds its own folder', () => {
    const a = '/home/someone/workspaces/lane-one/art';
    const b = '/home/someone/workspaces/lane-two/art';
    const roots = applyRootChange(applyRootChange([], { op: 'add', dir: a }).roots, { op: 'add', dir: b }).roots;
    expect(roots).toHaveLength(2);
    expect(new Set(roots.map((r) => r.id)).size).toBe(2);
    expect(rootById(roots, rootIdOf(a)).dir).toBe(a);
    expect(rootById(roots, rootIdOf(b)).dir).toBe(b);
    // removing one takes that folder alone
    expect(applyRootChange(roots, { op: 'remove', id: rootIdOf(a) }).roots.map((r) => r.dir)).toEqual([b]);
  });

  test('the id is the full path hashed — 16 bytes of sha256, never a prefix of the path', () => {
    expect(rootIdOf('/media/photos')).toMatch(/^root-[0-9a-f]{32}$/);
    expect(rootIdOf('/media/photos')).toBe(rootIdOf('/media/photos'));
    expect(rootIdOf('/media/photos')).not.toBe(rootIdOf('/media/photos2'));
  });

  test('a row stored under the old prefix id keeps it: it still resolves and still removes', () => {
    const dir = '/media/photos';
    const oldId = `root-${Buffer.from(dir).toString('base64url').slice(0, 22)}`;
    const stored = [{ id: oldId, label: 'photos', dir }];
    expect(rootById(stored, oldId).dir).toBe(dir);
    // adding the same folder again is still a no-op, never a second row
    expect(applyRootChange(stored, { op: 'add', dir }).roots).toEqual(stored);
    expect(applyRootChange(stored, { op: 'remove', id: oldId }).roots).toEqual([]);
  });
});
