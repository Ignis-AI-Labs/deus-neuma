/** Real signed connection and encrypted session persistence; no inference. */
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { compactionTelemetry } from '../../core/runtime/session-compactor.js';
import { recordSessionRows } from '../../core/memory/mind-graph.js';
import { harvestWorkingBand } from '../../backend/services/band-harvest.js';
import { readChat } from '../../backend/services/user-realm.js';
import { persistExchange } from '../../backend/services/portal-turn-persist.js';
import { gatherMemoryContext } from '../../backend/services/memory-context.js';

let kit;
beforeEach(async () => { kit = await createHarnessTurnKit('turn-session-telemetry'); });
afterEach(async () => {
  if (!kit) return;
  await recordSessionRows(kit.laneId, []);
  await harvestWorkingBand(kit.laneId, kit.connection.sessionId);
  await kit.close();
});

const settle = async (sessionCompaction) => {
  const { connection, laneId } = kit;
  const result = await persistExchange(connection, 'hello', 'hello back', [], [], {
    composition: { type: 'context:composition' }, thoughts: [], sessionCompaction,
    target: { sessionId: connection.sessionId, companion: connection.companion },
  });
  await untilHarness(async () => (await readChat(connection.walletAddress, laneId)).length === 2);
  return result;
};

test('a missing gather uses the target session instead of the previous connection carry', async () => {
  kit.connection._sessionCompaction = { compactionCount: 99 };
  const result = await settle(undefined);
  expect(result.composition.session.compactionCount).toBe(0);
  const records = await workspace.readSession(kit.laneId, kit.connection.sessionId);
  expect(records.at(-1).composition.session.compactionCount).toBe(0);
});

test('settle persists this turn’s gathered snapshot even when the connection holds older telemetry', async () => {
  await workspace.appendMessage(kit.laneId, kit.connection.sessionId,
    { role: 'system', content: 'earlier summary', compacted: true, compactionCount: 3 });
  const gathered = compactionTelemetry(await workspace.readSession(kit.laneId, kit.connection.sessionId));
  expect(gathered.compactionCount).toBe(3);
  kit.connection._sessionCompaction = { compactionCount: 99 };
  const result = await settle(gathered);
  expect(result.composition.session.compactionCount).toBe(3);
});

test('a gather without current session records never inherits old bookkeeping', async () => {
  const previous = { compaction: { compactionCount: 99 }, relevantMemories: 'retained context' };
  const result = await gatherMemoryContext('hello', null, previous, null, null);
  expect(result).not.toHaveProperty('compaction');
  // A client-sent memoryContext never plants a memory lane: only the store's own recall rides.
  expect(result).not.toHaveProperty('relevantMemories');
  expect(previous.compaction.compactionCount).toBe(99);
});
