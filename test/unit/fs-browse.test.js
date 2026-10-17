/**
 * Tests for fs-browse — the directory navigator behind the folder picker.
 * Real filesystem (a temp tree): it lists ONLY sub-directories, flags hidden
 * (dot) dirs, reports the parent for "up", defaults to the home dir, and
 * surfaces a clean error for a missing path. No mocks — real fs.
 */
import { describe, expect, test, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createTempDir } from '../helpers/temp-fs.js';
import { browseDir, parseMounts, listDrives } from '../../backend/services/fs-browse.js';

describe('fs-browse — directory navigation, real fs', () => {
  let root;
  beforeEach(async () => {
    // Unique label per run — createTempDir only suffixes with Date.now(), so a
    // fixed label can collide when two beforeEach calls land in the same ms.
    root = await createTempDir(`fs-browse-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(path.join(root, 'alpha'));
    await fs.mkdir(path.join(root, 'beta'));
    await fs.mkdir(path.join(root, '.hidden'));
    await fs.writeFile(path.join(root, 'a-file.txt'), 'not a dir');
  });

  test('lists only sub-directories (files excluded), with absolute paths', async () => {
    const r = await browseDir(root);
    const names = r.entries.map((e) => e.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names).toContain('.hidden');
    expect(names).not.toContain('a-file.txt'); // a regular file is not a folder
    expect(names.indexOf('alpha')).toBeLessThan(names.indexOf('beta')); // sorted
    expect(r.entries.every((e) => path.isAbsolute(e.path))).toBe(true);
    expect(r.entries.find((e) => e.name === 'alpha').path).toBe(path.join(root, 'alpha'));
  });

  test('flags hidden (dot) directories', async () => {
    const r = await browseDir(root);
    expect(r.entries.find((e) => e.name === '.hidden').hidden).toBe(true);
    expect(r.entries.find((e) => e.name === 'alpha').hidden).toBe(false);
  });

  test('reports the parent for navigating up', async () => {
    const r = await browseDir(path.join(root, 'alpha'));
    expect(r.parent).toBe(root);
    expect(r.path).toBe(path.join(root, 'alpha'));
  });

  test('defaults to the home directory when no path is given', async () => {
    const r = await browseDir();
    expect(r.path).toBe(path.resolve(os.homedir()));
    expect(r.home).toBe(os.homedir());
    expect(Array.isArray(r.entries)).toBe(true);
  });

  test('a missing path throws with ENOENT', async () => {
    await expect(browseDir(path.join(root, 'nope'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('default mode tags every entry as a directory (dir: true)', async () => {
    const r = await browseDir(root);
    expect(r.entries.every((e) => e.dir === true)).toBe(true);
  });

  describe('file-pick mode (includeFiles)', () => {
    test('lists files AND directories, each tagged, dirs first', async () => {
      const r = await browseDir(root, { includeFiles: true });
      const names = r.entries.map((e) => e.name);
      expect(names).toContain('alpha');       // dir
      expect(names).toContain('a-file.txt');  // file now included
      const aFile = r.entries.find((e) => e.name === 'a-file.txt');
      expect(aFile.dir).toBe(false);
      expect(aFile.path).toBe(path.join(root, 'a-file.txt'));
      // Directories sort ahead of files.
      const lastDir = Math.max(...r.entries.filter((e) => e.dir).map((e) => names.indexOf(e.name)));
      const firstFile = Math.min(...r.entries.filter((e) => !e.dir).map((e) => names.indexOf(e.name)));
      expect(lastDir).toBeLessThan(firstFile);
    });

    test('a symlink to a real file is listed as a selectable file', async () => {
      await fs.symlink(path.join(root, 'a-file.txt'), path.join(root, 'link.txt'));
      const r = await browseDir(root, { includeFiles: true });
      const link = r.entries.find((e) => e.name === 'link.txt');
      expect(link).toBeTruthy();
      expect(link.dir).toBe(false);
    });
  });
});

describe('parseMounts — keep real filesystems, drop pseudo ones', () => {
  const SAMPLE = [
    'sysfs /sys sysfs rw,nosuid 0 0',
    'proc /proc proc rw 0 0',
    '/dev/nvme0n1p2 / ext4 rw,relatime 0 0',
    'tmpfs /run tmpfs rw,nosuid 0 0',
    '/dev/nvme0n1p1 /boot/efi vfat rw 0 0',
    '/dev/sda1 /mnt/my\\040drive ext4 rw 0 0',
    '/dev/sdb1 /workspace btrfs rw 0 0',
    'cgroup2 /sys/fs/cgroup cgroup2 rw 0 0',
    '/dev/sdc1 /media/founder/USB exfat rw 0 0',
    'overlay /var/lib/docker/x/merged overlay rw 0 0',
    '',
  ].join('\n');

  test('keeps real mounts, drops pseudo filesystems', () => {
    const m = parseMounts(SAMPLE);
    expect(m).toEqual(expect.arrayContaining(['/', '/workspace', '/boot/efi', '/media/founder/USB']));
    expect(m).not.toContain('/sys');
    expect(m).not.toContain('/proc');
    expect(m).not.toContain('/run');
    expect(m).not.toContain('/sys/fs/cgroup');
    expect(m.some((p) => p.includes('docker'))).toBe(false); // overlay dropped
  });

  test('drops mounts hidden under a dot-directory (AppImage FUSE)', () => {
    const m = parseMounts(`${SAMPLE}\nLM-Studio /tmp/.mount_LM-Stuo8yRPh fuse.LM-Studio.AppImage ro 0 0\n`);
    expect(m.some((p) => p.includes('.mount_'))).toBe(false);
    expect(m).toContain('/workspace');
  });

  test('decodes octal-escaped spaces in mountpoints', () => {
    expect(parseMounts(SAMPLE)).toContain('/mnt/my drive');
  });

  test('dedupes repeated mountpoints', () => {
    expect(parseMounts('/dev/a /mnt/x ext4 rw 0 0\n/dev/a /mnt/x ext4 rw 0 0')).toEqual(['/mnt/x']);
  });
});

describe('listDrives — real mounts on this host', () => {
  test('includes root, all absolute existing dirs, root labeled "/"', async () => {
    const drives = await listDrives();
    expect(Array.isArray(drives)).toBe(true);
    expect(drives.some((d) => d.path === '/')).toBe(true);
    expect(drives.every((d) => path.isAbsolute(d.path))).toBe(true);
    for (const d of drives) {
      expect((await fs.stat(d.path)).isDirectory()).toBe(true);
    }
    expect(drives.find((d) => d.path === '/').label).toBe('/');
  });
});
