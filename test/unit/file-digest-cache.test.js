/**
 * Digest memo — a stable inode snapshot must not be re-read. RULE 0: real file.
 */
import { describe, expect, test } from 'vitest';
import { lstat, writeFile } from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  digestIdentityKey, rememberedDigest, sha256FileStable,
} from '../../backend/services/file-digest.js';

describe('digest identity memo', () => {
  test('equal inode snapshots share a key; a size change does not', () => {
    const a = { dev: 1n, ino: 2n, size: 10n, mtimeNs: 3n, ctimeNs: 4n };
    expect(digestIdentityKey(a)).toBe(digestIdentityKey({ ...a }));
    expect(digestIdentityKey(a)).not.toBe(digestIdentityKey({ ...a, size: 11n }));
  });

  test('a real file remembers its digest after the first stable hash', async () => {
    const dir = await createTempDir('digest-cache');
    const file = path.join(dir, 'w.bin');
    await writeFile(file, 'hello-digest-memo');
    const sha = await sha256FileStable(file, { maximumBytes: 1000 });
    const stat = await lstat(file, { bigint: true });
    expect(rememberedDigest(stat)).toBe(sha);
    expect(await sha256FileStable(file, { maximumBytes: 1000 })).toBe(sha);
  });
});
