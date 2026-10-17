/** H6/H8/same-batch: real MCP/fs, real approved bubblewrap, both seat batches. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createBindingIsolationKit } from '../helpers/binding-isolation-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { mcpService } from '../../backend/services/mcp.js';
import { withFsPrimitives } from '../../backend/services/fs-primitives.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import { createTurnToolEpochs } from '../../backend/services/portal-tool-epochs.js';
import { openTurnOperations } from '../../backend/services/turn-operation-checkpoint.js';
import { processWitnessToolBatch } from '../../backend/services/witness-tool-batch.js';
import { WITNESS_CODING_TOOLS } from '../../backend/services/witness-tools.js';
import { ensureWitnessCodingSandbox } from '../../backend/services/witness-coding-sandbox.js';
import { beingCodingToolsFor, stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';

let kit;
afterEach(async () => {
  await mcpService.disconnect('filesystem');
  await kit?.close();
});

const call = (server, toolName, args) => ({ server, toolName, args, tool: `${server}/${toolName}` });
const prepareCoding = async (seat) => {
  kit.connection.toolWorkspace = kit.ground;
  if (seat === 'portal') {
    const tools = await beingCodingToolsFor(kit.connection);
    const catalog = await stashBeingTurnCatalog(kit.connection, tools, []);
    expect(catalog, kit.connection._turnSandboxError || 'coding catalog missing execute')
      .toContainEqual(expect.objectContaining({ server: 'coding', name: 'execute' }));
    // Load on demand: the being seat's shell is prepared by the first act, not the catalog.
    expect(kit.connection._turnSandbox).toBe(null);
  } else {
    kit.connection._turnSandbox = await ensureWitnessCodingSandbox(kit.laneId, kit.ground);
    expect(kit.connection._turnSandbox, kit.connection._turnSandboxError || 'coding sandbox missing').toBeTruthy();
  }
};
const batchFor = (seat, turn) => async (calls) => {
  if (seat === 'portal') return processToolCalls(kit.ws, '', kit.connection, calls, turn);
  return processWitnessToolBatch({
    ws: kit.ws, connection: kit.connection, calls, turn,
    runtime: {
      tools: [...withFsPrimitives(mcpService.getToolsContext().available_tools), ...WITNESS_CODING_TOOLS],
      sandbox: kit.connection._turnSandbox,
    },
  });
};

describe.each(['portal', 'witness'])('%s outcome-driven batching', (seat) => {
  beforeEach(async () => {
    kit = await createBindingIsolationKit(seat === 'witness' ? 'witness-test-HarnessFixture' : 'neuma-turn-fixture');
    await connectFilesystemServer();
    kit.client.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type === 'tool:approval_request') {
        kit.decide(frame, frame.tool === 'coding/shell_network' ? 'deny' : 'allow');
      }
    });
  });
  test('same-batch observations see mutation, held duplicates preserve positional results', async () => {
    const target = path.join(workspace.pathFor(kit.laneId), 'source.txt');
    await fs.writeFile(target, 'before');
    const read = call('fs', 'read', { path: target });
    const write = call('fs', 'write', { path: target, content: 'after' });
    const results = await batchFor(seat, createTurnToolEpochs())([read, read, write, write, read, read]);
    expect(results.map((r) => r.status)).toEqual(['ok', 'held', 'ok', 'held', 'ok', 'held']);
    expect(results[0].content).toContain('before');
    expect(results[1].content).toContain('before');
    expect(results[4].content).toContain('after');
    expect(results[5].content).toContain('after');
    expect(await fs.readFile(target, 'utf8')).toBe('after');
  });

  test('SVG reads return source text and honor line slices', async () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">\n<path d="M0 0 L20 20"/>\n</svg>';
    const target = path.join(workspace.pathFor(kit.laneId), 'official-mark.SVG');
    await fs.writeFile(target, source);
    const results = await batchFor(seat, createTurnToolEpochs())([
      call('fs', 'read', { path: target }),
      call('fs', 'read', { path: target, head: 1 }),
      call('fs', 'read', { path: target, tail: 1 }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['ok', 'ok', 'ok']);
    expect(results[0].content).toContain(source.trim());
    expect(results[1].content).toContain('<svg');
    expect(results[1].content).not.toContain('<path');
    expect(results[2].content).toContain('</svg>');
    expect(results[2].content).not.toContain('<path');
    expect(results[0].sight).toBeUndefined();
  });

  test('approved append repeated in a single batch spawns only once', async () => {
    await prepareCoding(seat);
    const append = call('coding', 'execute', { command: 'printf "one\\n" >> appended.txt' });
    const results = await batchFor(seat, createTurnToolEpochs())([append, append]);
    expect(results.map((r) => r.status), JSON.stringify(results)).toEqual(['ok', 'held']);
    expect(await fs.readFile(path.join(kit.connection._turnSandbox.workspace, 'appended.txt'), 'utf8')).toBe('one\n');
    expect(kit.frames.filter((frame) => frame.type === 'tool:approval_request' && frame.tool === 'coding/execute')).toHaveLength(seat === 'witness' ? 1 : 0);
  }, 30000);

  test.each(['observe', 'denied'])('%s still refuses execution before any file effect', async (mode) => {
    await prepareCoding(seat);
    if (mode === 'observe') kit.connection.toolMode = 'observe';
    else kit.connection._sessionToolPolicy = { coding: { allowed: [], denied: ['execute'], requireApproval: [] } };
    const results = await batchFor(seat, createTurnToolEpochs())([
      call('coding', 'execute', { command: 'printf forbidden > forbidden.txt' }),
    ]);
    expect(results[0].status, JSON.stringify(results)).toBe('denied');
    await expect(fs.stat(path.join(kit.connection._turnSandbox.workspace, 'forbidden.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(kit.frames.filter((frame) => frame.type === 'tool:approval_request')).toHaveLength(0);
  }, 30000);

  test('reordered arguments cannot repeat an already executed append', async () => {
    await prepareCoding(seat);
    const command = 'printf "once\\n" >> reordered.txt';
    const results = await batchFor(seat, createTurnToolEpochs())([
      call('coding', 'execute', { command, timeoutMs: 5000 }),
      call('coding', 'execute', { timeoutMs: 5000, command }),
    ]);
    expect(await fs.readFile(path.join(kit.connection._turnSandbox.workspace, 'reordered.txt'), 'utf8')).toBe('once\n');
    expect(results.map((r) => r.status), JSON.stringify(results)).toEqual(['ok', 'held']);
  }, 30000);

  test('reopening the same turn reuses its durable append receipt', async () => {
    await prepareCoding(seat);
    const take = { turnId: 'durable-append-turn' };
    const append = call('coding', 'execute', { command: 'printf "durable\\n" >> durable.txt' });
    const first = await batchFor(seat, await openTurnOperations(kit.connection, take))([append]);
    expect(first[0].status, JSON.stringify(first)).toBe('ok');
    const reopened = await openTurnOperations(kit.connection, take);
    const repeated = await batchFor(seat, reopened)([append]);
    expect(repeated[0].status, JSON.stringify(repeated)).toBe('held');
    expect(first[0].operationTiming.durationMs).toBeGreaterThan(0);
    expect(repeated[0].operationTiming).toEqual(first[0].operationTiming);
    expect(await fs.readFile(path.join(kit.connection._turnSandbox.workspace, 'durable.txt'), 'utf8')).toBe('durable\n');
    const record = await workspace.readTurnOperations(kit.laneId, kit.connection.sessionId, take.turnId);
    expect(record.receipts).toHaveLength(1);
    expect(record.receipts[0]).toMatchObject({ id: first[0].operationId, state: 'succeeded' });
    expect(record.receipts[0].timing).toEqual(first[0].operationTiming);
    expect(record.inFlight).toBeNull();
    const checkpoint = path.join(workspace.pathFor(kit.laneId), 'keys', 'operations', kit.connection.sessionId, `${take.turnId}.json`);
    const denied = await batchFor(seat, createTurnToolEpochs())([call('fs', 'read', { path: checkpoint })]);
    expect(denied[0].status, JSON.stringify(denied)).toBe(seat === 'witness' ? 'error' : 'denied');
    expect(denied[0].error).toContain('keys');
  }, 30000);

});
