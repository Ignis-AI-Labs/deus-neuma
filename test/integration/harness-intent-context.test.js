/** H1/H2/H8: real task settlement, signed wallet, disk policy and approval broker. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import workspace from '../../core/workspace/neuma-workspace.js';
import { sweepIntents, sweepBatchIntents } from '../../backend/services/intents/intent-sweep.js';
import { nativeToolExchange, formatToolResult } from '../../backend/services/tool-exchange.js';
import { nativeToolExchange as witnessExchange } from '../../backend/services/witness-turn-record.js';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';

let kit;
beforeEach(async () => { kit = await createHarnessTurnKit(); });
afterEach(async () => { await kit?.close(); });

const intentPath = (name, result = false) => path.join(workspace.pathFor(kit.laneId), 'intents', `${name}${result ? '.result' : ''}.json`);
const fileTask = async (name) => {
  await fs.mkdir(path.dirname(intentPath(name)), { recursive: true });
  await fs.writeFile(intentPath(name), JSON.stringify({ type: 'tasks/add', title: name }));
};
const readResult = async (name) => JSON.parse(await fs.readFile(intentPath(name, true), 'utf8'));
const request = () => untilHarness(() => kit.frames.find((frame) => frame.type === 'tool:approval_request'));

describe('captured detached intent settlement', () => {
  test.each(['turn-end read', 'promised policy'])('persisted deny survives AUTO via %s', async (seam) => {
    await fileTask('denied-task');
    await workspace.writeToolPolicy(kit.laneId, { intents: { denied: ['tasks.add'] } });
    kit.connection.toolMode = 'auto';
    const run = seam === 'turn-end read'
      ? sweepBatchIntents(kit.connection, kit.emit)
      : sweepIntents(kit.connection, {
        mode: 'auto', emit: kit.emit, lanePolicy: workspace.readToolPolicy(kit.laneId),
      });
    kit.connection.activeTurn = null; // production finally does this immediately
    const receipts = await run;
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe('denied');
    expect((await readResult('denied-task')).status).toBe('denied');
    expect((await workspace.readTaskLedger(kit.laneId)).tasks).toHaveLength(0);
    expect(kit.connection._pendingApprovals.size).toBe(0);
  });

  test('queued sweep retains the original signal and cannot adopt a rebound lane', async () => {
    await fileTask('pending-first');
    await workspace.writeToolPolicy(kit.laneId, { intents: { requireApproval: ['tasks.add'] } });
    const original = kit.connection.activeTurn;
    const first = sweepBatchIntents(kit.connection, kit.emit);
    await request();
    const queued = sweepBatchIntents(kit.connection, kit.emit);
    original.abort();
    kit.connection.companion = { name: 'OtherFixture', neumaId: 'harness-other-fixture' };
    kit.connection.sessionId = 'session-harness-other';
    kit.connection.activeTurn = new AbortController();
    expect(await first).toEqual([]);
    expect(await queued).toEqual([]);
    await expect(fs.stat(workspace.pathFor('harness-other-fixture'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readResult('pending-first')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await workspace.readTaskLedger(kit.laneId)).tasks).toHaveLength(0);
    expect(kit.connection._pendingApprovals.size).toBe(0);
  });

  test.each(['origin abort', 'new turn', 'rebind'])('pending detached card is removed on %s', async (change) => {
    await fileTask('pending-card');
    await workspace.writeToolPolicy(kit.laneId, { intents: { requireApproval: ['tasks.add'] } });
    const original = kit.connection.activeTurn;
    const run = sweepBatchIntents(kit.connection, kit.emit);
    kit.connection.activeTurn = null;
    const card = await request();
    if (change === 'origin abort') original.abort();
    if (change === 'new turn') kit.connection.activeTurn = new AbortController();
    if (change === 'rebind') kit.connection.sessionId = 'session-other';
    expect(await run).toEqual([]);
    kit.decide(card, 'always'); // late answer has no pending entry to redeem
    await untilHarness(() => kit.frames.find((frame) => frame.type === 'tool:approval_resolved'));
    expect(kit.connection._pendingApprovals.size).toBe(0);
    await expect(readResult('pending-card')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await workspace.readToolPolicy(kit.laneId)).intents.allowed || []).not.toContain('tasks.add');
    expect((await workspace.readTaskLedger(kit.laneId)).tasks).toHaveLength(0);
  });

  test('detached policy/session snapshot cannot be widened by mutable connection changes', async () => {
    await fileTask('session-denied');
    kit.connection._sessionToolPolicy = { intents: { denied: ['tasks.add'] } };
    const run = sweepBatchIntents(kit.connection, kit.emit);
    kit.connection._sessionToolPolicy.intents.denied.length = 0;
    kit.connection.toolMode = 'auto';
    kit.connection.activeTurn = null;
    expect((await run)[0].status).toBe('denied');
    expect((await readResult('session-denied')).status).toBe('denied');
  });

  test('malformed persisted policy leaves real intent pending, never defaults to AUTO', async () => {
    await fileTask('bad-policy');
    await workspace.writeToolPolicy(kit.laneId, { intents: { denied: 'tasks.add' } });
    kit.connection.toolMode = 'auto';
    expect(await sweepBatchIntents(kit.connection, kit.emit)).toEqual([]);
    await expect(readResult('bad-policy')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await workspace.readTaskLedger(kit.laneId)).tasks).toHaveLength(0);
  });

  test('real settled task ID/status reaches both native follow-ups without surplus tool messages', async () => {
    await fileTask('landed-task');
    const calls = [{ server: 'fs', toolName: 'write', callId: 'file-intent', args: { path: intentPath('landed-task') } }];
    const run = sweepBatchIntents(kit.connection, kit.emit);
    kit.connection.activeTurn = null;
    const card = await request();
    expect(card.tool).toBe('intents/tasks.add');
    kit.decide(card, 'allow');
    const receipts = await run;
    const task = (await workspace.readTaskLedger(kit.laneId)).tasks[0];
    expect(task.chatId).toBe('session-harness-origin');
    expect((await readResult('landed-task')).status).toBe('done');
    expect(receipts[0].content).toContain(task.id.slice(0, 8));
    // The call result is input to the pure serializer; the independent receipt
    // above is the real executor output, not a fabricated settlement.
    const results = [{ tool: 'fs/write', status: 'ok', content: 'filed' }, ...receipts];
    for (const exchange of [
      nativeToolExchange({ response: '', calls, results, callId: (i) => `call-${i}`, formatResult: formatToolResult, followUp: 'continue' }),
      witnessExchange('', calls, results, 0),
    ]) {
      expect(exchange[0].tool_calls).toHaveLength(1);
      expect(exchange.filter((message) => message.role === 'tool')).toHaveLength(1);
      expect(exchange[1].tool_call_id).toBe('file-intent');
      expect(exchange.at(-1).content).toContain(task.id.slice(0, 8));
      expect(exchange.at(-1).content).toContain('intents/tasks.add');
      expect(exchange.at(-1).content).toContain('ok');
    }
  });
});
