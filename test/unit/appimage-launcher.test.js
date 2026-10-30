// The AppImage keeps the renderer sandbox on, and turns it off only where the system cannot run it.
// Runs the real launcher under the real shell, and the real afterPack hook on a real folder. The
// program the launcher starts is a small script that prints what it was given: the claim here is
// the launcher's choice of arguments; that Electron then runs sandboxed or not was watched with the
// real binary (both cases) when the launcher was written.
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LAUNCHER = path.join(REPO, 'build/appimage-launcher.sh');
const { afterPack, buildsAppImage } = createRequire(import.meta.url)('../../scripts/appimage-launcher-hook.cjs');

// A packed app folder: the launcher as `neuma`, and a neuma-bin that prints its arguments.
const appDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-launcher-'));
  fs.copyFileSync(LAUNCHER, path.join(dir, 'neuma'));
  fs.chmodSync(path.join(dir, 'neuma'), 0o755);
  fs.writeFileSync(path.join(dir, 'neuma-bin'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  return dir;
};

const launch = (dir, env, wrap = []) => {
  const [cmd, ...pre] = [...wrap, path.join(dir, 'neuma')];
  const run = spawnSync(cmd, [...pre, '--ozone-platform=x11', 'a b'], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  return { args: run.stdout.split('\n').filter(Boolean), stderr: run.stderr };
};

// Does this host let an unprivileged process make a user namespace (the sandbox Chromium needs)?
const hostUserns = spawnSync('unshare', ['--user', '--map-root-user', 'true']).status === 0;

// A namespace whose own namespaces are capped, so nothing inside can make another: the state of a
// system that refuses them. The outer root caps the count, then drops to an ordinary user.
const restricted = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'userns-cap-'));
  const script = path.join(dir, 'cap.sh');
  fs.writeFileSync(script, '#!/bin/sh\necho 1 > /proc/sys/user/max_user_namespaces || exit 9\nexec unshare --user --map-user=1000 --map-group=1000 "$@"\n', { mode: 0o755 });
  return ['unshare', '--map-root-user', script];
};

describe('the AppImage launcher', () => {
  test('outside an AppImage it starts the app with exactly its arguments', () => {
    expect(launch(appDir(), {}).args).toEqual(['--ozone-platform=x11', 'a b']);
  });

  test.skipIf(!hostUserns)('in an AppImage, where user namespaces work, the sandbox stays on', () => {
    const { args, stderr } = launch(appDir(), { APPIMAGE: '/apps/Deus-Neuma.AppImage' });
    expect(args).toEqual(['--ozone-platform=x11', 'a b']);
    expect(stderr).toBe('');
  });

  test.skipIf(!hostUserns)('in an AppImage, where the system refuses them, it turns the sandbox off and says why', () => {
    const { args, stderr } = launch(appDir(), { APPIMAGE: '/apps/Deus-Neuma.AppImage' }, restricted());
    expect(args).toEqual(['--no-sandbox', '--ozone-platform=x11', 'a b']);
    expect(stderr).toMatch(/does not allow unprivileged user namespaces/);
  });

  test.skipIf(!hostUserns)('outside an AppImage, even there, it never turns the sandbox off', () => {
    expect(launch(appDir(), {}, restricted()).args).toEqual(['--ozone-platform=x11', 'a b']);
  });
});

describe('the afterPack hook', () => {
  const packed = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-unpacked-'));
    fs.writeFileSync(path.join(dir, 'neuma'), 'the electron binary', { mode: 0o755 });
    return dir;
  };
  const context = (dir, name) => ({ appOutDir: dir, electronPlatformName: 'linux', targets: [{ name }], packager: { executableName: 'neuma' } });

  test('an AppImage pack puts the launcher in front of the binary', async () => {
    const dir = packed();
    await afterPack(context(dir, 'appImage'));
    expect(fs.readFileSync(path.join(dir, 'neuma-bin'), 'utf8')).toBe('the electron binary');
    expect(fs.readFileSync(path.join(dir, 'neuma'), 'utf8')).toBe(fs.readFileSync(LAUNCHER, 'utf8'));
    expect(fs.statSync(path.join(dir, 'neuma')).mode & 0o111).toBe(0o111);
  });

  test('a dir pack (the rpm and deb input) is left as packed', async () => {
    const dir = packed();
    await afterPack(context(dir, 'dir'));
    expect(fs.readdirSync(dir)).toEqual(['neuma']);
    expect(buildsAppImage({ electronPlatformName: 'win32', targets: [{ name: 'appImage' }] })).toBe(false);
  });
});
