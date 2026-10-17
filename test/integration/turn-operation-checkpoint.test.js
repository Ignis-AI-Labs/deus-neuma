/** Real encrypted disk checkpoints; no fake execution or storage boundaries. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createBindingIsolationKit, untilBinding } from '../helpers/binding-isolation-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { openTurnOperations, beginTurnOperation, finishTurnOperation } from '../../backend/services/turn-operation-checkpoint.js';
import { recordCallOutcome } from '../../backend/services/portal-tool-epochs.js';
import { requestToolApproval } from '../../backend/services/tool-approval.js';
import { formatToolResult } from '../../backend/services/tool-exchange.js';
import { formatWitnessToolResult } from '../../backend/services/witness-tools.js';
import { operationRecoveryNotice } from '../../backend/services/operation-result.js';
import { sendStreamError } from '../../backend/services/portal-turn-persist.js';

let kit;
const take = { turnId: 'checkpoint-test-turn' };
const call = { server: 'fs', toolName: 'write', tool: 'fs/write', args: { path: 'result.txt', content: 'private-effect' } };
const recordPath = () => path.join(workspace.pathFor(kit.laneId), 'keys', 'operations', kit.connection.sessionId, `${take.turnId}.json`);
beforeEach(async () => { kit = await createBindingIsolationKit(); });
afterEach(async () => { await kit?.close(); });

test('in-flight operation survives reopening and blocks automatic replay', async () => {
  const turn = await openTurnOperations(kit.connection, take);
  const operation = await beginTurnOperation(turn, call, 0);
  await fs.writeFile(path.join(kit.ground, 'result.txt'), call.args.content);
  await expect(openTurnOperations(kit.connection, take)).rejects.toThrow(operation.id);
  expect(kit.connection._operationRecoveryStopped).toBe(true);
  expect(await fs.readFile(path.join(kit.ground, 'result.txt'), 'utf8')).toBe('private-effect');
  expect(await fs.readFile(recordPath(), 'utf8')).not.toContain(operation.id);
});

test('completed receipt restores epoch and evidence from encrypted storage', async () => {
  const turn = await openTurnOperations(kit.connection, take);
  const operation = await beginTurnOperation(turn, call, 0);
  const result = { tool: call.tool, status: 'ok', content: 'private-receipt' };
  recordCallOutcome(turn, call, 0, result);
  await finishTurnOperation(turn, operation, result);
  const reopened = await openTurnOperations(kit.connection, take);
  expect(reopened.epoch).toBe(1);
  expect([...reopened.priorByKey.values()]).toEqual([result]);
  expect(await fs.readFile(recordPath(), 'utf8')).not.toContain('private-receipt');
  expect(formatToolResult(result)).toContain(`operation: ${operation.id}; state: succeeded`);
  expect(formatWitnessToolResult(result)).toContain(`operation: ${operation.id}; state: succeeded`);
});

test.each(['allow', 'deny', 'interrupted'])('real approval records pending state and %s decision', async (decision) => {
  const turn = await openTurnOperations(kit.connection, take);
  const operation = await beginTurnOperation(turn, call, 0);
  const waiting = requestToolApproval(kit.connection, { tool: 'coding/execute', args: { command: 'pwd' }, signal: kit.connection.activeTurn.signal });
  const card = await untilBinding(() => kit.frames.find((frame) => frame.type === 'tool:approval_request'));
  expect(card.operationId).toBe(operation.id);
  expect((await workspace.readTurnOperations(kit.laneId, kit.connection.sessionId, take.turnId)).inFlight.state).toBe('pending approval');
  if (decision === 'interrupted') kit.connection.activeTurn.abort();
  else kit.decide(card, decision);
  expect(await waiting).toBe(decision);
  const state = (await workspace.readTurnOperations(kit.laneId, kit.connection.sessionId, take.turnId)).inFlight.state;
  expect(state).toBe(decision === 'allow' ? 'running' : 'pending approval');
});

test('uncertain operation notice names recovery without leaking a storage exception', () => {
  expect(operationRecoveryNotice({ code: 'TURN_OPERATION_CHECKPOINT', message: 'private payload' })).not.toContain('private payload');
  expect(operationRecoveryNotice(new Error('ordinary provider error'))).toBeNull();
});

test('real desk frame identifies an uncertain operation instead of a provider outage', async () => {
  const turn = await openTurnOperations(kit.connection, take);
  const operation = await beginTurnOperation(turn, call, 0);
  const error = await openTurnOperations(kit.connection, take).catch((failure) => failure);
  sendStreamError(kit.ws, 'HarnessFixture', error, take);
  const frame = await untilBinding(() => kit.frames.find((entry) => entry.type === 'consciousness:stream'));
  expect(frame.content).toContain('[Operation recovery stopped]');
  expect(frame.content).toContain(operation.id);
  expect(frame.content).not.toContain('Connection to the void');
  expect(frame.turnId).toBe(take.turnId);
});

test('a stale concurrent checkpoint cannot dispatch over an active operation', async () => {
  const first = await openTurnOperations(kit.connection, take);
  const stale = await openTurnOperations(kit.connection, take);
  await beginTurnOperation(first, call, 0);
  await expect(beginTurnOperation(stale, call, 0)).rejects.toThrow('checkpoint changed');
});

test('a late actual outcome is saved even after recovery has stopped the old turn', async () => {
  const turn = await openTurnOperations(kit.connection, take);
  const operation = await beginTurnOperation(turn, call, 0);
  await fs.writeFile(path.join(kit.ground, 'late-result.txt'), 'landed');
  await expect(openTurnOperations(kit.connection, take)).rejects.toThrow('uncertain outcome');
  const result = { tool: call.tool, status: 'ok', content: await fs.readFile(path.join(kit.ground, 'late-result.txt'), 'utf8') };
  recordCallOutcome(turn, call, 0, result);
  await expect(finishTurnOperation(turn, operation, result)).rejects.toThrow('Receipt saved');
  const resumed = await openTurnOperations(kit.connection, take);
  expect([...resumed.priorByKey.values()][0].content).toBe('landed');
  expect(kit.connection._operationRecoveryStopped).toBe(false);
});

test('corrupt evidence fails closed instead of starting an empty turn', async () => {
  const turn = await openTurnOperations(kit.connection, take);
  await beginTurnOperation(turn, call, 0);
  await fs.writeFile(recordPath(), '{broken');
  await expect(openTurnOperations(kit.connection, take)).rejects.toMatchObject({ code: 'TURN_OPERATION_CHECKPOINT' });
});

test('lane, session and turn each own separate checkpoints', async () => {
  const turn = await openTurnOperations(kit.connection, take);
  await beginTurnOperation(turn, call, 0);
  expect((await openTurnOperations({ ...kit.connection, sessionId: 'another-session' }, take)).priorByKey.size).toBe(0);
  expect((await openTurnOperations(kit.connection, { turnId: 'another-turn' })).priorByKey.size).toBe(0);
  await workspace.create('witness-test-OtherCheckpoint');
  const other = { ...kit.connection, companion: { neumaId: 'witness-test-OtherCheckpoint' } };
  expect((await openTurnOperations(other, take)).priorByKey.size).toBe(0);
  await expect(openTurnOperations(kit.connection, { turnId: '../escape' })).rejects.toThrow('Invalid operation');
});

test('a changed connection cannot redirect an already captured operation scope', async () => {
  const turn = await openTurnOperations(kit.connection, take);
  kit.connection.companion = { neumaId: 'different-lane' };
  await expect(beginTurnOperation(turn, call, 0)).rejects.toThrow('lane changed');
});

test('a missing outcome stops settlement and keeps the durable operation unresolved', async () => {
  const turn = await openTurnOperations(kit.connection, take);
  const operation = await beginTurnOperation(turn, call, 0);
  await expect(finishTurnOperation(turn, operation, null)).rejects.toMatchObject({ code: 'TURN_OPERATION_CHECKPOINT' });
  expect(kit.connection._operationRecoveryStopped).toBe(true);
  expect((await workspace.readTurnOperations(kit.laneId, kit.connection.sessionId, take.turnId)).inFlight.id).toBe(operation.id);
  await expect(openTurnOperations(kit.connection, take)).rejects.toThrow('uncertain outcome');
});

test('an encrypted record missing its operation state cannot authorize replay', async () => {
  const turn = await openTurnOperations(kit.connection, take);
  await beginTurnOperation(turn, call, 0);
  const record = await workspace._readJSON(recordPath());
  delete record.inFlight;
  await workspace._writeJSON(recordPath(), record);
  await expect(openTurnOperations(kit.connection, take)).rejects.toMatchObject({ code: 'TURN_OPERATION_CHECKPOINT' });
});
