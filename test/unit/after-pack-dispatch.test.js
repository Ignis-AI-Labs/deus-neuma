/**
 * The single afterPack slot, and the two platforms that share it.
 *
 * electron-builder.yml can hold ONE afterPack hook, while the mac build needs a
 * prune and the Linux AppImage needs a launcher. scripts/after-pack.cjs routes
 * between them. This test is what stops a later "tidy-up" from deleting one of
 * the two: each route is proven by the effect it has on a real directory.
 */
import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { afterPack, hooksFor } = require('../../scripts/after-pack.cjs');

const ARM64 = 0x0100000c;
const macho = (cputype) => {
  const buf = Buffer.alloc(64);
  buf.writeUInt32LE(0xfeedfacf, 0);
  buf.writeUInt32LE(cputype >>> 0, 4);
  return buf;
};

const roots = [];
const tempRoot = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-after-pack-'));
  roots.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

/** An arm64 bundle carrying the other chip's node-pty prebuild. */
function macBundle() {
  const buildDir = tempRoot();
  const app = path.join(buildDir, 'NEUMA.app');
  const macos = path.join(app, 'Contents', 'MacOS');
  fs.mkdirSync(macos, { recursive: true });
  fs.writeFileSync(path.join(macos, 'NEUMA'), macho(ARM64));
  const prebuilds = path.join(app, 'Contents', 'Resources', 'app', 'node_modules', 'node-pty', 'prebuilds');
  for (const dir of ['darwin-arm64', 'darwin-x64']) {
    fs.mkdirSync(path.join(prebuilds, dir), { recursive: true });
    fs.writeFileSync(path.join(prebuilds, dir, 'pty.node'), macho(ARM64));
  }
  return { buildDir, app, prebuilds };
}

/** A linux dir unpacked by electron-builder: the executable sits at the top. */
function linuxPack() {
  const dir = tempRoot();
  fs.writeFileSync(path.join(dir, 'neuma'), '#!/bin/sh\n');
  return dir;
}

describe('which hook a pack gets', () => {
  it('routes darwin to the prune, and only the prune', () => {
    expect(hooksFor({ electronPlatformName: 'darwin', targets: [] }).map(([n]) => n))
      .toEqual(['prune-foreign-prebuilds']);
  });

  it('routes a linux AppImage pack to the launcher', () => {
    expect(hooksFor({ electronPlatformName: 'linux', targets: [{ name: 'appImage' }] }).map(([n]) => n))
      .toEqual(['appimage-launcher']);
  });

  it('routes a linux dir pack to nothing, which is what the rpm and deb input needs', () => {
    expect(hooksFor({ electronPlatformName: 'linux', targets: [{ name: 'dir' }] })).toEqual([]);
  });

  it('routes win32 to nothing', () => {
    expect(hooksFor({ electronPlatformName: 'win32', targets: [{ name: 'nsis' }] })).toEqual([]);
  });
});

describe('the effect each route has', () => {
  it('darwin: the foreign prebuild is gone after the hook runs', async () => {
    const { buildDir, prebuilds } = macBundle();
    await afterPack({
      appOutDir: buildDir,
      electronPlatformName: 'darwin',
      targets: [],
      packager: { appInfo: { productFilename: 'NEUMA' }, platform: { name: 'mac' } },
    });

    expect(fs.existsSync(path.join(prebuilds, 'darwin-arm64'))).toBe(true);
    expect(fs.existsSync(path.join(prebuilds, 'darwin-x64'))).toBe(false);
  });

  it('linux AppImage: the launcher sits in front of the binary, as upstream wrote it', async () => {
    const appOutDir = linuxPack();
    await afterPack({
      appOutDir,
      electronPlatformName: 'linux',
      targets: [{ name: 'appImage' }],
      packager: { executableName: 'neuma', appInfo: { productFilename: 'NEUMA' }, platform: { name: 'linux' } },
    });

    expect(fs.existsSync(path.join(appOutDir, 'neuma-bin'))).toBe(true);
    expect(fs.readFileSync(path.join(appOutDir, 'neuma'), 'utf8')).toContain('appimage');
  });

  it('a mac pack leaves the linux launcher alone, and the reverse', async () => {
    const { buildDir } = macBundle();
    await afterPack({ appOutDir: buildDir, electronPlatformName: 'darwin', targets: [], packager: { appInfo: { productFilename: 'NEUMA' } } });
    expect(fs.existsSync(path.join(buildDir, 'neuma-bin'))).toBe(false);
  });
});
