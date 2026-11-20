/**
 * The afterPack prune, proven on a bundle laid out like the real one: a real
 * thin Mach-O executable, real prebuild directories, then the hook's own delete.
 * No mock — the files are written, the hook runs, the filesystem is read back.
 */
import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// The hook is CommonJS because electron-builder requires it. It reaches into an
// ESM reader, which is the pairing this test exercises too.
const require = createRequire(import.meta.url);
const { prune, chipOfBundle, bundleDirIn } = require('../../scripts/prune-foreign-prebuilds.cjs');

const ARM64 = 0x0100000c;
const X86_64 = 0x01000007;

function macho(cputype) {
  const buf = Buffer.alloc(64);
  buf.writeUInt32LE(0xfeedfacf, 0);
  buf.writeUInt32LE(cputype >>> 0, 4);
  return buf;
}

const roots = [];
const tempRoot = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-prune-'));
  roots.push(dir);
  return dir;
};

/**
 * A bundle with the app executable and a node_modules holding prebuild dirs.
 * Returns the BUILD DIRECTORY, which is what electron-builder hands afterPack:
 * `release/mac-arm64`, holding `NEUMA.app`.
 */
function bundle({ exe = ARM64, prebuilds = {} } = {}) {
  const buildDir = tempRoot();
  const appOutDir = path.join(buildDir, 'NEUMA.app');
  const macos = path.join(appOutDir, 'Contents', 'MacOS');
  fs.mkdirSync(macos, { recursive: true });
  fs.writeFileSync(path.join(macos, 'NEUMA'), macho(exe));

  const modules = path.join(appOutDir, 'Contents', 'Resources', 'app', 'node_modules');
  for (const [pkg, dirs] of Object.entries(prebuilds)) {
    const prebuildsDir = path.join(modules, pkg, 'prebuilds');
    for (const dir of dirs) {
      fs.mkdirSync(path.join(prebuildsDir, dir), { recursive: true });
      fs.writeFileSync(path.join(prebuildsDir, dir, 'pty.node'), macho(dir.includes('x64') ? X86_64 : ARM64));
    }
  }
  // A package that ships a built addon instead of prebuilds: never touched.
  const built = path.join(modules, 'better-sqlite3', 'build', 'Release');
  fs.mkdirSync(built, { recursive: true });
  fs.writeFileSync(path.join(built, 'better_sqlite3.node'), macho(exe));
  return buildDir;
}

const appIn = (buildDir) => path.join(buildDir, 'NEUMA.app');

