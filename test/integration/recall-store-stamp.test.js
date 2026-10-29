/**
 * The recall index follows the store, whoever wrote it (portal-memory audit
 * #16). The in-memory index used to rebuild only when the workspaces root
 * changed, so a moment crystallized by another process (the CLI's own turns)
 * or by a writer that never touches this cache (the REST observation route,
 * an import) was never recalled, and a memory retracted elsewhere kept
 * surfacing.
 *
 * Real encrypted workspace, a real second Node process writing to it, the real
 * recall engine (RULE 0 — no mocks anywhere).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { URL } from 'node:url';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaRecall } from '../../core/memory/neuma-recall.js';

const ID = 'stampry';
let house, priorRoot, priorKey;

// impure — run a snippet against the same lane from a separate Node process.
const inOtherProcess = async (body) => {
  const workspaceUrl = new URL('../../core/workspace/neuma-workspace.js', import.meta.url).href;
  const source = `
    import workspace, { setWorkspacesRoot } from ${JSON.stringify(workspaceUrl)};
    setWorkspacesRoot(${JSON.stringify(house)});
    ${body}
  `;
  await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', source],
    { timeout: 10000, env: process.env });
};

describe('recall freshness keys on the store, not on who wrote it', () => {
  beforeAll(async () => {
    house = await createTempDir('recall-store-stamp');
    priorRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    priorKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'recall-store-stamp-test-key-32chr';
    await workspace.create(ID);
    await workspace.addObservation(ID, {
      type: 'exchange', userMessage: 'the harbor and the tides', response: 'the tides turn', significance: 0.5,
    });
  });

  afterAll(() => {
    neumaRecall.invalidate(ID);
    setWorkspacesRoot(priorRoot);
    if (priorKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = priorKey;
  });

  test('an unchanged store keeps the hot index: no rebuild per recall', async () => {
    neumaRecall.invalidate(ID);
    await neumaRecall.getRelevantMemories(ID, 'harbor tides');
    const builds = neumaRecall.buildCounts.get(ID);
    await neumaRecall.getRelevantMemories(ID, 'harbor tides');
    await neumaRecall.searchDocs(ID, 'harbor', { limit: 5 });
    expect(neumaRecall.buildCounts.get(ID)).toBe(builds);
  });

  test('a moment crystallized by another process is recalled with no invalidate call', async () => {
    expect(JSON.stringify(await neumaRecall.getRelevantMemories(ID, 'emerald beacon'))).not.toContain('emerald');
    await inOtherProcess(`
      await workspace.addObservation(${JSON.stringify(ID)}, {
        type: 'exchange', userMessage: 'the lighthouse keeper lit the emerald beacon',
        response: 'the emerald beacon burns tonight', significance: 0.9,
      });
    `);
    expect(JSON.stringify(await neumaRecall.getRelevantMemories(ID, 'emerald beacon'))).toContain('emerald beacon');
  });

  test('a memory retracted by another process stops surfacing', async () => {
    const [emerald] = (await workspace.listObservations(ID)).filter((o) => /emerald/.test(o.userMessage));
    expect(JSON.stringify(await neumaRecall.getRelevantMemories(ID, 'emerald beacon'))).toContain('emerald beacon');
    await inOtherProcess(`
      await workspace.invalidateObservation(${JSON.stringify(ID)}, ${JSON.stringify(emerald.id)}, { lifecycle: 'retracted' });
    `);
    expect(JSON.stringify(await neumaRecall.getRelevantMemories(ID, 'emerald beacon'))).not.toContain('emerald beacon');
  });

  test('an in-process append keeps the append lane: the next recall pays no rebuild', async () => {
    await neumaRecall.getRelevantMemories(ID, 'harbor');
    const builds = neumaRecall.buildCounts.get(ID);
    const written = await workspace.addObservation(ID, {
      type: 'self-note', content: 'a quiet note about the brass foghorn', significance: 0.9, source: 'self-authored',
    });
    neumaRecall.appendObservation(ID, written);
    expect(JSON.stringify(await neumaRecall.getRelevantMemories(ID, 'brass foghorn'))).toContain('foghorn');
    expect(neumaRecall.buildCounts.get(ID)).toBe(builds);
  });
});
