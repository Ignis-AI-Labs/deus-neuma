/**
 * THE BENCHMARK TOOL TRAIL (#564) — through the REAL tool loop (real dispatch,
 * signed-auth socket, kernel shell), no mocks (RULE 0). A benchmark sitting
 * keeps its tools; what it touched must ride the receipt so a run can be
 * audited for an answer-key lookup or a write outside its sandbox. Outside a
 * sitting, the same calls leave no trail. A failed call keeps WHY — its
 * message and the argument names, never their values (tool fluency).
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import { processRoundActs } from '../../backend/services/caller-tools.js';
import { CLOSED_BOOK_REFUSAL } from '../../backend/services/closed-book.js';
import { beingCodingToolsFor, stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';
import { openTurnOperations } from '../../backend/services/turn-operation-checkpoint.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';
import {
  trailArgKeysOf, trailMessageOf, trailTargetOf, TRAIL_MESSAGE_MAX_CHARS, TRAIL_TARGET_MAX_CHARS,
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

  // The rounds loop's own step: the round's acts, through the gates, into the tool loop.
  const round = async (calls, turnId) => processRoundActs(processToolCalls, kit.ws, '', kit.connection, calls,
    await openTurnOperations(kit.connection, { turnId }));

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
    expect(trail[1]).toMatchObject({ target: ANSWER_KEY, status: 'unavailable', argKeys: ['url'] });
    // ...and why it failed, in the harness's own words; a call that ran carries no message.
    expect(trail[1].message).toBe(trailMessageOf(results[1]));
    expect(trail[1].message.length).toBeGreaterThan(0);
    expect(trail[0]).not.toHaveProperty('message');
    // A second round appends and settles only its own entries.
    await round([call('sandbox_status', {}, 'status-2')], 'trail-2');
    expect(kit.connection._benchmarkToolTrail).toHaveLength(3);
    expect(kit.connection._benchmarkToolTrail.every((e) => e.status !== null)).toBe(true);
  });

  test('a failed call keeps the argument names it wrote, never their values', async () => {
    kit.connection._benchmarkControls = {};
    await round([call('no_such_fetch', { url: ANSWER_KEY, oldText: 'VALUE-NEVER-KEPT', limit: 3 }, 'fetch-3')], 'trail-4');
    const [entry] = kit.connection._benchmarkToolTrail;
    expect(entry.argKeys).toEqual(['url', 'oldText', 'limit']);
    expect(JSON.stringify(entry)).not.toContain('VALUE-NEVER-KEPT');
  });

  test('a refused act and a run act in one round each keep their own outcome', async () => {
    // A closed-book sitting refuses the network act before the loop; the local
    // act runs. The refusal used to settle the run act's entry — its tool and
    // its "denied" — and the run act's own outcome was lost.
    kit.connection._benchmarkControls = {};
    kit.connection._closedBook = true;
    const results = await round([
      { server: 'web', toolName: 'fetch', args: { url: ANSWER_KEY }, callId: 'refused-1' },
      call('sandbox_status', {}, 'own-1'),
    ], 'trail-5');
    expect(results.map((r) => r.status)[0]).toBe('denied');
    const trail = kit.connection._benchmarkToolTrail;
    expect(trail).toHaveLength(2);
    const refused = trail.find((e) => e.tool === 'web/fetch');
    const own = trail.find((e) => /sandbox_status/.test(e.tool));
    expect(refused).toMatchObject({ status: 'denied', target: ANSWER_KEY, argKeys: ['url'] });
    expect(refused.message).toBe(CLOSED_BOOK_REFUSAL);
    expect(own).toMatchObject({ tool: results[1].tool, status: results[1].status, argKeys: [] });
    expect(own.status).not.toBe('denied');
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

  test('argument names are kept only for an object; a message only for a call that failed', () => {
    expect(trailArgKeysOf({ path: '/a', content: 'x' })).toEqual(['path', 'content']);
    expect(trailArgKeysOf('{"path": unreadable')).toBeNull();
    expect(trailArgKeysOf(['a'])).toBeNull();
    expect(trailMessageOf({ status: 'ok', error: 'stale' })).toBeNull();
    expect(trailMessageOf({ status: 'yielded' })).toBeNull();
    expect(trailMessageOf({ status: 'error', error: new Error('boom\n  at x') })).toBe('boom at x');
    expect(trailMessageOf({ status: 'error', error: 'e'.repeat(900) })).toHaveLength(TRAIL_MESSAGE_MAX_CHARS);
  });
});
