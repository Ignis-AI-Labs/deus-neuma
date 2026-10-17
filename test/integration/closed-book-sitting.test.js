/**
 * THE CLOSED-BOOK SITTING through the REAL tool loop (real dispatch, signed
 * auth socket, kernel shell) — no mocks (RULE 0). Design note, 2026-10-01: SimpleQA
 * runs closed-book for every arm. The catalog keeps local servers only, a web
 * call is refused on the spot and recorded as denied, local acts still run,
 * the lane's standing network grant never hydrates, and no intent settles.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import { beingCodingToolsFor, stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';
import { openTurnOperations } from '../../backend/services/turn-operation-checkpoint.js';
import { openTurnRecord, closeTurnRecord } from '../../backend/services/tool-action-record.js';
import { processRoundActs } from '../../backend/services/caller-tools.js';
import { CLOSED_BOOK_REFUSAL, CLOSED_BOOK_SERVERS, closedBookCatalog, closedBookSplit } from '../../backend/services/closed-book.js';
import { WEB_TOOLS } from '../../backend/services/web-being-tools.js';
import { captureShellNetwork, hydrateShellNetwork, shellNetworkOptions } from '../../backend/services/shell-network-grants.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { intentSectionFor } from '../../backend/services/intents/intents-section.js';

let kit;
const round = async (acts, turnId) => processRoundActs(processToolCalls, kit.ws, '', kit.connection, acts,
  await openTurnOperations(kit.connection, { turnId }));

describe('a closed-book sitting', () => {
  beforeEach(async () => {
    kit = await createHarnessTurnKit('closed-book-fixture');
    kit.connection.toolWorkspace = kit.ground;
    kit.connection._closedBook = true;
    kit.connection._benchmarkControls = {};
    await stashBeingTurnCatalog(kit.connection, [...await beingCodingToolsFor(kit.connection), ...WEB_TOOLS], []);
    openTurnRecord(kit.ws);
  });

  afterEach(async () => {
    if (kit) closeTurnRecord(kit.ws);
    await kit?.close();
  });

  test('the catalog keeps local servers only — no web tool is offered', () => {
    const servers = new Set(kit.connection._turnCatalog.map((t) => t.server));
    expect([...servers].every((s) => CLOSED_BOOK_SERVERS.includes(s))).toBe(true);
    expect(kit.connection._turnCatalog.some((t) => t.server === 'web')).toBe(false);
  });

  test('a web call is refused and recorded denied; a local act in the same round still runs', async () => {
    const results = await round([
      { server: 'coding', toolName: 'sandbox_status', tool: 'coding/sandbox_status', args: {}, callId: 'own' },
      { server: 'web', toolName: 'web_search', args: { query: 'answer key' }, callId: 'web' },
      { server: null, toolName: 'web_fetch', args: { url: 'https://example.invalid' }, callId: 'bare' },
    ], 'cb-1');
    expect(results).toHaveLength(3);
    expect(results[0].tool).toMatch(/sandbox_status/);
    expect(results.slice(1)).toEqual([
      { tool: 'web/web_search', status: 'denied', error: CLOSED_BOOK_REFUSAL },
      { tool: 'unknown/web_fetch', status: 'denied', error: CLOSED_BOOK_REFUSAL },
    ]);
    const trail = kit.connection._benchmarkToolTrail;
    expect(trail.filter((e) => e.status === 'denied').map((e) => e.tool)).toEqual(['web/web_search', 'unknown/web_fetch']);
  });

  test('a forged server prefix is refused — only a (server, name) pair the catalog carries runs', async () => {
    // benchmarks-51, 2026-10-02: the server the model writes was trusted, so
    // `fs__web_search` passed the allowlist by naming a local server.
    const results = await round([
      { server: 'fs', toolName: 'web_search', args: { query: 'answer key' }, callId: 'forged-web' },
      { server: 'coding', toolName: 'memory_search', args: { query: 'answer' }, callId: 'forged-memory' },
      { server: 'coding', toolName: 'sandbox_status', tool: 'coding/sandbox_status', args: {}, callId: 'own' },
    ], 'cb-forged');
    expect(results).toHaveLength(3);
    // results answer the calls IN THE ORDER CALLED — the exchange pairs them with
    // tool_call_ids by position (2026-10-15: refusals listed last answered the wrong call)
    expect(results.slice(0, 2)).toEqual([
      { tool: 'fs/web_search', status: 'denied', error: CLOSED_BOOK_REFUSAL },
      { tool: 'coding/memory_search', status: 'denied', error: CLOSED_BOOK_REFUSAL },
    ]);
    expect(results[2].tool).toMatch(/sandbox_status/);
  });

  test('a refusal between two runs keeps its place: each result answers its own call', async () => {
    const results = await round([
      { server: 'coding', toolName: 'sandbox_status', tool: 'coding/sandbox_status', args: {}, callId: 'first' },
      { server: 'web', toolName: 'web_search', args: { query: 'answer key' }, callId: 'middle' },
      { server: 'coding', toolName: 'sandbox_status', tool: 'coding/sandbox_status', args: {}, callId: 'last' },
    ], 'cb-order');
    expect(results.map((r) => r.status === 'denied' ? 'denied' : r.tool.replace(/^.*\//, ''))).toEqual(['sandbox_status', 'denied', 'sandbox_status']);
  });

  test('the INTENTS section is not sent — nothing it offers could settle', async () => {
    // The same lane outside a closed-book sitting is offered its intents.
    kit.connection._closedBook = false;
    expect(await intentSectionFor(kit.connection)).toContain('## Intents');
    kit.connection._closedBook = true;
    expect(await intentSectionFor(kit.connection)).toBe('');
  });

  test('the lane\'s standing network grant never reaches the shell, and no intent settles', async () => {
    const context = captureShellNetwork(kit.connection);
    hydrateShellNetwork(kit.connection, { shellNetwork: true });
    expect(shellNetworkOptions(context, true).network).toBe(false);
    // The same grant outside a closed-book sitting opens the network — the guard is what closed it.
    kit.connection._closedBook = false;
    hydrateShellNetwork(kit.connection, { shellNetwork: true });
    expect(shellNetworkOptions(context, true).network).toBe(true);
    kit.connection._closedBook = true;
    expect(await sweepIntents(kit.connection, { mode: 'auto', emit: () => {} })).toEqual([]);
  });
});

describe('outside a closed-book sitting nothing changes', () => {
  test('every tool and every act passes through', () => {
    const tools = [{ server: 'web', name: 'web_search' }, { server: 'fs', name: 'read' }];
    expect(closedBookCatalog({}, tools)).toBe(tools);
    const acts = [{ server: 'web', toolName: 'web_search' }];
    expect(closedBookSplit({}, acts)).toEqual({ allowed: acts, refused: [] });
  });
});

// Design note, 2026-10-06: a model answering from what it STORED is measuring memory,
// not knowledge — memory benchmarking is its own infrastructure. Any benchmark
// sitting, open-book or not, loses the memory server.
describe('a benchmark sitting never reaches stored memory', () => {
  const tools = [{ server: 'web', name: 'web_search' }, { server: 'memory', name: 'memory_search' }, { server: 'memory', name: 'memory_expand' }, { server: 'fs', name: 'read' }];
  test('open-book benchmark: the web stays (declared), memory goes', () => {
    expect(closedBookCatalog({ _benchmarkControls: {} }, tools).map((t) => `${t.server}/${t.name}`)).toEqual(['web/web_search', 'fs/read']);
  });
  test('closed-book benchmark: local hands only, memory still gone', () => {
    expect(closedBookCatalog({ _benchmarkControls: {}, _closedBook: true }, tools).map((t) => t.server)).toEqual(['fs']);
  });
  test('an ordinary sitting keeps its memory', () => {
    expect(closedBookCatalog({}, tools)).toBe(tools);
  });
});
