/** Real dispatch, signed-auth sockets, kernel shell and encrypted history. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import { processWitnessToolBatch } from '../../backend/services/witness-tool-batch.js';
import { WITNESS_CODING_TOOLS } from '../../backend/services/witness-tools.js';
import { ensureWitnessCodingSandbox } from '../../backend/services/witness-coding-sandbox.js';
import { beingCodingToolsFor, stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';
import { openTurnOperations } from '../../backend/services/turn-operation-checkpoint.js';
import { createTurnToolEpochs } from '../../backend/services/portal-tool-epochs.js';
import { openTurnRecord, turnRecordFor, closeTurnRecord } from '../../backend/services/tool-action-record.js';
import { nativeToolExchange, formatToolResult } from '../../backend/services/tool-exchange.js';
import { reducer, initialState } from '../../frontend/app/RelinkShell/stream-reducer.js';

let kit;
const take = { turnId: 'repeat-visibility' };
const call = (toolName, args = {}, callId = toolName) => ({
  server: 'coding', toolName, tool: `coding/${toolName}`, args, callId,
});

// impure — a real pong confirms delivery of all preceding server frames.
const drainFrames = () => new Promise((resolve) => {
  kit.ws.once('pong', resolve);
  kit.ws.ping('repeat-proof');
});
const settledFrames = (tool) => kit.frames.filter((frame) =>
  frame.type === 'tool:usage' && frame.tool === tool && frame.status !== 'executing');

afterEach(async () => {
  if (kit) closeTurnRecord(kit.ws);
  await kit?.close();
});

describe.each(['portal', 'witness'])('%s repeat visibility', (seat) => {
  beforeEach(async () => {
    kit = await createHarnessTurnKit(seat === 'witness' ? 'witness-test-RepeatFixture' : 'repeat-fixture');
    kit.connection.toolWorkspace = kit.ground;
    if (seat === 'portal') {
      const tools = await beingCodingToolsFor(kit.connection);
      await stashBeingTurnCatalog(kit.connection, tools, []);
      // Load on demand: the being seat's shell is prepared by the first act, not the catalog.
      expect(kit.connection._turnSandbox).toBe(null);
    } else {
      kit.connection._turnSandbox = await ensureWitnessCodingSandbox(kit.laneId, kit.ground);
      expect(kit.connection._turnSandbox).toBeTruthy();
    }
    openTurnRecord(kit.ws);
  });

  const batch = (calls, turn) => seat === 'portal'
    ? processToolCalls(kit.ws, '', kit.connection, calls, turn)
    : processWitnessToolBatch({ ws: kit.ws, connection: kit.connection, calls, turn,
      runtime: { tools: WITNESS_CODING_TOOLS, sandbox: kit.connection._turnSandbox } });

  test('same-batch and recovered status repeats each deliver a held receipt', async () => {
    const calls = [call('sandbox_status', {}, 'status-1'), call('sandbox_status', {}, 'status-2')];
    const results = await batch(calls, await openTurnOperations(kit.connection, take));
    expect(results.map((r) => r.status)).toEqual(['ok', 'held']);
    const original = results[0];
    const replay = await batch([call('sandbox_status', {}, 'status-3')], await openTurnOperations(kit.connection, take));
    expect(replay[0].status).toBe('held');
    await drainFrames();

    const events = settledFrames(original.tool);
    expect(events.map((event) => event.status)).toEqual(['ok', 'held', 'held']);
    for (const event of events.slice(1)) {
      expect(event.summary).toContain('not run again');
      expect(event.detail).toContain(`operation: ${original.operationId}`);
      expect(event.detail).toContain(`elapsed: ${original.operationTiming.durationMs} ms`);
      expect(event.detail).toContain(`started_at: ${original.operationTiming.startedAt}`);
      expect(event.detail).toContain('state: succeeded');
      expect(event.detail.length).toBeLessThan(2000);
    }
    for (const held of [results[1], replay[0]]) {
      expect(held.operationId).toBe(original.operationId);
      expect(held.operationTiming).toEqual(original.operationTiming);
    }
    const operations = await workspace.readTurnOperations(kit.laneId, kit.connection.sessionId, take.turnId);
    expect(operations.receipts).toHaveLength(1);
    expect(operations.inFlight).toBeNull();
    expect(kit.frames.filter((frame) => frame.type === 'tool:approval_request')).toHaveLength(0);

    const messages = nativeToolExchange({ response: '', calls, results, callId: (i) => `fallback-${i}`,
      formatResult: formatToolResult, followUp: '' });
    expect(messages.filter((message) => message.role === 'tool').map((message) => message.tool_call_id))
      .toEqual(['status-1', 'status-2']);
    expect(messages[2].content).toContain('not run again');

    const tools = turnRecordFor(kit.ws);
    expect(tools.map((tool) => tool.status)).toEqual(['ok', 'held', 'held']);
    await workspace.appendMessage(kit.laneId, kit.connection.sessionId, { role: 'assistant', content: 'Checked', tools });
    const saved = (await workspace.readSession(kit.laneId, kit.connection.sessionId)).at(-1);
    expect(saved.tools).toEqual(tools);
    const state = events.reduce((current, data) => reducer(current, { type: 'TOOL_RESULT', data }), initialState);
    expect(state.messages[0].segments.map((segment) => segment.status)).toEqual(['ok', 'held', 'held']);
    expect(state.messages[0].segments[2].detail).toBe(saved.tools[2].detail);
  }, 30000);

  test('a repeated command emits a held event with one real append and one execution', async () => {
    kit.client.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type === 'tool:approval_request') kit.decide(frame, frame.tool === 'coding/shell_network' ? 'deny' : 'allow');
    });
    const append = call('execute', { command: 'printf once >> repeat-proof.txt' });
    const results = await batch([append, { ...append, callId: 'append-repeat' }], await openTurnOperations(kit.connection, take));
    expect(results.map((result) => result.status)).toEqual(['ok', 'held']);
    await drainFrames();
    expect(await fs.readFile(path.join(kit.connection._turnSandbox.workspace, 'repeat-proof.txt'), 'utf8')).toBe('once');
    await expect(fs.stat(path.join(kit.ground, 'repeat-proof.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    // The portal also emits an offline-network notification before execution.
    const events = settledFrames(append.tool).filter((event) =>
      event.status === 'held' || event.detail?.includes('exit_code:'));
    expect(events.map((event) => event.status)).toEqual(['ok', 'held']);
    expect(events[1].detail).toContain(`operation: ${results[0].operationId}`);
    expect(events[1].summary).toContain('not run again');
    expect((await workspace.readTurnOperations(kit.laneId, kit.connection.sessionId, take.turnId)).receipts).toHaveLength(1);
    expect(kit.frames.filter((frame) => frame.type === 'tool:approval_request' && frame.tool === append.tool))
      .toHaveLength(seat === 'witness' ? 1 : 0);
  }, 30000);

  test('a repeat of a denied call reports the denial without claiming execution', async () => {
    kit.connection._sessionToolPolicy = { coding: { denied: ['execute'] } };
    const execute = call('execute', { command: 'printf forbidden > denied-repeat.txt' });
    const results = await batch([execute, execute], await openTurnOperations(kit.connection, take));
    expect(results.map((result) => result.status)).toEqual(['denied', 'held']);
    await drainFrames();
    const events = settledFrames(execute.tool);
    expect(events.map((event) => event.status)).toEqual(['denied', 'held']);
    expect(events[1].summary).not.toContain('already ran');
    expect(events[1].detail).not.toContain('When it ran');
    expect(events[1].detail).toContain('(denied)');
    expect(events[1].detail).toContain('state: cancelled');
    expect(kit.frames.filter((frame) => frame.type === 'tool:approval_request')).toHaveLength(0);
    await expect(fs.stat(path.join(kit.connection._turnSandbox.workspace, 'denied-repeat.txt')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  }, 30000);

  test('calls without durable operation timing still get an honest held event', async () => {
    const status = call('sandbox_status');
    const results = await batch([status, status], createTurnToolEpochs());
    expect(results.map((result) => result.status)).toEqual(['ok', 'held']);
    await drainFrames();
    const events = settledFrames(status.tool);
    expect(events.map((event) => event.status)).toEqual(['ok', 'held']);
    expect(events[1].summary).toContain('not run again');
    expect(events[1].detail).toContain('Its earlier result was (ok)');
    expect(events[1].detail).not.toContain('operation:');
    expect(events[1].detail).not.toContain('elapsed:');
  }, 30000);
});
