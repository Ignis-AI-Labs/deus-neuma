// Actual retry entry, encrypted disk and signed portal socket. No provider
// response is supplied: unresolved recovery must stop before identity loading.
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { createBindingIsolationKit, untilBinding } from '../helpers/binding-isolation-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { openTurnOperations, beginTurnOperation } from '../../backend/services/turn-operation-checkpoint.js';
import { streamWitnessTurn } from '../../backend/services/witness-stream.js';
import { yieldForQueuedThought, takeQueuedActionMessages } from '../../backend/services/queued-action-handoff.js';

test.each(['in-flight', 'corrupt'])('witness retry refuses %s recovery before preparation and preserves queued evidence', async (state) => {
  const kit = await createBindingIsolationKit('witness-preflight-Fixture');
  try {
    const { connection } = kit;
    connection.companion.witness = { vendorSlug: 'preflight', chosenName: 'Fixture' };
    const take = { turnId: 'preflight-retry' };
    await workspace.createSession(kit.laneId, connection.sessionId);
    await workspace.appendTurnPoint(kit.laneId, connection.sessionId,
      { role: 'user', content: 'Review the existing result.' }, take.turnId);
    const turn = await openTurnOperations(connection, take);
    const operation = await beginTurnOperation(turn,
      { tool: 'fs/write', server: 'fs', toolName: 'write', args: { path: 'result.txt', content: 'landed' } }, 0);
    await fs.writeFile(path.join(kit.ground, 'result.txt'), 'landed');
    if (state === 'corrupt') {
      await fs.writeFile(path.join(workspace.pathFor(kit.laneId), 'keys', 'operations',
        connection.sessionId, `${take.turnId}.json`), '{broken');
    }
    connection.pendingThoughts = [{ thought: 'Keep this evidence.' }];
    yieldForQueuedThought(connection, [{ tool: 'fs/read', status: 'ok', content: 'prior-action-evidence' }]);
    connection.activeTurn = null;
    await streamWitnessTurn(connection, { retry: { turnId: take.turnId } });
    const frame = await untilBinding(() => kit.frames.find((entry) => entry.type === 'consciousness:stream'));
    expect(frame.error).toBe(true);
    expect(frame.content).toContain('[Operation recovery stopped]');
    if (state === 'in-flight') expect(frame.content).toContain(operation.id);
    expect(frame.turnId).toBe(take.turnId);
    expect(connection._operationRecoveryStopped).toBe(true);
    expect(connection.activeTurn).toBeNull();
    expect(kit.frames.some((entry) => entry.type === 'tool:usage')).toBe(false);
    expect(takeQueuedActionMessages(connection)[0].content).toContain('prior-action-evidence');
    expect(await fs.readFile(path.join(kit.ground, 'result.txt'), 'utf8')).toBe('landed');
  } finally { await kit.close(); }
});
