/** Real concurrent encrypted writes and filesystem failures; no model invoked. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaRecall } from '../../core/memory/neuma-recall.js';
import { harvestWorkingBand } from '../../backend/services/band-harvest.js';

const lane = 'harvest-recovery-fixture';
let root, previousRoot, previousKill, cursor;
beforeEach(async () => {
  previousRoot = getWorkspacesRoot();
  previousKill = process.env.NEUMA_BAND_HARVEST;
  delete process.env.NEUMA_BAND_HARVEST;
  root = await createTempDir('harvest-recovery');
  setWorkspacesRoot(root);
  neumaRecall.invalidate(lane);
  await workspace.create(lane);
  cursor = path.join(root, lane, 'memory', 'band-harvest.json');
});
afterEach(() => {
  neumaRecall.invalidate(lane);
  setWorkspacesRoot(previousRoot);
  if (previousKill === undefined) delete process.env.NEUMA_BAND_HARVEST;
  else process.env.NEUMA_BAND_HARVEST = previousKill;
});

const seedSession = async (session) => {
  for (let i = 0; i < 60; i += 1) {
    await workspace.appendMessage(lane, session, {
      role: i % 2 ? 'assistant' : 'user',
      content: i >= 20 ? 'ok' : i % 2
        ? `A plain working answer about the session tail and how the render caps it. ${i}`
        : `why does the scrollback feel shorter than the work we put into it? ${i}`,
    });
  }
};

test('concurrent sweeps harvest a session once and share its completed cursor', async () => {
  await seedSession('same');
  const results = await Promise.allSettled([harvestWorkingBand(lane, 'same', { liveTailRows: 40 }), harvestWorkingBand(lane, 'same', { liveTailRows: 40 })]);
  expect(results).toEqual([{ status: 'fulfilled', value: true }, { status: 'fulfilled', value: false }]);
  expect(await workspace.listObservations(lane)).toHaveLength(10);
});

test('two sessions keep both cursor entries when they settle together', async () => {
  await seedSession('first');
  await seedSession('second');
  const results = await Promise.allSettled([harvestWorkingBand(lane, 'first', { liveTailRows: 40 }), harvestWorkingBand(lane, 'second', { liveTailRows: 40 })]);
  expect(results.every((result) => result.status === 'fulfilled' && result.value)).toBe(true);
  expect(JSON.parse(await fs.readFile(cursor, 'utf8')).sessions).toEqual({ first: { through: 20 }, second: { through: 20 } });
});

test('a corrupt cursor refuses harvesting and preserves the damaged evidence', async () => {
  await seedSession('corrupt');
  await fs.writeFile(cursor, '{torn');
  await expect(harvestWorkingBand(lane, 'corrupt', { liveTailRows: 40 })).rejects.toThrow();
  expect(await fs.readFile(cursor, 'utf8')).toBe('{torn');
  expect(await workspace.listObservations(lane)).toHaveLength(0);
});

test('a failed observation write cannot advance the cursor and can be retried after repair', async () => {
  await seedSession('write-failure');
  const observations = path.join(root, lane, 'memory', 'observations');
  await fs.rmdir(observations);
  await fs.writeFile(observations, 'actual file blocks directory creation');
  await expect(harvestWorkingBand(lane, 'write-failure', { liveTailRows: 40 })).rejects.toThrow();
  await expect(fs.stat(cursor)).rejects.toMatchObject({ code: 'ENOENT' });
  await fs.unlink(observations);
  await fs.mkdir(observations);
  expect(await harvestWorkingBand(lane, 'write-failure', { liveTailRows: 40 })).toBe(true);
  expect(await workspace.listObservations(lane)).toHaveLength(10);
});