afterAll(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

describe('which chip the bundle is', () => {
  it('reads it off the app executable, not off an assumption', () => {
    expect(chipOfBundle(appIn(bundle({ exe: ARM64 })))).toBe('arm64');
    expect(chipOfBundle(appIn(bundle({ exe: X86_64 })))).toBe('x86_64');
  });

  it('answers null when there is no executable to read', () => {
    expect(chipOfBundle(tempRoot())).toBeNull();
  });
});

describe('finding the bundle inside the build directory', () => {
  it('accepts the build directory electron-builder actually hands afterPack', () => {
    const buildDir = bundle({ exe: ARM64 });
    expect(bundleDirIn(buildDir, 'NEUMA')).toBe(appIn(buildDir));
    expect(bundleDirIn(buildDir, 'SomethingElse')).toBe(appIn(buildDir));
  });

  it('accepts the bundle itself, so the hook works either way', () => {
    const buildDir = bundle({ exe: ARM64 });
    expect(bundleDirIn(appIn(buildDir))).toBe(appIn(buildDir));
  });

  it('answers null for a directory with no app in it', () => {
    expect(bundleDirIn(tempRoot(), 'NEUMA')).toBeNull();
  });
});

describe('pruning an arm64 bundle', () => {
  const prebuilds = {
    'node-pty': ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64'],
    'node-pty-linux-only': ['linux-x64'],
  };

  it('keeps darwin-arm64 and removes every other prebuild directory', () => {
    const buildDir = bundle({ exe: ARM64, prebuilds });
    const { kept, removed, chip } = prune({ appOutDir: buildDir });

    expect(chip).toBe('arm64');
    expect(kept).toEqual(['node-pty/prebuilds/darwin-arm64']);
    expect(removed.sort()).toEqual([
      'node-pty-linux-only/prebuilds/linux-x64',
      'node-pty/prebuilds/darwin-x64',
      'node-pty/prebuilds/linux-x64',
      'node-pty/prebuilds/win32-x64',
    ]);
  });

  it('actually deletes them, and leaves the built addon alone', () => {
    const buildDir = bundle({ exe: ARM64, prebuilds });
    prune({ appOutDir: buildDir, productFilename: 'NEUMA' });
    const modules = path.join(appIn(buildDir), 'Contents', 'Resources', 'app', 'node_modules');

    expect(fs.existsSync(path.join(modules, 'node-pty', 'prebuilds', 'darwin-arm64', 'pty.node'))).toBe(true);
    expect(fs.existsSync(path.join(modules, 'node-pty', 'prebuilds', 'darwin-x64'))).toBe(false);
    // the package itself stays; only its foreign prebuild directory goes
    expect(fs.existsSync(path.join(modules, 'node-pty-linux-only'))).toBe(true);
    expect(fs.existsSync(path.join(modules, 'node-pty-linux-only', 'prebuilds', 'linux-x64'))).toBe(false);
    // build/Release is what node-pty loads first; it must survive.
    expect(fs.existsSync(path.join(modules, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'))).toBe(true);
  });

  it('dryRun reports without deleting, so the list can be read first', () => {
    const buildDir = bundle({ exe: ARM64, prebuilds });
    const { removed } = prune({ appOutDir: buildDir, dryRun: true });
    const outside = path.join(appIn(buildDir), 'Contents', 'Resources', 'app', 'node_modules', 'node-pty', 'prebuilds', 'darwin-x64');
    expect(removed.length).toBe(4);
    expect(fs.existsSync(outside)).toBe(true);
  });
});

describe('a package that is one chip\'s binary', () => {
  // the first macOS CI run (2026-11-14): the arm64 app carried @napi-rs/canvas-darwin-x64
  const chipPackages = (buildDir, names) => {
    const modules = path.join(appIn(buildDir), 'Contents', 'Resources', 'app', 'node_modules');
    for (const name of names) {
      fs.mkdirSync(path.join(modules, name), { recursive: true });
      fs.writeFileSync(path.join(modules, name, 'skia.node'), macho(name.endsWith('x64') ? X86_64 : ARM64));
    }
    return modules;
  };

  it('goes whole when it is the other chip\'s, scoped or not; this chip\'s stays', () => {
    const buildDir = bundle({ exe: ARM64 });
    const modules = chipPackages(buildDir, ['@napi-rs/canvas-darwin-x64', '@napi-rs/canvas-darwin-arm64', '@esbuild/darwin-x64', 'fsevents-darwin-arm64']);
    const { kept, removed } = prune({ appOutDir: buildDir });
    expect(removed.sort()).toEqual(['@esbuild/darwin-x64', '@napi-rs/canvas-darwin-x64']);
    expect(kept).toEqual(expect.arrayContaining(['@napi-rs/canvas-darwin-arm64', 'fsevents-darwin-arm64']));
    expect(fs.existsSync(path.join(modules, '@napi-rs', 'canvas-darwin-x64'))).toBe(false);
    expect(fs.existsSync(path.join(modules, '@napi-rs', 'canvas-darwin-arm64', 'skia.node'))).toBe(true);
  });

  it('on an Intel bundle the arm64 package goes', () => {
    const buildDir = bundle({ exe: X86_64 });
    chipPackages(buildDir, ['@napi-rs/canvas-darwin-x64', '@napi-rs/canvas-darwin-arm64']);
    expect(prune({ appOutDir: buildDir }).removed).toEqual(['@napi-rs/canvas-darwin-arm64']);
  });
});

describe('pruning an x64 bundle keeps the other folder', () => {
  it('keeps darwin-x64 on an Intel artifact, though Mach-O calls that chip x86_64', () => {
    const buildDir = bundle({ exe: X86_64, prebuilds: { 'node-pty': ['darwin-arm64', 'darwin-x64'] } });
    const { kept, removed, chip } = prune({ appOutDir: buildDir });
    expect(chip).toBe('x86_64');
    expect(kept).toEqual(['node-pty/prebuilds/darwin-x64']);
    expect(removed).toEqual(['node-pty/prebuilds/darwin-arm64']);
  });
});

describe('other platforms are left alone', () => {
  it('prunes nothing for linux, and says so by returning empty lists', () => {
    const buildDir = bundle({ exe: ARM64, prebuilds: { 'node-pty': ['linux-arm64', 'linux-x64'] } });
    const result = prune({ appOutDir: buildDir, platform: 'linux' });
    expect(result).toEqual({ kept: [], removed: [], chip: null });
    const kept = path.join(appIn(buildDir), 'Contents', 'Resources', 'app', 'node_modules', 'node-pty', 'prebuilds', 'linux-x64');
    expect(fs.existsSync(kept)).toBe(true);
  });
});
