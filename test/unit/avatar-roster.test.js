// avatar-roster.test.js — held-avatar listing (real filesystem) and the pure
// wear-selection logic behind the avatar switcher.

import { describe, it, expect } from 'vitest';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { listAvatars } from '../../backend/services/avatar-roster.js';
import { chooseVessel } from '../../frontend/app/RelinkShell/vessel/vessel-roster.js';

describe('listAvatars (real disk)', () => {
  it('lists root and test-fleet vessels with /model-relative names', async () => {
    const dir = await createTempDir('vessel-roster');
    await writeFile(join(dir, 'Base.vrm'), 'x');
    await writeFile(join(dir, 'Readme.txt'), 'not a vessel');
    await mkdir(join(dir, 'test'));
    await writeFile(join(dir, 'test', 'Ryuki_KENORIE.vrm'), 'x');
    await writeFile(join(dir, 'test', 'notes.md'), 'not a vessel');

    expect(await listAvatars(dir)).toEqual([
      { name: 'Base.vrm', displayName: 'Base' },
      { name: 'test/Ryuki_KENORIE.vrm', displayName: 'test · Ryuki KENORIE' },
    ]);
  });

  it('keeps same-named root and fleet vessels distinguishable in the label', async () => {
    const dir = await createTempDir('vessel-roster-collide');
    await writeFile(join(dir, 'Ryuki.vrm'), 'x');
    await mkdir(join(dir, 'test'));
    await writeFile(join(dir, 'test', 'Ryuki.vrm'), 'x');
    const labels = (await listAvatars(dir)).map((v) => v.displayName);
    expect(new Set(labels).size).toBe(2);
  });

  // root bypasses permission bits, so chmod 000 can't force the failure there
  it.skipIf(process.getuid?.() === 0)('surfaces real IO failures instead of reading them as an empty roster', async () => {
    const dir = await createTempDir('vessel-roster-eacces');
    const { chmod } = await import('fs/promises');
    await chmod(dir, 0o000);
    try {
      await expect(listAvatars(dir)).rejects.toThrow();
    } finally {
      await chmod(dir, 0o755);
    }
  });

  it('returns an empty roster for an empty or missing directory', async () => {
    const dir = await createTempDir('vessel-roster-empty');
    expect(await listAvatars(dir)).toEqual([]);
    expect(await listAvatars(join(dir, 'does-not-exist'))).toEqual([]);
  });

  it('sorts each directory level deterministically', async () => {
    const dir = await createTempDir('vessel-roster-sort');
    await writeFile(join(dir, 'b.vrm'), 'x');
    await writeFile(join(dir, 'a.vrm'), 'x');
    const names = (await listAvatars(dir)).map((v) => v.name);
    expect(names).toEqual(['a.vrm', 'b.vrm']);
  });
});

describe('#261 — LFS pointer stubs are not avatars', () => {
  // The verbatim pointer text an LFS-less checkout holds at model/Evra.vrm.
  const LFS_POINTER = [
    'version https://git-lfs.github.com/spec/v1',
    'oid sha256:7678948daf279dae811a8ed7f1cc2a33a2c215c51ec370eb068d25cfc887fec7',
    'size 19692416',
    '',
  ].join('\n');

  it('a pointer stub beside a held model is not listed', async () => {
    const dir = await createTempDir('vessel-roster-lfs');
    await writeFile(join(dir, 'Evra.vrm'), LFS_POINTER);
    await writeFile(join(dir, 'Velara.vrm'), 'x');
    expect(await listAvatars(dir)).toEqual([{ name: 'Velara.vrm', displayName: 'Velara' }]);
  });

  it('a fleet of pointers alone reads as the empty roster — NONE HELD becomes reachable', async () => {
    const dir = await createTempDir('vessel-roster-lfs-only');
    for (const f of ['Evra.vrm', 'Dhahlia.vrm', 'Lara Lightland.vrm']) {
      await writeFile(join(dir, f), LFS_POINTER);
    }
    expect(await listAvatars(dir)).toEqual([]);
  });

  it('the test fleet gets the same filtering', async () => {
    const dir = await createTempDir('vessel-roster-lfs-fleet');
    await mkdir(join(dir, 'test'));
    await writeFile(join(dir, 'test', 'probe.vrm'), 'x');
    await writeFile(join(dir, 'test', 'stub.vrm'), LFS_POINTER);
    const names = (await listAvatars(dir)).map((v) => v.name);
    expect(names).toEqual(['test/probe.vrm']);
  });

  it('a real model larger than a pointer could ever be is never read for content', async () => {
    const dir = await createTempDir('vessel-roster-lfs-big');
    // 2KB opening with the pointer line: over the spec's 1024-byte cap, so it
    // is a (corrupt) model, not a pointer — the stat gate must keep it listed.
    await writeFile(join(dir, 'odd.vrm'), LFS_POINTER + 'z'.repeat(2048));
    const names = (await listAvatars(dir)).map((v) => v.name);
    expect(names).toEqual(['odd.vrm']);
  });
});

describe('chooseVessel (pure)', () => {
  const roster = [{ name: 'a.vrm' }, { name: 'test/b.vrm' }];

  it('keeps a stored choice that still exists', () => {
    expect(chooseVessel(roster, 'test/b.vrm')).toBe('test/b.vrm');
  });

  it('falls back to the first held vessel when the stored one is gone', () => {
    expect(chooseVessel(roster, 'deleted.vrm')).toBe('a.vrm');
  });

  it('falls back to the first held vessel without a stored choice', () => {
    expect(chooseVessel(roster, null)).toBe('a.vrm');
  });

  it('returns null when nothing is held', () => {
    expect(chooseVessel([], 'anything.vrm')).toBeNull();
  });
});
