// #244: actual Git output, disk names and Explorer badge lookups; no doubles.
import { beforeEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { parsePorcelain, readGitStatus } from '../../backend/services/git-status.js';
import { porcelainPath } from '../../backend/services/git-porcelain-path.js';
import { badgeFor, isIgnored } from '../../frontend/app/RelinkShell/files/git-status-view.js';

let root;
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const names = Object.freeze([
  'plain.txt', 'üñïçödé.txt', 'back\\slash.txt', 'quote"double.txt',
  'newline\nin-name.txt', 'a -> b.txt', ' leading.txt', 'trailing.txt ',
  'tab\tin-name.txt', 'controls\x07\b\v\f\r.txt',
]);

describe.skipIf(process.platform === 'win32')('POSIX Git filenames reach the badge mapping intact', () => {
  beforeEach(async () => {
    root = await createTempDir('git-status-names');
    git('-c', 'init.templateDir=', 'init', '-b', 'trunk');
    git('config', 'user.name', 'Filename regression');
    git('config', 'user.email', 'filename-test@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    await fs.writeFile(path.join(root, 'seed'), 'seed');
    git('add', '--', 'seed');
    git('commit', '-m', 'seed');
  });

  test('untracked names, including literal rename arrows, match actual disk entries', async () => {
    for (const name of names) await fs.writeFile(path.join(root, name), name);
    const status = await readGitStatus(root);
    expect(status.files).toEqual(Object.fromEntries(names.map(name => [name, 'U'])));
    for (const name of names) {
      expect(badgeFor(status.files, name, false), name).toBe('U');
      expect(await fs.readFile(path.join(root, name), 'utf8')).toBe(name);
    }
  });

  test.each(['false', 'true'])('real porcelain with core.quotepath=%s decodes UTF-8 bytes and C escapes', async quotePath => {
    for (const name of names) await fs.writeFile(path.join(root, name), name);
    const output = git('-c', `core.quotepath=${quotePath}`, 'status', '--porcelain=v1', '--branch');
    expect(parsePorcelain(output).files).toEqual(Object.fromEntries(names.map(name => [name, 'U'])));
  });

  test('real staged renames badge the destination even when both names contain arrows and quotes', async () => {
    const pairs = [
      ['o -> ld.js', 'new.js'],
      ['plain-old.js', 'renamed -> dest.js'],
      ['old" -> name.js', 'new\\ -> name.js'],
    ];
    for (const [oldName] of pairs) await fs.writeFile(path.join(root, oldName), oldName.repeat(20));
    git('add', '.');
    git('commit', '-m', 'rename sources');
    for (const [oldName, newName] of pairs) git('mv', '--', oldName, newName);
    const status = await readGitStatus(root);
    expect(status.files).toEqual(Object.fromEntries(pairs.map(([, name]) => [name, 'M'])));
    for (const [, name] of pairs) expect(badgeFor(status.files, name, false)).toBe('M');
  });

  test('ignored quoted filenames and directories remain identifiable without change badges', async () => {
    await fs.writeFile(path.join(root, '.gitignore'), '*.ignored\n*.ignored/\n');
    git('add', '--', '.gitignore');
    git('commit', '-m', 'ignore patterns');
    const ignored = ['back\\slash.ignored', 'quote"name.ignored', 'line\nbreak.ignored', 'a -> b.ignored'];
    for (const name of ignored) await fs.writeFile(path.join(root, name), 'ignored');
    const directory = 'dir" -> name.ignored';
    await fs.mkdir(path.join(root, directory));
    await fs.writeFile(path.join(root, directory, 'child'), 'ignored');
    const status = await readGitStatus(root);
    expect(status.files).toEqual({});
    expect(status.ignored.sort()).toEqual([...ignored, directory].sort());
    for (const name of ignored) expect(isIgnored(status.ignored, name)).toBe(true);
    expect(isIgnored(status.ignored, `${directory}/child`)).toBe(true);
  });
});

test('copy fields select the quoted destination while ordinary fields keep their literal arrow', () => {
  expect(porcelainPath('C ', '"a -> b.js" -> "c -> d.js"')).toBe('c -> d.js');
  expect(porcelainPath(' R', '"a -> b.js" -> "c -> d.js"')).toBe('c -> d.js');
  expect(porcelainPath('??', '"a -> b.js"')).toBe('a -> b.js');
  expect(porcelainPath(' M', 'plain.js')).toBe('plain.js');
});
