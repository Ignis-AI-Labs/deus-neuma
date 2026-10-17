/** Real clocks, signed approval, encrypted checkpoints and kernel sandbox. */
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createBindingIsolationKit, untilBinding } from '../helpers/binding-isolation-kit.js';
import { openTurnOperations, beginTurnOperation, finishTurnOperation } from '../../backend/services/turn-operation-checkpoint.js';
import { recordCallOutcome } from '../../backend/services/portal-tool-epochs.js';
import { requestToolApproval } from '../../backend/services/tool-approval.js';
import { formatToolResult } from '../../backend/services/tool-exchange.js';
import { formatWitnessToolResult } from '../../backend/services/witness-tools.js';
import { operationReceiptLabel } from '../../backend/services/operation-result.js';
import { ensureWitnessCodingSandbox, runWitnessCommand } from '../../backend/services/witness-coding-sandbox.js';
import { renderCommandResult } from '../../backend/services/coding-result.js';

let kit;
const take = { turnId: 'timing-proof' };
const call = { server: 'coding', toolName: 'execute', tool: 'coding/execute', args: { command: 'pwd' } };
beforeEach(async () => { kit = await createBindingIsolationKit(); });
afterEach(async () => { await kit?.close(); });

test.each(['allow', 'deny', 'interrupted'])('preserves real %s approval timing through encrypted replay', async (decision) => {
  const turn = await openTurnOperations(kit.connection, take);
  const operation = await beginTurnOperation(turn, call, 0);
  const waiting = requestToolApproval(kit.connection, {
    tool: call.tool, args: call.args, signal: kit.connection.activeTurn.signal,
  });
  const card = await untilBinding(() => kit.frames.find((frame) => frame.type === 'tool:approval_request'));
  await delay(25);
  if (decision === 'interrupted') kit.connection.activeTurn.abort();
  else kit.decide(card, decision);
  expect(await waiting).toBe(decision);
  const result = { tool: call.tool, status: decision === 'allow' ? 'ok' : 'error', content: decision };
  recordCallOutcome(turn, call, 0, result);
  await finishTurnOperation(turn, operation, result);
  const timing = result.operationTiming;
  expect(timing.startedAt).toBe(operation.startedAt);
  expect(timing.finishedAt).toMatch(/Z$/);
  expect(timing.approvalWaitMs).toBeGreaterThanOrEqual(20);
  expect(timing.durationMs).toBeGreaterThanOrEqual(timing.approvalWaitMs);
  expect(timing.activeDurationMs).toBe(timing.durationMs - timing.approvalWaitMs);
  expect(timing.approvals).toHaveLength(1);
  expect(timing.approvals[0].decision).toBe(decision);
  const reopened = await openTurnOperations(kit.connection, take);
  expect([...reopened.priorByKey.values()][0].operationTiming).toEqual(timing);
  for (const format of [formatToolResult, formatWitnessToolResult]) {
    expect(format(result)).toContain(`started_at: ${timing.startedAt}`);
    expect(format(result)).toContain(`approval_wait: ${timing.approvalWaitMs} ms`);
  }
});

test('timestamps actual sandbox execution and both output streams', async () => {
  const sandbox = await ensureWitnessCodingSandbox(kit.laneId, kit.ground);
  const result = await runWitnessCommand({ ...sandbox, mode: 'inspect',
    command: 'node -e \'console.log("timed-out"); console.error("timed-err")\'' });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('timed-out');
  expect(result.stderr).toContain('timed-err');
  expect(result.timing.durationMs).toBeGreaterThan(0);
  expect(result.timing.startedAt).toMatch(/Z$/);
  expect(result.timing.finishedAt).toMatch(/Z$/);
  expect(renderCommandResult(result)).toContain(`execution_duration_ms: ${result.timing.durationMs}`);
}, 60_000);

test('legacy receipts explicitly report unavailable timing', () => {
  expect(operationReceiptLabel({ operationId: 'legacy', operationState: 'succeeded' }))
    .toContain('timing: unavailable (legacy receipt)');
});
