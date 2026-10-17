/** Production settlement on real signed connections after a session transition. */
import { beforeEach, afterEach, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { clearSessionRuntime } from '../../backend/routes/portal-connections.js';
import { settleCompositionRecord } from '../../backend/services/portal-turn-persist.js';

let kit, scope;
beforeEach(async () => {
  kit = await createHarnessTurnKit('standing-scope-proof');
  scope = { neumaId: kit.laneId, sessionId: kit.connection.sessionId };
  clearSessionRuntime(kit.connection);
  kit.connection.sessionId = 'next-session';
  kit.connection.lastMeasuredStanding = { promptTokens: 250 };
  kit.connection.compositionToolResults = [{
    ref: 'tr_12345678_1_abcdef12', tool: 'fs/read', originalChars: 100, sentChars: 10, kind: 'verbatim',
  }];
});
afterEach(async () => { await kit?.close(); });

test('an old turn’s settlement cannot overwrite the new session’s standing measurement', () => {
  const result = settleCompositionRecord({
    connection: kit.connection, scope, standingUsage: { promptTokens: 1500 },
    turnUsage: { promptTokens: 2000, completionTokens: 10 }, interrupted: false,
    sections: [], completionText: 'done', budget: null,
  });
  expect(result.usage.inputTokens).toBe(1500);
  expect(kit.connection.lastMeasuredStanding).toEqual({ promptTokens: 250 });
});

test('an interrupted old turn cannot borrow a measurement from the new session', () => {
  const result = settleCompositionRecord({
    connection: kit.connection, scope, standingUsage: null, turnUsage: null,
    interrupted: true, sections: [], completionText: '', budget: null,
  });
  expect(result.usage.source).toBe('approx');
  expect(result.toolResults).toEqual([]);
  expect(result.usage.inputTokens).toBe(0);
  expect(kit.connection.lastMeasuredStanding).toEqual({ promptTokens: 250 });
});

test('an interrupted turn in the same session retains its labeled historical reading', () => {
  kit.connection.sessionId = scope.sessionId;
  const result = settleCompositionRecord({
    connection: kit.connection, scope, standingUsage: null, turnUsage: null,
    interrupted: true, sections: [], completionText: '', budget: null,
  });
  expect(result.usage.source).toBe('carried');
  expect(result.usage.inputTokens).toBe(250);
  expect(result.toolResults).toHaveLength(1);
});
