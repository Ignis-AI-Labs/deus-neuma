/** Pure production functions with real inputs. No mock execution boundary. */
import { describe, expect, test } from 'vitest';
import { createTurnToolEpochs, heldCallResult, recordCallOutcome } from '../../backend/services/portal-tool-epochs.js';
import { toolCallKey } from '../../backend/services/witness-tool-epochs.js';
import { isObservationTool } from '../../backend/services/tool-policy.js';
import { nativeToolExchange, formatToolResult } from '../../backend/services/tool-exchange.js';
import { validateIntentPolicy } from '../../backend/services/intents/intent-context.js';

const execute = Object.freeze({ server: 'coding', toolName: 'execute', args: { command: 'node check.cjs' } });
const write = Object.freeze({ server: 'fs', toolName: 'write', args: { path: '/project/check.cjs', content: 'fixed' } });
const result = Object.freeze({ tool: 'coding/execute', status: 'error', error: 'exit 1' });

describe('harness repeat law', () => {
  test('execute is epoch-sensitive, not an observation or self-unlocking act', () => {
    expect(isObservationTool(execute)).toBe(false);
    expect(toolCallKey(execute, 1)).not.toBe(toolCallKey(execute, 0));
    const turn = createTurnToolEpochs();
    recordCallOutcome(turn, execute, turn.epoch, result);
    expect(turn.epoch).toBe(1);
    expect(heldCallResult(turn, execute, turn.epoch).status).toBe('held');
    recordCallOutcome(turn, write, turn.epoch, { tool: 'fs/write', status: 'ok', content: 'written' });
    expect(heldCallResult(turn, execute, turn.epoch)).toBeNull();
    expect(heldCallResult(turn, write, turn.epoch).status).toBe('held');
  });

  test.each(['held', 'denied', 'unavailable', 'unsafe_args'])('%s attempts do not manufacture mutation', (status) => {
    const turn = createTurnToolEpochs();
    recordCallOutcome(turn, write, turn.epoch, { tool: 'fs/write', status });
    expect(turn.epoch).toBe(0);
  });

  test('dry-run edits and schema searches do not unlock a shell retry', () => {
    const turn = createTurnToolEpochs();
    recordCallOutcome(turn, execute, turn.epoch, result);
    for (const call of [
      { server: 'fs', toolName: 'edit', args: { edits: [], dryRun: true } },
      { server: 'system', toolName: 'tool_search', args: { query: 'coding' } },
    ]) recordCallOutcome(turn, call, turn.epoch, { status: 'ok', content: 'preview' });
    expect(heldCallResult(turn, execute, turn.epoch).status).toBe('held');
  });

  test('unresolved and malformed policy fail closed at the seam', () => {
    expect(() => validateIntentPolicy(Promise.resolve({ intents: { denied: ['tasks.add'] } }))).toThrow(/resolved record/);
    expect(() => validateIntentPolicy([])).toThrow();
    expect(() => validateIntentPolicy({ intents: { denied: 'tasks.add' } })).toThrow();
    expect(validateIntentPolicy({ intents: { denied: ['tasks.add'] }, shellNetwork: false })).toEqual({
      intents: { denied: ['tasks.add'] }, shellNetwork: false,
    });
  });

  test('native pairing preserves duplicate positions, surplus receipts and missing slots', () => {
    const calls = [0, 1].map((i) => ({ ...execute, callId: `same-${i}` }));
    const receipt = { tool: 'intents/tasks.add', status: 'ok', content: 'Recorded [task-id]' };
    const exchange = nativeToolExchange({
      response: '', calls, results: [result, { ...result, status: 'held', content: 'already ran' }, receipt],
      callId: (i) => `unused-${i}`, formatResult: formatToolResult, followUp: 'continue',
    });
    expect(exchange.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['same-0', 'same-1']);
    expect(exchange[1].content).toContain('exit 1');
    expect(exchange[2].content).toContain('already ran');
    expect(exchange.at(-1).content).toContain('task-id');
    const interrupted = nativeToolExchange({ response: '', calls, results: [], callId: (i) => `${i}`, formatResult: formatToolResult, followUp: '' });
    expect(interrupted.filter((m) => m.role === 'tool')).toHaveLength(2);
    expect(interrupted[1].content).toContain('not executed');
  });
});
