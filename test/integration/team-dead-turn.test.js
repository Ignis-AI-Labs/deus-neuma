/** #420: an aborted sweep neither settles an intent nor clears another run. */
import { afterAll, beforeAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, {
  getWorkspacesRoot, setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { registerRun, endRun, isLaneRunning } from '../../backend/services/team-run-live.js';

let previousRoot;

beforeAll(async () => {
  previousRoot = getWorkspacesRoot();
  setWorkspacesRoot(await createTempDir('team-dead-turn'));
});

afterAll(() => setWorkspacesRoot(previousRoot));

test.each([false, true])(
  'a dead turn settles nothing and never clears a live run (lane running: %s)',
  async (running) => {
    const neumaId = `dead-turn-${String(running)}`;
    const dir = path.join(workspace.pathFor(neumaId), 'intents');
    const payload = JSON.stringify({ type: 'team/run' });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'pending.json'), payload);
    const activeTurn = new globalThis.AbortController();
    activeTurn.abort();
    const connection = { companion: { neumaId }, activeTurn };
    if (running) registerRun({ id: `dead-turn-run-${neumaId}`, wallet: '0x1', laneId: neumaId, lead: neumaId, goal: 'g', board: [] });

    try {
      const receipts = await sweepIntents(connection, { mode: 'auto', lanePolicy: null });

      expect(receipts).toEqual([]);
      expect(isLaneRunning(neumaId)).toBe(running);
      expect(await fs.readdir(dir)).toEqual(['pending.json']);
      expect(await fs.readFile(path.join(dir, 'pending.json'), 'utf8')).toBe(payload);
    } finally {
      endRun(`dead-turn-run-${neumaId}`);
    }
  },
);
