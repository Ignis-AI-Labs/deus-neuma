// Real repository config parsing; no remote transport or substituted Git.
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, afterEach, test, expect } from 'vitest';
import { createHarnessGitKit, fixtureGit } from '../helpers/harness-git-kit.js';
import { readGroundGit } from '../../backend/services/ground-git.js';
import { prepareGroundSync } from '../../backend/services/ground-sync.js';

let kit;
beforeEach(async () => { kit = await createHarnessGitKit(); });
afterEach(async () => { await kit?.close(); });

test('editor, signing and both LFS owner-shaped metadata remain inert with an SSH remote', async () => {
  for (const [key, value] of [
    ['branch.main.vscode-merge-base', 'deadbeef'], ['branch.main.vscode-merge-base-server', 'deadbeef'],
    ['lfs.https://github.com/previous/project.git/info/lfs.access', 'basic'],
    ['lfs.https://github.com/current/project.git/info/lfs.access', 'basic'],
    ['user.signingkey', 'PUBLIC-FIXTURE-ID'], ['commit.gpgsign', 'true'],
    ['tag.gpgsign', 'true'], ['pull.rebase', 'true'],
  ]) await fixtureGit(kit.ground, ['config', key, value]);
  await fixtureGit(kit.ground, ['remote', 'set-url', 'origin', 'git@github.com:current/project.git']);
  expect(await readGroundGit(kit.ground)).toMatchObject({ isRepository: true, branch: 'main' });
  await expect(prepareGroundSync(kit.ground)).rejects.toMatchObject({ code: 'unsafe_transport' });
  expect(kit.requests).toEqual([]);
});

test('a secret-shaped unknown config key is refused without exposing its key or value', async () => {
  await fixtureGit(kit.ground, ['config', 'unrecognized.PRIVATE_KEY_MARKER.setting', 'PRIVATE_VALUE_MARKER']);
  const error = await readGroundGit(kit.ground).catch((failure) => failure);
  expect(error.code).toBe('unsafe_config');
  expect(error.message).toContain('unrecognized metadata');
  expect(error.message).toContain('No remote transport was tested');
  expect(error.message).not.toMatch(/PRIVATE_KEY_MARKER|PRIVATE_VALUE_MARKER/);
  expect(kit.requests).toEqual([]);
});

test('malformed repository config is an error, not a claim that the repository is absent', async () => {
  const plain = path.join(kit.root, 'plain');
  await fs.mkdir(plain);
  expect(await readGroundGit(plain)).toMatchObject({ isRepository: false });
  await fs.writeFile(path.join(kit.ground, '.git', 'config'), '[broken PRIVATE_CONFIG_MARKER');
  const nested = path.join(kit.ground, 'nested');
  await fs.mkdir(nested);
  await expect(readGroundGit(nested)).rejects.toMatchObject({ code: 'git_failed' });
  const error = await readGroundGit(kit.ground).catch((failure) => failure);
  expect(error.code).toBe('git_failed');
  expect(error.message).not.toContain('PRIVATE_CONFIG_MARKER');
  expect(kit.requests).toEqual([]);
});
