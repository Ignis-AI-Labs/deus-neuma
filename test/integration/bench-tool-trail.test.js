/**
 * THE BENCHMARK TOOL TRAIL (#564) — through the REAL tool loop (real dispatch,
 * signed-auth socket, kernel shell), no mocks (RULE 0). A benchmark sitting
 * keeps its tools; what it touched must ride the receipt so a run can be
 * audited for an answer-key lookup or a write outside its sandbox. Outside a
 * sitting, the same calls leave no trail.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import { beingCodingToolsFor, stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';
import { openTurnOperations } from '../../backend/services/turn-operation-checkpoint.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';
import {
  settleBenchmarkToolTrail, trailTargetOf, TRAIL_TARGET_MAX_CHARS,
} from '../../backend/services/benchmark-tool-trail.js';

let kit;
const call = (toolName, args = {}, callId = toolName) => ({
  server: 'coding', toolName, tool: `coding/${toolName}`, args, callId,
});
const ANSWER_KEY = 'https://example.invalid/gsm8k/answers.json';

describe('the benchmark tool trail', () => {
  beforeEach(async () => {
    kit = await createHarnessTurnKit('trail-fixture');
    kit.connection.toolWorkspace = kit.ground;
    await stashBeingTurnCatalog(kit.connection, await beingCodingToolsFor(kit.connection), []);
    openTurnRecord(kit.ws);
  });

  afterEach(async () => {
    if (kit) closeTurnRecord(kit.ws);
    await kit?.close();
  });

  // The rounds loop's own two steps: dispatch the batch, then settle the trail.
  const round = async (calls, turnId) => {
    const results = await processToolCalls(kit.ws, '', kit.connection, calls,
      await openTurnOperations(kit.connection, { turnId }));
    settleBenchmarkToolTrail(kit.connection, results);
    return results;
  };

  test('a sitting records every call: the tool, what it touched, how it settled', async () => {
    kit.connection._benchmarkControls = {};
    const results = await round([
      call('sandbox_status', {}, 'status-1'),
      call('no_such_fetch', { url: ANSWER_KEY }, 'fetch-1'),
    ], 'trail-1');
    const trail = kit.connection._benchmarkToolTrail;
    expect(trail).toHaveLength(2);
    expect(trail.map((e) => e.status)).toEqual(results.map((r) => r.status));
    expect(trail[0]).toMatchObject({ tool: results[0].tool, target: null });
    // The one that matters for the audit: the URL is on the record, verbatim.
    expect(trail[1]).toMatchObject({ target: ANSWER_KEY, status: 'unavailable' });
    // A second round appends and settles only its own entries.
    await round([call('sandbox_status', {}, 'status-2')], 'trail-2');
    expect(kit.connection._benchmarkToolTrail).toHaveLength(3);
    expect(kit.connection._benchmarkToolTrail.every((e) => e.status !== null)).toBe(true);
  });

  test('outside a sitting the same calls leave no trail', async () => {
    await round([call('no_such_fetch', { url: ANSWER_KEY }, 'fetch-2')], 'trail-3');
    expect(kit.connection._benchmarkToolTrail).toBeUndefined();
  });
});

describe('what a call touched', () => {
  test('the most specific argument names it, bounded and on one line', () => {
    expect(trailTargetOf({ path: '/tmp/a', query: 'q' })).toBe('/tmp/a');
    expect(trailTargetOf({ command: 'ls   -la\n/tmp' })).toBe('ls -la /tmp');
    expect(trailTargetOf({ url: `https://x.invalid/${'a'.repeat(400)}` })).toHaveLength(TRAIL_TARGET_MAX_CHARS);
    expect(trailTargetOf({ count: 3 })).toBeNull();
    expect(trailTargetOf(null)).toBeNull();
  });
});
