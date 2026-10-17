/**
 * Ground sync (RULE 0): real repositories, snapshot-bound fetch/ff-only,
 * real loopback HTTP remotes. No git boundary is mocked — a being's
 * approved pull must land real files on a real checkout or this suite fails.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { syncGround, prepareGroundSync } from '../../backend/services/ground-sync.js';
import { readGroundGit } from '../../backend/services/ground-git.js';
import { createHarnessGitKit, fixtureGit, commitFixture as commit } from '../helpers/harness-git-kit.js';

let kit, root, origin, ground;
const sync = async () => syncGround(ground, { snapshot: await prepareGroundSync(ground) });

beforeEach(async () => {
  kit = await createHarnessGitKit();
  ({ root, origin, ground } = kit);
});

afterEach(async () => {
  await kit.close();
});

describe('ground_sync — the gated pull act', () => {
  test('pulls a fast-forward from upstream into the live checkout', async () => {
    await commit(origin, 'update.txt', 'from upstream\n', 'upstream work');

    const result = await sync();
    expect(result.ok).toBe(true);
    expect(result.output).toContain('Fast-forward');
    expect(await fs.readFile(path.join(ground, 'update.txt'), 'utf8')).toBe('from upstream\n');
    expect(await readGroundGit(ground)).toMatchObject({ isRepository: true, staged: 0, modified: 0, untracked: 0 });
  });

  test('succeeds honestly when already up to date', async () => {
    const result = await sync();
    expect(result.ok).toBe(true);
    expect(await readGroundGit(ground)).toMatchObject({ staged: 0, modified: 0, untracked: 0 });
  });

  test('refuses divergence and truthfully reports that fetched refs may change', async () => {
    await commit(origin, 'upstream.txt', 'up\n', 'upstream moves');
    await commit(ground, 'local.txt', 'local\n', 'local moves');

    const result = await sync();
    expect(result.ok).toBe(false);
    expect(result.refsMayHaveChanged).toBe(true);
    expect(result.checkoutMayHaveChanged).toBe(false);
    expect(await fs.readFile(path.join(ground, 'local.txt'), 'utf8')).toBe('local\n');
    expect(await fs.readFile(path.join(ground, 'base.txt'), 'utf8')).toBe('base\n');
    await expect(fs.access(path.join(ground, 'upstream.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readGroundGit(ground)).toMatchObject({ staged: 0, modified: 0, untracked: 0 });
  });

  test('reports a branch with no upstream as an honest failure', async () => {
    const lonely = path.join(root, 'lonely');
    await fs.mkdir(lonely);
    await fixtureGit(lonely, ['init', '--quiet', '--initial-branch', 'main']);
    await commit(lonely, 'solo.txt', 'solo\n', 'no remote anywhere');

    await expect(prepareGroundSync(lonely)).rejects.toMatchObject({ code: 'no_upstream' });
  });

  test('answers plainly when the folder is not a repository', async () => {
    const plain = path.join(root, 'plain');
    await fs.mkdir(plain);

    await expect(prepareGroundSync(plain)).rejects.toMatchObject({ code: 'git_failed' });
  });
});
