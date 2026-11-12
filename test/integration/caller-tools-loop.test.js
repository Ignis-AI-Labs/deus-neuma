/**
 * CALLER TOOLS through the REAL tool loop (real dispatch, signed-auth socket,
 * kernel shell) — no mocks (RULE 0). The sender's tools join the turn catalog
 * and ride natively; a round that calls one hands it back and runs nothing for
 * it, while the being's own acts in the same round still run.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import {
  beingCodingToolsFor, disclosedNativeTools, stashBeingTurnCatalog,
} from '../../backend/services/being-tool-surface.js';
import { openTurnOperations } from '../../backend/services/turn-operation-checkpoint.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';
import { callerYielded, normalizeCallerTools, processRoundActs } from '../../backend/services/caller-tools.js';

let kit;
const WEATHER = { type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } };

describe('caller tools in the real tool loop', () => {
  beforeEach(async () => {
    kit = await createHarnessTurnKit('caller-fixture');
    kit.connection.toolWorkspace = kit.ground;
    kit.connection._callerTools = normalizeCallerTools([WEATHER]).tools;
    await stashBeingTurnCatalog(kit.connection, await beingCodingToolsFor(kit.connection), []);
    openTurnRecord(kit.ws);
  });

  afterEach(async () => {
    if (kit) closeTurnRecord(kit.ws);
    await kit?.close();
  });

  const round = async (acts, turnId) => processRoundActs(processToolCalls, kit.ws, '', kit.connection, acts,
    await openTurnOperations(kit.connection, { turnId }));

  test('the sender\'s tools ride the catalog natively, open', () => {
    const native = disclosedNativeTools(kit.connection).filter((t) => t.server === 'caller');
    expect(native).toEqual([expect.objectContaining({ name: 'get_weather', access: 'allowed' })]);
  });

  test('a caller call is handed back; the being\'s own act in the same round still runs', async () => {
    kit.connection._benchmarkControls = {};
    const results = await round([
      { server: 'coding', toolName: 'sandbox_status', tool: 'coding/sandbox_status', args: {}, callId: 'own-1' },
      { server: 'caller', toolName: 'get_weather', args: { city: 'Oslo' }, callId: 'call_9' },
    ], 'caller-1');
    // Only the being's own act produced a result — nothing ran for the sender's.
    expect(results).toHaveLength(1);
    expect(results[0].tool).toMatch(/sandbox_status/);
    expect(callerYielded(kit.connection)).toBe(true);
    expect(kit.connection._callerToolCalls).toEqual([{ id: 'call_9', name: 'get_weather', arguments: '{"city":"Oslo"}' }]);
    expect(kit.connection._benchmarkToolTrail.at(-1)).toEqual({ tool: 'caller/get_weather', target: null, argKeys: ['city'], status: 'yielded' });
  });

  test('a repeat of the sender\'s last exchange is held, and the trail says so', async () => {
    kit.connection._benchmarkControls = {};
    kit.connection._callerTail = [
      { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'caller__get_weather', arguments: '{"city":"Oslo"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'Sunny, 4°C' },
    ];
    const results = await round([{ server: 'caller', toolName: 'get_weather', args: { city: 'Oslo' }, callId: 'call_10' }], 'caller-3');
    expect(results.map((r) => r.status)).toEqual(['held']);
    expect(callerYielded(kit.connection)).toBe(false);
    expect(kit.connection._benchmarkToolTrail).toEqual([{ tool: 'caller/get_weather', target: null, argKeys: ['city'], status: 'held' }]);
  });

  test('a round with no caller call is the tool loop exactly as before', async () => {
    const results = await round([{ server: 'coding', toolName: 'sandbox_status', tool: 'coding/sandbox_status', args: {}, callId: 's' }], 'caller-2');
    expect(results).toHaveLength(1);
    expect(callerYielded(kit.connection)).toBe(false);
  });
});
