/** Real signed socket, running sandbox process and durable checkpoint, both seats. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { mcpService } from '../../backend/services/mcp.js';
import { withFsPrimitives } from '../../backend/services/fs-primitives.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import { openTurnOperations } from '../../backend/services/turn-operation-checkpoint.js';
import { processWitnessToolBatch } from '../../backend/services/witness-tool-batch.js';
import { WITNESS_CODING_TOOLS } from '../../backend/services/witness-tools.js';
import { ensureWitnessCodingSandbox } from '../../backend/services/witness-coding-sandbox.js';
import { beingCodingToolsFor, stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';
import { takeQueuedActionMessages, QUEUED_ACTION_REASON } from '../../backend/services/queued-action-handoff.js';

let kit;
let running;
afterEach(async () => {
  if (kit) await fs.writeFile(path.join(kit.ground, 'release'), 'continue');
  await running;
  await mcpService.disconnect('filesystem');
  await kit?.close();
  kit = null;
  running = null;
});
const exists = async (file) => {
  try { await fs.stat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const call = (command) => ({ server: 'coding', toolName: 'execute', tool: 'coding/execute', args: { command } });

describe.each(['portal', 'witness'])('%s queued tool handoff', (seat) => {
  beforeEach(async () => {
    kit = await createHarnessTurnKit(seat === 'witness' ? 'witness-test-HarnessFixture' : 'neuma-turn-fixture');
    await connectFilesystemServer();
    kit.client.on('message', (data) => {
      const event = JSON.parse(data.toString());
      if (event.type === 'tool:approval_request') kit.decide(event, 'allow');
    });
    // The release signal is a file that EXISTS in the live ground before the
    // shell starts, rewritten in place: the shell reads it through the overlay
    // straight from the lower inode. A file newly created in the overlay's
    // upper dir from outside is undefined overlayfs behaviour — the polling
    // shell's cached miss could hide it until the deadline (seen flaking).
    await fs.writeFile(path.join(kit.ground, 'release'), 'hold');
    await fs.writeFile(path.join(kit.ground, 'wait-for-release.cjs'), [
      "const fs = require('node:fs');",
      "fs.writeFileSync('started', 'running');",
      'const deadline = Date.now() + 10000;',
      'const timer = setInterval(() => {',
      "  if (fs.readFileSync('release', 'utf8') === 'continue') {",
      "    fs.writeFileSync('finished', 'completed');",
      "    process.stdout.write('CURRENT ACTION FINISHED');",
      '    clearInterval(timer);',
      '  } else if (Date.now() > deadline) { clearInterval(timer); process.exitCode = 1; }',
      '}, 20);',
    ].join('\n'));
    kit.connection.toolWorkspace = kit.ground;
    if (seat === 'portal') {
      const tools = await beingCodingToolsFor(kit.connection);
      await stashBeingTurnCatalog(kit.connection, tools, []);
      // Load on demand (ceaebc157): the being seat's shell is prepared by the first act, not the catalog.
      expect(kit.connection._turnSandbox).toBe(null);
      expect(kit.connection._turnSandboxSource).toMatchObject({ laneId: kit.laneId, sourceRoot: kit.ground });
    } else {
      kit.connection._turnSandbox = await ensureWitnessCodingSandbox(kit.laneId, kit.ground);
      expect(kit.connection._turnSandbox, kit.connection._turnSandboxError || 'coding sandbox missing').toBeTruthy();
    }
  });

  it('finishes the running effect, checkpoints it, then yields before the next action', async () => {
    const turnId = 'queued-action-turn';
    const turn = await openTurnOperations(kit.connection, { turnId });
    const calls = [call('node wait-for-release.cjs'), call('printf forbidden > later-action')];
    running = seat === 'portal'
      ? processToolCalls(kit.ws, '', kit.connection, calls, turn)
      : processWitnessToolBatch({ ws: kit.ws, connection: kit.connection, calls, turn,
        runtime: { tools: [...withFsPrimitives(mcpService.getToolsContext().available_tools), ...WITNESS_CODING_TOOLS], sandbox: kit.connection._turnSandbox } });
    kit.connection.turnPromise = running;
    const ground = (await untilHarness(() => kit.connection._turnSandbox || kit.connection._turnSandboxError)).workspace;
    expect(ground, kit.connection._turnSandboxError || 'coding sandbox missing').toBeTruthy();
    await untilHarness(() => exists(path.join(ground, 'started')));
    kit.client.send(JSON.stringify({ type: 'consciousness:stream', holdId: 'queue-1', thought: 'Use the new direction.', attachments: ['kept-document'] }));
    await untilHarness(() => kit.connection.pendingThoughts?.length === 1);
    expect(kit.connection.activeTurn.signal.aborted).toBe(false);
    expect(await exists(path.join(ground, 'finished'))).toBe(false);
    await fs.writeFile(path.join(kit.ground, 'release'), 'continue');
    const results = await running;
    expect(results.map((result) => result.status), JSON.stringify(results)).toEqual(['ok', 'held']);
    expect(await fs.readFile(path.join(ground, 'finished'), 'utf8')).toBe('completed');
    expect(await exists(path.join(ground, 'later-action'))).toBe(false);
    expect(kit.connection.activeTurn.signal.reason).toBe(QUEUED_ACTION_REASON);
    expect(kit.connection.pendingThoughts[0]).toMatchObject({ holdId: 'queue-1', thought: 'Use the new direction.', attachments: ['kept-document'] });
    const checkpoint = await workspace.readTurnOperations(kit.laneId, kit.connection.sessionId, turnId);
    expect(checkpoint.inFlight).toBeNull();
    expect(checkpoint.receipts).toHaveLength(1);
    expect(checkpoint.receipts[0].state).toBe('succeeded');
    expect(takeQueuedActionMessages(kit.connection)[0].content).toContain('CURRENT ACTION FINISHED');
    expect(takeQueuedActionMessages(kit.connection)).toEqual([]);
  }, 30000);
});
