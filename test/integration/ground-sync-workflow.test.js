/** Real Git repositories; refusal precedes remote access and checkout changes. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { prepareGroundSync, syncGround } from '../../backend/services/ground-sync.js';
import { createHarnessGitKit, fixtureGit, commitFixture } from '../helpers/harness-git-kit.js';

let kit;
beforeEach(async () => { kit = await createHarnessGitKit(); });
afterEach(async () => { await kit?.close(); });
const declareWorkflow = async () => {
  await fs.mkdir(path.join(kit.ground, 'scripts'), { recursive: true });
  await commitFixture(kit.ground, 'scripts/sync-from-dev.mjs', '// repository workflow\n', 'declare workflow');
};

test.each(['present', 'deleted', 'staged deletion'])('refuses a dedicated workflow when %s', async (state) => {
  await declareWorkflow();
  if (state !== 'present') await fs.unlink(path.join(kit.ground, 'scripts/sync-from-dev.mjs'));
  if (state === 'staged deletion') await fixtureGit(kit.ground, ['add', '-u']);
  await expect(prepareGroundSync(kit.ground)).rejects.toMatchObject({ code: 'dedicated_sync' });
  expect(kit.requests).toHaveLength(0);
});

test('rechecks a newly declared workflow before executing an older approved snapshot', async () => {
  const snapshot = await prepareGroundSync(kit.ground);
  await declareWorkflow();
  const result = await syncGround(kit.ground, { snapshot });
  expect(result).toMatchObject({ ok: false, code: 'dedicated_sync', refsMayHaveChanged: false,
    checkoutMayHaveChanged: false, objectsMayHaveChanged: false });
  expect(result.output).toContain('node scripts/sync-from-dev.mjs --apply');
  expect(kit.requests).toHaveLength(0);
});
