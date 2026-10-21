/**
 * B-02 (CCR-lite) — the retrieve_result platform tool, proven end to end with
 * NO mock on the claimed path (AGENTS.md RULE 0): REAL WebSocket pair, REAL
 * NeumaWorkspace on real encrypted disk, REAL records persisted through
 * B-01's _persistOverCapResult, REAL approval gate traversed over the wire.
 *
 * Covers FR-3 (conditional advertisement), FR-4 (existing gate, no bypass),
 * FR-5 (BM25 query + anchored no-query), FR-6 (capped re-entry, never
 * re-persisted) and NFR-2 (refs scoped to the connection's own session —
 * foreign and malformed refs die without a foreign file ever being opened).
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { stashBeingTurnCatalog, TOOL_SEARCH_TOOL } from '../../backend/services/being-tool-surface.js';
import workspace, {
  setWorkspacesRoot, getWorkspacesRoot, TOOL_RESULT_REF_PATTERN,
} from '../../core/workspace/neuma-workspace.js';

const {
  processToolCalls,
  _persistOverCapResult,
  _retrieveToolsFor,
  RETRIEVE_RESULT_TOOL,
  TOOL_RESULT_MAX_CHARS,
} = __test;

const KEY = 'portal-retrieve-tool-test-key-long-enough';
const NEUMA_ID = 'retrieveecho';
const NEEDLE = 'NEEDLE-7f3a quantum resonance stabilized in the deep middle';

const uid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

// A realistic over-cap payload with a distinctive needle buried deep in the
// middle — the region an anchored front/back slice always cuts, so finding it
// proves the query path actually searched the stored record.
const overCapContent = () => {
  const lines = [];
  for (let i = 0; i < 250; i += 1) {
    lines.push(`line ${i} of a long tool result body padded ${'x'.repeat(40)}`);
  }
  lines.push(NEEDLE);
  for (let i = 250; i < 500; i += 1) {
    lines.push(`line ${i} of a long tool result body padded ${'x'.repeat(40)}`);
  }
  return lines.join('\n');
};

const retrieveCall = (ref, query) =>
  `[TOOL: record/retrieve_result ${JSON.stringify(query ? { ref, query } : { ref })}]`;

describe('B-02 — retrieve_result platform tool (real WS + real disk, gnosis)', () => {
  let house, origRoot, httpServer, wss, serverWs, client, port;
  let clientLog;
  let decide = null; // armed per test: the witness's chip answer

  const freshConnection = (extra = {}) => ({
    ws: serverWs,
    companion: { name: 'RetrieveEcho', neumaId: NEUMA_ID },
    sessionId: uid('sess'),
    ...extra,
  });

  // Mirror the route: the witness's answer settles the pending request.
  const wireApprovals = (connection) => {
    serverWs.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'tool:approval_response') resolveToolApproval(connection, m.id, m.decision);
    });
  };

  // Persist a real over-cap record for this connection through B-01's lane;
  // returns the real minted ref.
  const persistReal = async (connection, content = overCapContent()) => {
    const result = { tool: 'filesystem/read_file', status: 'ok', content };
    const ref = await _persistOverCapResult(connection, result);
    expect(ref).toMatch(TOOL_RESULT_REF_PATTERN);
    return ref;
  };

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;

    house = await createTempDir('retrieve-tool-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => { serverWs = ws; resolve(); });
    });
    client = new WebSocket(`ws://localhost:${port}`);
    clientLog = [];
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      clientLog.push(msg);
      if (msg.type === 'tool:approval_request' && decide) {
        client.send(JSON.stringify({ type: 'tool:approval_response', id: msg.id, decision: decide(msg) }));
      }
    });
    await linked;
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(origRoot);
    delete process.env.DNA_ENCRYPTION_KEY;
    await fs.rm(house, { recursive: true, force: true });
  });

  test('advertisement is available for the first result and requires a bound session', async () => {
    const connection = freshConnection();
    expect(_retrieveToolsFor(connection)).toEqual([RETRIEVE_RESULT_TOOL]);
    expect(_retrieveToolsFor({ ...connection, sessionId: null })).toEqual([]);
    expect(_retrieveToolsFor({ ...connection, companion: null })).toEqual([]);

    await persistReal(connection);

    const advertised = _retrieveToolsFor(connection);
    expect(advertised).toEqual([RETRIEVE_RESULT_TOOL]);
    expect(advertised[0].name).toBe('retrieve_result');
    // Native-calling path rides the same list: the def carries an inputSchema
    expect(advertised[0].inputSchema.required).toContain('ref');
  });

  test('happy path through the REAL gate: ask mode, witness ALLOWs, query recovers the buried needle, capped', async () => {
    const connection = freshConnection();
    wireApprovals(connection);
    const ref = await persistReal(connection);
    clientLog.length = 0;
    decide = () => 'allow';

    const results = await processToolCalls(
      serverWs, retrieveCall(ref, 'quantum resonance stabilized'), connection
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('ok');
    // The needle lives in the middle — the region every anchored slice cuts —
    // so its presence proves BM25 searched the real stored record.
    expect(results[0].content).toContain(NEEDLE);
    expect(results[0].content.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    // The gate really fired, over the real wire, naming the real tool
    const request = clientLog.find((m) => m.type === 'tool:approval_request');
    expect(request).toBeTruthy();
    expect(request.tool).toBe('record/retrieve_result');
    // The chip preview names the real ref the witness is deciding on
    expect(JSON.stringify(request)).toContain(ref);
  }, 30000);

  test('no-query anchored mode: front of the record returns under the honest ccr grammar, capped', async () => {
    const connection = freshConnection({ toolMode: 'auto' });
    const ref = await persistReal(connection);
    clientLog.length = 0;
    decide = () => { throw new Error('a prompt fired in auto mode'); };

    const results = await processToolCalls(serverWs, retrieveCall(ref), connection);

    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('line 0 of a long tool result body');
    expect(results[0].content).toContain(`[ccr:${ref}`);
    expect(results[0].content.length).toBeLessThanOrEqual(TOOL_RESULT_MAX_CHARS);
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('a page asked for runs up to the room left — one call reads what took dozens of 3,000-char pages', async () => {
    const connection = freshConnection({ toolMode: 'auto', _turnRoom: { window: 262144, promptTokens: 20000 } });
    const content = overCapContent();
    const ref = await persistReal(connection, content);
    decide = () => { throw new Error('a prompt fired in auto mode'); };
    const page = `[TOOL: record/retrieve_result ${JSON.stringify({ ref, offset: 0, pageChars: content.length })}]`;

    const [result] = await processToolCalls(serverWs, page, connection);

    expect(result.status).toBe('ok');
    expect(result.content).toBe(`[ccr:${ref} page @0-${content.length} of ${content.length}; next_offset: end]\n${content}`);
    expect(result.cap).toBe(result.content.length); // the round's standing cap cannot cut it again

    const tight = freshConnection({ toolMode: 'auto', _turnRoom: { window: 32768, promptTokens: 30000 } });
    const tightRef = await persistReal(tight, content);
    const [refused] = await processToolCalls(serverWs, `[TOOL: record/retrieve_result ${JSON.stringify({ ref: tightRef, offset: 0, pageChars: content.length })}]`, tight);
    expect(refused.status).toBe('error');
    expect(refused.error).toMatch(/pageChars must be an integer from 2 to 3000/);
  }, 30000);

  test('a long PLATFORM result (not only an organ read) is kept and retrievable — never a dead cut', async () => {
    const connection = freshConnection({ toolMode: 'auto' });
    // retrieve_result rides every session's catalog (portal-tool-catalog.js retrieveToolsFor).
    const tools = [TOOL_SEARCH_TOOL, ..._retrieveToolsFor(connection), ...Array.from({ length: 8 }, (_, i) => ({
      server: 'atlas', name: `chart_${i}`,
      description: `Chart the stars ${i}. ${'Long guidance about charting. '.repeat(40)}`,
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    }))];
    await stashBeingTurnCatalog(connection, tools, []);
    decide = () => { throw new Error('a prompt fired in auto mode'); };

    const [found] = await processToolCalls(serverWs, '[TOOL: system/tool_search {"query": "chart stars"}]', connection);

    expect(found.status).toBe('ok');
    expect(found.content.length).toBeGreaterThan(TOOL_RESULT_MAX_CHARS);
    expect(found.ref).toMatch(TOOL_RESULT_REF_PATTERN);
    const [page] = await processToolCalls(serverWs, `[TOOL: record/retrieve_result ${JSON.stringify({ ref: found.ref, offset: 0, pageChars: 3000 })}]`, connection);
    expect(page.content).toContain(found.content.slice(0, 2000));
  }, 30000);

  test('foreign-session ref: honest error, and no file outside the own session lane was ever touched', async () => {
    const owner = freshConnection({ toolMode: 'auto' });
    const foreignRef = await persistReal(owner, `SECRET-OWNER-CONTENT ${overCapContent()}`);

    // A different session of the same being tries the owner's ref
    const intruder = freshConnection({ toolMode: 'auto' });
    decide = () => { throw new Error('a prompt fired in auto mode'); };
    const results = await processToolCalls(serverWs, retrieveCall(foreignRef), intruder);

    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('no such result this session');
    expect(results[0].content).toBeUndefined();
    expect(JSON.stringify(results)).not.toContain('SECRET-OWNER-CONTENT');

    // Workspace layout: only sessions that persisted have files, and the
    // intruder's own lane file was never created by the failed resolve —
    // resolution can only ever open the connection's OWN session file.
    const laneDir = path.join(workspace._path(NEUMA_ID), 'tool-results');
    const files = await fs.readdir(laneDir);
    expect(files).not.toContain(`${intruder.sessionId}.jsonl`);
    expect(files).toContain(`${owner.sessionId}.jsonl`);
  }, 30000);

  test('malformed refs: honest error before the gate — no prompt, no read', async () => {
    const connection = freshConnection();
    wireApprovals(connection);
    clientLog.length = 0;
    decide = () => { throw new Error('a prompt fired for a malformed ref'); };

    for (const bad of ['not-a-ref', 'tr_../../etc/passwd', '']) {
      const results = await processToolCalls(
        serverWs, `[TOOL: record/retrieve_result ${JSON.stringify({ ref: bad })}]`, connection
      );
      expect(results[0].status).toBe('error');
      expect(results[0].error).toContain('is not a result ref');
    }
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('DENY fails closed: the operator says no over the real wire and the neuma learns why', async () => {
    const connection = freshConnection(); // ask mode (default)
    wireApprovals(connection);
    const ref = await persistReal(connection);
    clientLog.length = 0;
    decide = () => 'deny';

    const results = await processToolCalls(serverWs, retrieveCall(ref), connection);

    expect(results[0].status).toBe('denied');
    expect(results[0].error).toContain('your operator denied this action');
    expect(results[0].content).toBeUndefined();
  }, 30000);

  test('a retrieval result is never re-persisted: seq and bytes hold, no ref rides the result (FR-6)', async () => {
    const connection = freshConnection({ toolMode: 'auto' });
    const ref = await persistReal(connection);
    const seqBefore = connection.toolResultSeq;
    const bytesBefore = connection.toolResultBytes;

    const results = await processToolCalls(serverWs, retrieveCall(ref), connection);

    expect(results[0].status).toBe('ok');
    expect(results[0].ref).toBeUndefined();
    expect(connection.toolResultSeq).toBe(seqBefore);
    expect(connection.toolResultBytes).toBe(bytesBefore);

    // And the on-disk lane holds exactly the one original record
    const laneFile = path.join(workspace._path(NEUMA_ID), 'tool-results', `${connection.sessionId}.jsonl`);
    const raw = await fs.readFile(laneFile, 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(1);
  }, 30000);
});
