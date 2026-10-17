/** Actual session directories and timestamps; no mock, clock replacement or inference. */
import { afterEach, beforeEach, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';

let kit;
beforeEach(async () => { kit = await createHarnessTurnKit('session-list-fixture'); });
afterEach(async () => { await kit?.close(); });
const sessionDirectory = () => path.join(workspace.pathFor(kit.laneId), 'sessions');

test('most recently modified session wins over lexicographic identifier order', async () => {
  await workspace.appendMessage(kit.laneId, 'z-old', { role: 'user', content: 'old' });
  await workspace.appendMessage(kit.laneId, 'a-new', { role: 'user', content: 'new' });
  await fs.utimes(path.join(sessionDirectory(), 'z-old.jsonl'), 1000, 1000);
  await fs.utimes(path.join(sessionDirectory(), 'a-new.jsonl'), 2000, 2000);
  expect(await workspace.listSessions(kit.laneId)).toEqual(['a-new', 'z-old']);
});

test('a missing sessions directory is empty while a file replacing it is a failure', async () => {
  const directory = sessionDirectory();
  await fs.rm(directory, { recursive: true, force: true });
  expect(await workspace.listSessions(kit.laneId)).toEqual([]);
  await fs.writeFile(directory, 'damaged directory');
  await expect(workspace.listSessions(kit.laneId)).rejects.toMatchObject({ code: 'ENOTDIR' });
});

test('equal modification times have deterministic identifier ordering', async () => {
  for (const id of ['a-same', 'z-same']) {
    await workspace.appendMessage(kit.laneId, id, { role: 'user', content: id });
    await fs.utimes(path.join(sessionDirectory(), `${id}.jsonl`), 2000, 2000);
  }
  expect(await workspace.listSessions(kit.laneId)).toEqual(['z-same', 'a-same']);
});
