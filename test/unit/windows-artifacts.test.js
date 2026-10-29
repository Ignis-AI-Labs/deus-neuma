/**
 * A Windows installer joins a Linux release only when its update feed names that installer, that
 * version and that installer's sha512 — the hash every installed Windows app checks an update
 * against. Real files, real hashes.
 */

import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';
import { createTempDir } from '../helpers/temp-fs.js';
import { windowsFiles, windowsProblems, sumsJoining, windowsUploadOrder, unpublicFiles } from '../../scripts/release/windows-artifacts.mjs';

const V = '0.1.74';
const feedFor = (exe, version = V, bytes) => [
  `version: ${version}`,
  'files:',
  `  - url: ${exe}`,
  `    sha512: ${createHash('sha512').update(bytes).digest('base64')}`,
  `    size: ${bytes.length}`,
  `path: ${exe}`,
  `sha512: ${createHash('sha512').update(bytes).digest('base64')}`,
  "releaseDate: '2026-10-26T12:00:00.000Z'",
  '',
].join('\n');

describe('windows artifacts', () => {
  let dir; let bytes; const want = windowsFiles(V);
  beforeEach(async () => {
    dir = await createTempDir(`win-${Math.random().toString(36).slice(2)}`);
    bytes = randomBytes(4096);
    fs.writeFileSync(path.join(dir, want.exe), bytes);
    fs.writeFileSync(path.join(dir, want.blockmap), randomBytes(64));
    fs.writeFileSync(path.join(dir, want.feed), feedFor(want.exe, V, bytes));
  });

  test('the installer, its blockmap and a feed made for those bytes may join', () => {
    expect(windowsProblems(dir, V)).toEqual([]);
  });

  test('a feed for another version, another file or other bytes is refused, and so is a missing file', () => {
    fs.writeFileSync(path.join(dir, want.feed), feedFor(want.exe, '0.1.70', bytes));
    expect(windowsProblems(dir, V).join(' ')).toMatch(/version 0\.1\.70, not 0\.1\.74/);
    fs.writeFileSync(path.join(dir, want.feed), feedFor(want.exe, V, randomBytes(4096)));
    expect(windowsProblems(dir, V).join(' ')).toMatch(/made for other bytes/);
    fs.writeFileSync(path.join(dir, want.feed), feedFor('Deus-Neuma-0.1.70-x64.exe', V, bytes));
    expect(windowsProblems(dir, V).join(' ')).toMatch(/offers Deus-Neuma-0\.1\.70-x64\.exe/);
    fs.rmSync(path.join(dir, want.blockmap));
    expect(windowsProblems(dir, V)).toEqual([`${want.blockmap} is not in ${dir}`]);
  });
});

describe('the Windows installer joining a live release', () => {
  const linux = 'aa  Deus-Neuma-0.1.74-x86_64.AppImage\nbb  neuma-0.1.74-1.fc44.x86_64.rpm\ncc  neuma_0.1.74_amd64.deb\n';
  const exe = windowsFiles(V).exe;

  test('SHA256SUMS keeps every live line as it was and adds the installer once', () => {
    expect(sumsJoining(linux, exe, 'dd')).toBe(`${linux}dd  ${exe}\n`);
    // a second run, or a line the site already carried for it, never doubles or keeps a stale hash
    expect(sumsJoining(`${linux}ee  ${exe}\n`, exe, 'dd')).toBe(`${linux}dd  ${exe}\n`);
    expect(sumsJoining(linux.replace(/\n/g, '\r\n'), exe, 'dd')).toBe(`${linux}dd  ${exe}\n`);
  });

  test('the installer goes up before anything names it, and the feed goes up last', () => {
    const order = windowsUploadOrder(V);
    expect(order).toEqual([exe, `${exe}.blockmap`, 'SHA256SUMS', 'SHA256SUMS.sig', 'latest.yml.sig', 'latest.yml']);
  });

  test('a packaged file the public tree does not hold is named; dependencies, the built frontend and the notes are not', () => {
    const publicPaths = ['backend/server.js', 'electron/main.cjs'];
    const shipped = ['backend/server.js', 'electron/main.cjs', 'node_modules/x/index.js', 'dist/index.html', 'build/release-notes.md', 'docs/work/private.md'];
    expect(unpublicFiles(shipped, publicPaths)).toEqual(['docs/work/private.md']);
  });
});
