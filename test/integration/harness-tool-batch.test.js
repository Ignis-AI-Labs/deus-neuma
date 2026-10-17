/** H6/H8/same-batch: real MCP/fs, real approved bubblewrap, both seat batches. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { connectFilesystemServer, ensureFilesystemFocus } from '../../backend/services/mcp-filesystem.js';
import { getRoots, setRoots } from '../../backend/services/user-files.js';
import { mcpService } from '../../backend/services/mcp.js';
import { withFsPrimitives } from '../../backend/services/fs-primitives.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import { createTurnToolEpochs } from '../../backend/services/portal-tool-epochs.js';
import { openTurnOperations } from '../../backend/services/turn-operation-checkpoint.js';
import { processWitnessToolBatch } from '../../backend/services/witness-tool-batch.js';
import { WITNESS_CODING_TOOLS } from '../../backend/services/witness-tools.js';
import { ensureWitnessCodingSandbox } from '../../backend/services/witness-coding-sandbox.js';
import { beingCodingToolsFor, stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';
import { nativeToolExchange, formatToolResult } from '../../backend/services/tool-exchange.js';
import { nativeToolExchange as witnessExchange } from '../../backend/services/witness-turn-record.js';
import { buildStreamBody } from '../../backend/services/llm-request-builders.js';
import { intentSectionFor } from '../../backend/services/intents/intents-section.js';

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
    kit = await createHarnessTurnKit(seat === 'witness' ? 'witness-test-HarnessFixture' : 'neuma-turn-fixture');
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
    expect(await fs.readFile(path.join(kit.connection._turnSandbox.workspace, 'durable.txt'), 'utf8')).toBe('durable\n');
    const record = await workspace.readTurnOperations(kit.laneId, kit.connection.sessionId, take.turnId);
    expect(record.receipts).toHaveLength(1);
    expect(record.receipts[0]).toMatchObject({ id: first[0].operationId, state: 'succeeded' });
    expect(record.inFlight).toBeNull();
    const checkpoint = path.join(workspace.pathFor(kit.laneId), 'keys', 'operations', kit.connection.sessionId, `${take.turnId}.json`);
    const denied = await batchFor(seat, createTurnToolEpochs())([call('fs', 'read', { path: checkpoint })]);
    expect(denied[0].status, JSON.stringify(denied)).toBe(seat === 'witness' ? 'error' : 'denied');
    expect(denied[0].error).toContain('keys');
  }, 30000);

  test('a dependent command waits for the prior real process to finish', async () => {
    await prepareCoding(seat);
    const results = await batchFor(seat, createTurnToolEpochs())([
      call('coding', 'execute', { command: 'sleep 0.2; printf ready > completion.txt' }),
      call('coding', 'execute', { command: 'test "$(cat completion.txt)" = ready && printf observed' }),
    ]);
    expect(results.map((result) => result.status), JSON.stringify(results)).toEqual(['ok', 'ok']);
    expect(results[1].content).toContain('observed');
    expect(await fs.readFile(path.join(kit.connection._turnSandbox.workspace, 'completion.txt'), 'utf8')).toBe('ready');
  }, 30000);

  test('verbose commands finish with bounded tails and preserve their actual exit status', async () => {
    await fs.writeFile(path.join(kit.ground, 'verbose.cjs'), [
      "const fs = require('node:fs');",
      "fs.writeSync(1, 'x'.repeat(300000));",
      "fs.writeSync(2, 'y'.repeat(300000));",
      "fs.writeSync(1, '\\nSTDOUT-FINISHED\\n');",
      "fs.writeSync(2, '\\nSTDERR-FINISHED\\n');",
      "fs.writeFileSync('after-output.txt', 'completed');",
      'process.exit(Number(process.argv[2] || 0));',
    ].join('\n'));
    await prepareCoding(seat);
    const results = await batchFor(seat, createTurnToolEpochs())([
      call('coding', 'execute', { command: 'node verbose.cjs' }),
      call('coding', 'execute', { command: 'node verbose.cjs 7' }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['ok', 'error']);
    expect(results[0].content).toContain('output_truncated: true');
    expect(results[0].content).toContain('STDOUT-FINISHED');
    expect(results[0].content).toContain('STDERR-FINISHED');
    expect(results[1].error).toContain('exit_code: 7');
    expect(results[1].error).toContain('STDERR-FINISHED');
    expect(results[0].content.length).toBeLessThan(103000);
    expect(await fs.readFile(path.join(kit.connection._turnSandbox.workspace, 'after-output.txt'), 'utf8')).toBe('completed');
  }, 30000);

  test('fail -> live file mutation -> identical approved execution produces fresh success', async () => {
    const source = path.join(kit.ground, 'check.cjs');
    await fs.writeFile(source, 'process.exit(1);\n');
    await prepareCoding(seat);
    const batch = batchFor(seat, createTurnToolEpochs());
    const execute = call('coding', 'execute', { command: 'node check.cjs' });
    const failed = await batch([execute]);
    expect(failed[0].status, JSON.stringify(failed[0])).toBe('error');
    expect(failed[0].error).toContain('exit_code: 1');
    const repeat = await batch([execute]);
    expect(repeat[0].status).toBe('held');
    // Since SEC-038 a ground's file reach is the operator's: the folder is
    // opened in the Explorer and the stream's focus names it. Both steps, as
    // the desk takes them — never a widened wall.
    const walled = await batch([call('fs', 'write', { path: source, content: 'x' })]);
    expect(walled[0].status).toBe('error');
    expect(walled[0].error).toContain('grant wall');
    const priorRoots = getRoots();
    setRoots([...priorRoots, kit.ground]);
    let fixed;
    try {
      await ensureFilesystemFocus(kit.connection);
      fixed = await batch([
        call('fs', 'write', { path: source, content: 'process.stdout.write("FRESH PASS\\n");\n' }), execute,
      ]);
    } finally {
      setRoots(priorRoots);
    }
    expect(fixed.map((r) => r.status)).toEqual(['ok', 'ok']);
    expect(fixed[1].content).toContain('FRESH PASS');
    expect(await fs.readFile(source, 'utf8')).toContain('FRESH PASS');
    expect(kit.frames.filter((frame) => frame.type === 'tool:approval_request' && frame.tool === 'coding/execute')).toHaveLength(seat === 'witness' ? 2 : 0);
  }, 30000);

  test('real filed task receipts stay after every positional result in the next native request body', async () => {
    const target = path.join(workspace.pathFor(kit.laneId), 'intents', 'new-task.json');
    // Simulate an existing lane from before the inbox was scaffolded.
    await fs.rmdir(path.dirname(target));
    expect(await intentSectionFor(kit.connection)).toContain(path.dirname(target));
    expect((await fs.stat(path.dirname(target))).mode & 0o777).toBe(0o700);
    const calls = [
      call('fs', 'write', { path: target, content: JSON.stringify({ type: 'tasks/add', title: 'native receipt task' }) }),
      call('fs', 'read', { path: target }),
    ].map((entry, i) => ({ ...entry, callId: `native-${i}` }));
    const results = await batchFor(seat, createTurnToolEpochs())(calls);
    expect(results).toHaveLength(3);
    expect(results.slice(0, 2).map((r) => r.tool)).toEqual(['fs/write', 'fs/read']);
    expect(results[2].tool).toBe('intents/tasks.add');
    const task = (await workspace.readTaskLedger(kit.laneId)).tasks[0];
    const exchange = seat === 'portal'
      ? nativeToolExchange({ response: '', calls, results, callId: (i) => `${i}`, formatResult: formatToolResult, followUp: 'continue' })
      : witnessExchange('', calls, results, 0);
    const body = buildStreamBody({ provider: 'openai', model: 'gpt-4o' }, exchange, {});
    expect(body.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['native-0', 'native-1']);
    expect(body.messages.at(-1).content).toContain(task.id.slice(0, 8));
    expect(body.messages.at(-1).content).toContain('intents/tasks.add');
  });
});
