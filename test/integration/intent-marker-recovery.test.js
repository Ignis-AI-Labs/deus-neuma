/** Real signed-wallet sockets, disk and production intent executor. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';

for (const kind of ['regular', 'loop', 'dangling', 'directory']) {
  test(`${kind} execution marker never permits another task`, async () => {
    const kit = await createHarnessTurnKit();
    try {
      const dir = path.join(workspace.pathFor(kit.laneId), 'intents');
      const marker = path.join(dir, 'held.executing.json');
      await fs.writeFile(path.join(dir, 'held.json'), JSON.stringify({ type: 'tasks/add', title: 'Already attempted' }));
      if (kind === 'regular') await fs.writeFile(marker, JSON.stringify({ type: 'tasks/add', at: new Date().toISOString() }));
      if (kind === 'loop') await fs.symlink('held.executing.json', marker);
      if (kind === 'dangling') await fs.symlink('missing-marker-target', marker);
      if (kind === 'directory') await fs.mkdir(marker);
      const sweep = () => sweepIntents(kit.connection, {
        mode: 'auto', lanePolicy: { intents: { allowed: ['tasks.add'] } }, emit: kit.emit,
      });
      const receipts = await sweep();
      expect((await workspace.readTaskLedger(kit.laneId)).tasks).toHaveLength(0);
      expect(await fs.readdir(dir)).not.toContain('held.executing.result.json');
      if (kind === 'regular') {
        expect(receipts).toHaveLength(1);
        expect(JSON.parse(await fs.readFile(path.join(dir, 'held.result.json'), 'utf8')).status).toBe('uncertain');
        await expect(fs.lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      } else {
        expect(receipts).toEqual([]);
        expect(await fs.lstat(marker)).toBeTruthy();
        await expect(fs.stat(path.join(dir, 'held.result.json'))).rejects.toMatchObject({ code: 'ENOENT' });
      }
      expect(await sweep()).toEqual([]);
      expect((await workspace.readTaskLedger(kit.laneId)).tasks).toHaveLength(0);
    } finally { await kit.close(); }
  });
}

test('an absent marker permits one ordinary task and clears its marker', async () => {
  const kit = await createHarnessTurnKit();
  try {
    const dir = path.join(workspace.pathFor(kit.laneId), 'intents');
    await fs.writeFile(path.join(dir, 'fresh.json'), JSON.stringify({ type: 'tasks/add', title: 'One task' }));
    const options = { mode: 'auto', lanePolicy: { intents: { allowed: ['tasks.add'] } }, emit: kit.emit };
    expect(await sweepIntents(kit.connection, options)).toHaveLength(1);
    expect((await workspace.readTaskLedger(kit.laneId)).tasks).toHaveLength(1);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'fresh.result.json'), 'utf8')).status).toBe('done');
    await expect(fs.lstat(path.join(dir, 'fresh.executing.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await sweepIntents(kit.connection, options)).toEqual([]);
    expect((await workspace.readTaskLedger(kit.laneId)).tasks).toHaveLength(1);
  } finally { await kit.close(); }
});
