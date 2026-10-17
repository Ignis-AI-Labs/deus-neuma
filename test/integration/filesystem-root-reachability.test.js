/**
 * ROOT REACHABILITY — a grant the kernel will not honour is never advertised.
 *
 * WHY THIS EXISTS. Design note, 2026-08-30: […] He had granted `/root`.
 * The platform runs as his own user; `/root` is `dr-xr-x---` owned by root.
 *
 * The grant check was `stat(dir).isDirectory()` — and that SUCCEEDS on a
 * directory this process cannot open, because stat needs permission on the
 * PARENT, not on the directory itself. So `/root` was admitted, painted in the
 * being's roots list, announced as ALWAYS ALLOWED, and then refused by the
 * kernel on every single read. The being re-listed its roots, saw the folder
 * still granted, and tried again. Nothing in a bare EACCES distinguishes the
 * operator's no (appealable) from the kernel's (not).
 *
 * NOT A MOCK, AND IT CANNOT BE. The entire defect lives in the gap between two
 * real syscalls on a real inode. A simulated filesystem would have whatever
 * gap the simulation author imagined — which is precisely the thing that was
 * wrong here. These tests build a real directory with real permission bits and
 * ask the real kernel.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { checkRootUsable, setNativeFilesystemRoots } from '../../backend/services/native-fs-roots.js';
import { nativeFilesystemClient } from '../../backend/services/native-filesystem.js';

let ground;
let unreadable;
let readable;
let missing;

beforeAll(async () => {
  ground = await createTempDir('fs-root-reachability');
  unreadable = path.join(ground, 'sealed');
  readable = path.join(ground, 'open');
  missing = path.join(ground, 'never-made');
  await fs.mkdir(unreadable);
  await fs.mkdir(readable);
  await fs.writeFile(path.join(readable, 'hello.txt'), 'hello\n');
  // The `/root` shape, reproduced: present, a directory, and closed to us.
  await fs.chmod(unreadable, 0o000);
});

afterAll(async () => {
  // Restore before cleanup or the temp dir cannot be removed.
  await fs.chmod(unreadable, 0o700).catch(() => {});
  await fs.rm(ground, { recursive: true, force: true }).catch(() => {});
});

describe('the conditions this test depends on are really true', () => {
  test('the sealed directory is genuinely unreadable BY THIS PROCESS', async () => {
    // Running as root would defeat the permission bits (CAP_DAC_OVERRIDE) and
    // every assertion below would pass without proving anything. Said out
    // loud, because a vacuous pass reads exactly like a real one.
    await expect(fs.readdir(unreadable)).rejects.toMatchObject({ code: 'EACCES' });
  });

  test('and `stat` STILL succeeds on it — the old check would still admit it', async () => {
    // The heart of the bug. If this ever stops being true the defect is gone
    // for a reason nobody recorded, and this test should be re-read.
    const stat = await fs.stat(unreadable);
    expect(stat.isDirectory()).toBe(true);
  });
});

describe('checkRootUsable answers with the reason, not just a boolean', () => {
  test('a readable directory is usable', async () => {
    expect(await checkRootUsable(readable)).toEqual({ ok: true, reason: null });
  });

  test('an unreadable one is refused, and says the permissions did it', async () => {
    const { ok, reason } = await checkRootUsable(unreadable);
    expect(ok).toBe(false);
    // The operator needs to know WHICH user hit the wall — "permission denied"
    // alone reads as a platform bug rather than a filesystem fact.
    expect(reason).toMatch(/cannot read it/);
    expect(reason).toMatch(/running as/);
  });

  test('a missing directory is refused DIFFERENTLY — the fixes are not the same', async () => {
    const { ok, reason } = await checkRootUsable(missing);
    expect(ok).toBe(false);
    expect(reason).toBe('it does not exist');
  });

  test('a file is not a root', async () => {
    const { ok, reason } = await checkRootUsable(path.join(readable, 'hello.txt'));
    expect(ok).toBe(false);
    expect(reason).toBe('it is a file, not a directory');
  });
});

describe('the wall never stands on ground it cannot read', () => {
  test('an unreadable directory is dropped from the roots it was handed', async () => {
    const roots = await setNativeFilesystemRoots([readable, unreadable]);
    expect(roots).toContain(readable);
    expect(roots).not.toContain(unreadable);
  });

  test('so it never appears in the folders a being is told it may reach', async () => {
    // The loop Founder watched: the being consulted this list, saw the folder, and
    // concluded its own call must have been wrong.
    await setNativeFilesystemRoots([readable, unreadable]);
    const listed = await nativeFilesystemClient.callTool({
      name: 'list_allowed_directories', arguments: {},
    });
    const text = listed.content.map((c) => c.text).join('\n');
    expect(text).toContain(readable);
    expect(text).not.toContain(unreadable);
  });

  test('a usable root still works end to end — the check is not just strict', async () => {
    await setNativeFilesystemRoots([readable]);
    const read = await nativeFilesystemClient.callTool({
      name: 'read_text_file', arguments: { path: path.join(readable, 'hello.txt') },
    });
    expect(read.isError).toBeFalsy();
    expect(read.content.map((c) => c.text).join('')).toContain('hello');
  });
});

describe('a kernel refusal tells the being which wall said no', () => {
  test('an EACCES below an allowed root names the operating system, not a grant', async () => {
    // The sealed folder sits INSIDE an allowed root, so the grant wall passes
    // and the kernel is what refuses — the case that survives the fix above
    // and still has to be explainable.
    await setNativeFilesystemRoots([ground]);
    const result = await nativeFilesystemClient.callTool({
      name: 'list_directory', arguments: { path: unreadable },
    });
    expect(result.isError).toBe(true);
    const text = result.content.map((c) => c.text).join('\n');
    expect(text).toMatch(/OPERATING SYSTEM/);
    // The two things a being must not do next: ask for a grant, or retry.
    expect(text).toMatch(/asking your operator for access\s+cannot open it/);
    expect(text).toMatch(/retrying will fail identically/);
  });

  test('a missing path keeps its OWN answer — the walls stay distinguishable', async () => {
    await setNativeFilesystemRoots([ground]);
    const result = await nativeFilesystemClient.callTool({
      name: 'list_directory', arguments: { path: missing },
    });
    expect(result.isError).toBe(true);
    const text = result.content.map((c) => c.text).join('\n');
    expect(text).toMatch(/does not exist/);
    expect(text).not.toMatch(/OPERATING SYSTEM/);
  });

  test('a path outside every root keeps ITS own answer too', async () => {
    await setNativeFilesystemRoots([readable]);
    const result = await nativeFilesystemClient.callTool({
      name: 'list_directory', arguments: { path: ground },
    });
    expect(result.isError).toBe(true);
    const text = result.content.map((c) => c.text).join('\n');
    expect(text).toMatch(/grant wall/);
    expect(text).not.toMatch(/OPERATING SYSTEM/);
  });
});
