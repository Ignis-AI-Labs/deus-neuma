import { afterEach, describe, expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../..');
const roots = [];
const canBuildRpm = process.platform === 'linux' && spawnSync('rpmbuild', ['--version']).status === 0;

const fixture = (kind) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `neuma-${kind}-builder-test-`));
  roots.push(dir);
  for (const child of ['scripts', 'build', 'electron', 'release/linux-unpacked', 'tmp']) fs.mkdirSync(path.join(dir, child), { recursive: true });
  for (const file of [`build-${kind}.mjs`, 'linux-menu-entry.mjs', 'installer-license.mjs']) {
    fs.copyFileSync(path.join(REPO, 'scripts', file), path.join(dir, 'scripts', file));
  }
  fs.copyFileSync(path.join(REPO, 'electron/display-flags.cjs'), path.join(dir, 'electron/display-flags.cjs'));
  fs.copyFileSync(path.join(REPO, 'build/icon.png'), path.join(dir, 'build/icon.png'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'neuma', version: '1.2.3', description: 'Isolated builder regression fixture', license: 'UNLICENSED', homepage: 'https://example.invalid',
  }));
  fs.writeFileSync(path.join(dir, 'release/linux-unpacked/neuma'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'release/linux-unpacked/chrome-sandbox'), 'real payload bytes\n', { mode: 0o755 });
  return dir;
};

const buildWithLegacyCollision = (kind) => {
  const dir = fixture(kind);
  const legacy = path.join(dir, 'tmp', `neuma-${kind}-$$`);
  const script = [
    `mkdir -p "${legacy}"`,
    `printf 'do not touch' > "${legacy}/sentinel"`,
    `exec "$NODE" "$FIXTURE/scripts/build-${kind}.mjs"`,
  ].join('\n');
  const result = spawnSync('sh', ['-c', script], {
    cwd: dir,
    env: { ...process.env, NODE: process.execPath, FIXTURE: dir, TMPDIR: path.join(dir, 'tmp') },
    encoding: 'utf8',
    timeout: 120_000,
  });
  const sentinel = path.join(dir, 'tmp', `neuma-${kind}-${result.pid}`, 'sentinel');
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(fs.readFileSync(sentinel, 'utf8')).toBe('do not touch');
  return dir;
};

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

describe('Linux package builder scratch and ownership', () => {
  test('deb builds for real beside a hostile legacy directory and keeps root ownership', () => {
    const dir = buildWithLegacyCollision('deb');
    const deb = path.join(dir, 'release/neuma_1.2.3_amd64.deb');
    expect(fs.existsSync(deb)).toBe(true);
    const data = execFileSync('ar', ['p', deb, 'data.tar.xz']);
    const archive = path.join(dir, 'data.tar.xz');
    fs.writeFileSync(archive, data);
    const listing = execFileSync('tar', ['--numeric-owner', '-tvf', archive], { encoding: 'utf8' });
    expect(listing).toContain('/opt/NEUMA/chrome-sandbox');
    for (const line of listing.trim().split('\n')) expect(line).toMatch(/^\S+\s+0\/0\s/);
  });

  test.skipIf(!canBuildRpm)('rpm builds for real beside a hostile legacy directory and assigns root ownership', () => {
    const dir = buildWithLegacyCollision('rpm');
    const rpm = fs.readdirSync(path.join(dir, 'release')).find((name) => name.endsWith('.rpm'));
    expect(rpm).toBeTruthy();
    const listing = execFileSync('rpm', [
      '-qp', '--queryformat', '[%{FILEUSERNAME} %{FILEGROUPNAME} %{FILENAMES}\\n]', path.join(dir, 'release', rpm),
    ], { encoding: 'utf8' });
    expect(listing).toContain('root root /opt/NEUMA/chrome-sandbox');
    for (const line of listing.trim().split('\n')) expect(line).toMatch(/^root root \//);
  });
});
