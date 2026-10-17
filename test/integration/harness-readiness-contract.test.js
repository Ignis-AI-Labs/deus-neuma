/** Real disk, signed-wallet fixtures, production tools; no inference claim. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { ensureIntentDirectory } from '../../backend/services/intents/intent-directory.js';
import { intentSectionFor } from '../../backend/services/intents/intents-section.js';
import { enumerateSecretMasks } from '../../backend/services/witness-coding-sandbox.js';
import { handleFlightCheckTool } from '../../backend/services/flight-check.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { mcpService } from '../../backend/services/mcp.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';

let kit;
beforeEach(async () => { kit = await createHarnessTurnKit(); });
afterEach(async () => { await mcpService.disconnect('filesystem'); await kit?.close(); });

test('new lanes carry an owner-only inbox; preparation is idempotent', async () => {
  const inbox = path.join(workspace.pathFor(kit.laneId), 'intents');
  expect((await fs.stat(inbox)).mode & 0o777).toBe(0o700);
  await fs.writeFile(path.join(inbox, 'preserved.txt'), 'kept');
  expect(await ensureIntentDirectory(kit.laneId)).toBe(inbox);
  expect(await fs.readFile(path.join(inbox, 'preserved.txt'), 'utf8')).toBe('kept');
});

test('no inbox is advertised or created for an absent lane', async () => {
  const connection = { ...kit.connection, companion: { neumaId: 'absent-readiness-lane' } };
  expect(await intentSectionFor(connection)).toBe('');
  await expect(fs.stat(workspace.pathFor('absent-readiness-lane'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('a substituted inbox symlink is refused without altering its target', async () => {
  const inbox = path.join(workspace.pathFor(kit.laneId), 'intents');
  await fs.rmdir(inbox);
  await fs.symlink(kit.ground, inbox);
  await expect(ensureIntentDirectory(kit.laneId)).rejects.toThrow('not a file or symlink');
  expect(await intentSectionFor(kit.connection)).toBe('');
  expect(await fs.readdir(kit.ground)).toEqual([]);
});

test('an unsweepable source fails closed instead of returning an empty mask list', async () => {
  const file = path.join(kit.ground, 'ordinary-file');
  await fs.writeFile(file, 'a file is not a sweepable directory');
  await expect(enumerateSecretMasks(file)).rejects.toThrow('Secret sweep could not read');
  await expect(enumerateSecretMasks(path.join(kit.ground, 'absent'))).rejects.toThrow('no coding shell was prepared');
  expect(await enumerateSecretMasks(kit.ground)).toEqual({ dirs: [], files: [] });
});

test('flight check without a shell does not advertise command limits as capabilities', async () => {
  kit.connection._turnCatalog = [];
  const result = await handleFlightCheckTool({ connection: kit.connection, checkedAt: '2026-09-07T00:00:00Z' });
  expect(result.status).toBe('ok');
  expect(result.content).toContain('shell commands unavailable');
  expect(result.content).not.toContain('100KB output cap');
});

test('failed name search points to the callable content-search primitive', async () => {
  await connectFilesystemServer();
  const results = await processToolCalls(kit.ws, '', kit.connection, [{
    server: 'fs', toolName: 'search', tool: 'fs/search',
    args: { path: workspace.pathFor(kit.laneId), pattern: 'missing-readiness-marker.txt' },
  }]);
  expect(results[0].status, JSON.stringify(results)).toBe('ok');
  expect(results[0].content).toContain('fs/search with content: true');
  expect(results[0].content).not.toContain('filesystem/search_content');
});
