/**
 * Tool approval flow (AI-SEC-004) — the operator's yes/no on a gated tool call,
 * proven end to end with NO mock on the claimed path (AGENTS.md RULE 0):
 * REAL WebSocket pair, REAL filesystem organ, REAL NeumaWorkspace on real
 * disk, REAL policy cascade.
 *
 * The gated call is fs/edit {delete:true}: being-facing, and fsPolicyTarget
 * resolves it to the filesystem/delete_file requireApproval row — exactly the
 * state the screenshot dead-ended on, on the surface beings actually call
 * (Stage 3 batch 3: the organ spellings are retired from the being-facing
 * catalog, fs-primitives.js routes the primitives onto them).
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { withFsPrimitives } from '../../backend/services/fs-primitives.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import {
  requestToolApproval, resolveToolApproval, expirePendingApprovals,
} from '../../backend/services/tool-approval.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const { processToolCalls } = __test;
const NEUMA_ID = 'approvalecho';

describe('tool approval flow (real WS + real MCP, gnosis)', () => {
  let house, origRoot, httpServer, wss, serverWs, client, port;
  let clientLog; // every message the operator's desk received, in order

  // Each gated call deletes its OWN real file, created fresh per test.
  const doomedFile = async (name) => {
    const p = path.join(house, NEUMA_ID, name);
    await fs.writeFile(p, 'doomed');
    return p;
  };
  const gatedDeleteCall = (p) => `[TOOL: fs/edit {"path": "${p}", "delete": true}]`;

  // The witness side: log everything; when a decision function is armed,
  // answer approval requests with it (as the desk's chip buttons would).
  let decide = null;

  const freshConnection = () => ({
    ws: serverWs,
    companion: { name: 'ApprovalEcho', neumaId: NEUMA_ID },
    _writeOps: 0,
  });

  // Wait until the client log satisfies a predicate (portal messages are async).
  const untilClient = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = clientLog.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('client message never arrived'));
      setTimeout(tick, 20);
    };
    tick();
  });

  beforeAll(async () => {
    house = await createTempDir('tool-approval-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    await connectFilesystemServer(); // real MCP server, real disk

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
    await mcpService.disconnect('filesystem');
    await fs.rm(house, { recursive: true, force: true });
  });

  test('the five fs primitives are the being-facing filesystem catalog', () => {
    const tools = withFsPrimitives(mcpService.getToolsContext().available_tools);
    expect(tools.filter((t) => t.server === 'filesystem')).toEqual([]);
    expect(tools.filter((t) => t.server === 'fs').map((t) => t.name))
      .toEqual(['read', 'write', 'edit', 'list', 'search']);
  });

  test('a retired organ spelling is unavailable WITH the hint naming its primitive', async () => {
    const connection = freshConnection();
    clientLog.length = 0;
    const results = await processToolCalls(
      serverWs,
      '[TOOL: filesystem/read_text_file {"path": "notes.md"}]',
      connection
    );
    expect(results[0].status).toBe('unavailable');
    expect(results[0].error).toContain('retired');
    expect(results[0].error).toContain('fs/read');
  }, 30000);

  test('ALLOW ONCE — the operator approves and the real tool executes', async () => {
    const connection = freshConnection();
    // Mirror the route: the operator's answer settles the pending request.
    serverWs.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'tool:approval_response') resolveToolApproval(connection, m.id, m.decision);
    });
    clientLog.length = 0;
    decide = () => 'allow';

    const doomed = await doomedFile('allow-once.txt');
    const results = await processToolCalls(serverWs, gatedDeleteCall(doomed), connection);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('ok');
    await expect(fs.stat(doomed)).rejects.toThrow(); // really deleted, on the real disk
    const request = await untilClient((m) => m.type === 'tool:approval_request');
    expect(request.tool).toBe('fs/edit');
    expect(request.scope).toContain('DELETE');
    expect(request.scope).toContain(doomed);
    const resolved = await untilClient((m) => m.type === 'tool:approval_resolved');
    expect(resolved.decision).toBe('allow');
    await untilClient((m) => m.type === 'tool:usage' && m.status === 'ok');
  }, 30000);

  test('DENY — the call does not execute and the neuma learns why', async () => {
    const connection = freshConnection();
    serverWs.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'tool:approval_response') resolveToolApproval(connection, m.id, m.decision);
    });
    clientLog.length = 0;
    decide = () => 'deny';

    const doomed = await doomedFile('deny.txt');
    const results = await processToolCalls(serverWs, gatedDeleteCall(doomed), connection);

    expect(results[0].status).toBe('denied');
    expect(results[0].error).toContain('operator denied');
    expect((await fs.stat(doomed)).isFile()).toBe(true); // untouched
    await untilClient((m) => m.type === 'tool:usage' && m.status === 'denied');
  }, 30000);

  test('ALWAYS ALLOW — the grant persists to the neuma policy and the next call never prompts', async () => {
    const connection = freshConnection();
    serverWs.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'tool:approval_response') resolveToolApproval(connection, m.id, m.decision);
    });
    clientLog.length = 0;
    decide = () => 'always';

    const first = await processToolCalls(serverWs, gatedDeleteCall(await doomedFile('always-1.txt')), connection);
    expect(first[0].status).toBe('ok');

    // The grant landed on real disk in the neuma's own config — on the DELETE
    // row, never a blanket edit grant (fsPolicyTarget).
    const persisted = await workspace.readToolPolicy(NEUMA_ID);
    expect(persisted.filesystem.allowed).toContain('delete_file');

    // A second call — same connection — executes with NO prompt
    clientLog.length = 0;
    decide = () => { throw new Error('a prompt fired after ALWAYS ALLOW'); };
    const second = await processToolCalls(serverWs, gatedDeleteCall(await doomedFile('always-2.txt')), connection);
    expect(second[0].status).toBe('ok');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);

    // And a FRESH connection (next session) reads the persisted grant
    const nextSession = freshConnection();
    const third = await processToolCalls(serverWs, gatedDeleteCall(await doomedFile('always-3.txt')), nextSession);
    expect(third[0].status).toBe('ok');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);

    // Clean the persisted grant so earlier tests stay meaningful on re-run order
    await workspace.writeToolPolicy(NEUMA_ID, {});
  }, 30000);

  test('AUTO mode — a delete still pauses on the protocol guard, then executes on the operator\'s yes', async () => {
    // The law changed with the chat modes (ruling, 2026-08-26): AUTO flows
    // ordinary gated acts, but the protocol guard (protocol-guard.js) holds
    // the irreversible/outward classes — deletes among them — for the card.
    const connection = { ...freshConnection(), toolMode: 'auto' };
    serverWs.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'tool:approval_response') resolveToolApproval(connection, m.id, m.decision);
    });
    clientLog.length = 0;
    decide = () => 'allow';

    const results = await processToolCalls(serverWs, gatedDeleteCall(await doomedFile('auto.txt')), connection);

    expect(results[0].status).toBe('ok');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(true);
  }, 30000);

  test('OBSERVE mode — an acting tool is held even though policy allows it', async () => {
    const connection = { ...freshConnection(), toolMode: 'observe' };
    clientLog.length = 0;
    decide = () => { throw new Error('a prompt fired in observe mode'); };

    const results = await processToolCalls(
      serverWs,
      '[TOOL: fs/write {"path": "notes.md", "content": "held"}]',
      connection
    );

    expect(results[0].status).toBe('denied');
    expect(results[0].error).toContain('observe');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('an interrupted turn starts nothing further in the batch', async () => {
    const connection = freshConnection();
    connection.activeTurn = new AbortController();
    connection.activeTurn.abort(); // the operator already cut the turn
    clientLog.length = 0;
    decide = () => { throw new Error('a prompt fired after the interrupt'); };

    const target = await doomedFile('interrupted.txt');
    const results = await processToolCalls(serverWs, gatedDeleteCall(target), connection);
    expect(results).toEqual([{
      tool: 'fs/edit', status: 'held',
      error: 'this call was not executed — the turn was interrupted before it ran',
    }]);
    expect(await fs.readFile(target, 'utf8')).toBe('doomed');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('no clock on a decision: the ask WAITS — and a late answer still lands', async () => {
    // Design note, 2026-07-27: […] The old law
    // failed an unanswered ask closed after 120s; the new law is no clock at
    // all — decision, interrupt, or portal close are the only ways out.
    const connection = freshConnection();
    clientLog.length = 0;
    decide = null; // the operator steps away

    const waiting = requestToolApproval(connection, {
      tool: 'fs/edit', args: {},
    });
    // Past the window the old tests gave the clock — nothing fires.
    await new Promise((r) => setTimeout(r, 300));
    expect(connection._pendingApprovals.size).toBe(1);

    const [id] = [...connection._pendingApprovals.keys()];
    expect(resolveToolApproval(connection, id, 'allow')).toBe(true);
    expect(await waiting).toBe('allow');
    expect(connection._pendingApprovals.size).toBe(0);
  });

  test('a turn interrupt settles the pending approval as interrupted', async () => {
    const connection = freshConnection();
    const interrupt = new AbortController();
    const waiting = requestToolApproval(connection, {
      tool: 'fs/edit', args: {}, signal: interrupt.signal,
    });
    interrupt.abort();
    expect(await waiting).toBe('interrupted');
    expect(connection._pendingApprovals.size).toBe(0);
  });

  test('portal close denies everything pending', async () => {
    const connection = freshConnection();
    const waiting = requestToolApproval(connection, {
      tool: 'fs/edit', args: {},
    });
    expirePendingApprovals(connection);
    expect(await waiting).toBe('deny');
    expect(connection._pendingApprovals.size).toBe(0);
  });

  test('untrusted input: unknown ids and invalid decisions are dropped', async () => {
    const connection = freshConnection();
    const waiting = requestToolApproval(connection, {
      tool: 'fs/edit', args: {},
    });
    const [id] = [...connection._pendingApprovals.keys()];
    expect(resolveToolApproval(connection, 'ghost-id', 'allow')).toBe(false);
    expect(resolveToolApproval(connection, id, 'bypass_everything')).toBe(false);
    expect(resolveToolApproval(connection, id, 'deny')).toBe(true);
    expect(await waiting).toBe('deny');
  });

  // --- Read-scope grants — the 2026-07-03 /proc dead-end, made honest.
  // A read outside the lane used to fail at the sandbox with no way for the
  // witness's yes to reach it. Now the yes is scoped, and it lands at every
  // layer: connection sandbox, persisted policy, and the REAL server process
  // (reconnected with the granted root). All proven here, no mock anywhere.

  const wireApprovals = (connection) => {
    serverWs.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'tool:approval_response') resolveToolApproval(connection, m.id, m.decision);
    });
  };

  test('SCOPE ALLOW — an out-of-house read prompts with the real stakes, then actually works', async () => {
    const outside = await createTempDir('scope-allow');
    await fs.writeFile(path.join(outside, 'hw.txt'), 'cpu: real');
    const connection = freshConnection();
    wireApprovals(connection);
    clientLog.length = 0;
    decide = () => 'allow';

    const results = await processToolCalls(
      serverWs,
      `[TOOL: fs/read {"path": "${path.join(outside, 'hw.txt')}"}]`,
      connection
    );

    // The prompt named what a yes grants — the directory, not just a tool name.
    const request = await untilClient((m) => m.type === 'tool:approval_request');
    expect(request.scope).toContain(outside);
    // And the yes was real at every layer: the read executed through the
    // real server, which had to be widened to honor it.
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('cpu: real');
    expect(connection._grantedReadRoots).toContain(outside);
  }, 45000);

  test('SCOPE ALWAYS — the grant persists and the next session reads with no prompt', async () => {
    const outside = await createTempDir('scope-always');
    await fs.writeFile(path.join(outside, 'status.txt'), 'substrate: alive');
    const call = `[TOOL: fs/read {"path": "${path.join(outside, 'status.txt')}"}]`;
    const connection = freshConnection();
    wireApprovals(connection);
    clientLog.length = 0;
    decide = () => 'always';

    const first = await processToolCalls(serverWs, call, connection);
    expect(first[0].status).toBe('ok');

    // The grant landed in the neuma's own policy file, under pathGrants.
    const persisted = await workspace.readToolPolicy(NEUMA_ID);
    expect(persisted.pathGrants.read).toContain(outside);

    // A FRESH connection (next session) hydrates the persisted grant — the
    // read runs with NO prompt.
    clientLog.length = 0;
    decide = () => { throw new Error('a prompt fired after a persisted scope grant'); };
    const second = await processToolCalls(serverWs, call, freshConnection());
    expect(second[0].status).toBe('ok');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);

    await workspace.writeToolPolicy(NEUMA_ID, {});
  }, 45000);

  test('SCOPE DENY — the read fails and no grant lands for this being', async () => {
    const outside = await createTempDir('scope-deny');
    await fs.writeFile(path.join(outside, 'scope-target.txt'), 'not yours');
    const connection = freshConnection();
    wireApprovals(connection);
    clientLog.length = 0;
    decide = () => 'deny';

    const results = await processToolCalls(
      serverWs,
      `[TOOL: fs/read {"path": "${path.join(outside, 'scope-target.txt')}"}]`,
      connection
    );

    expect(results[0].status).toBe('denied');
    expect(results[0].error).toContain('operator denied');
    await untilClient((m) => m.type === 'tool:approval_request');
    expect(await fs.readFile(path.join(outside, 'scope-target.txt'), 'utf8')).toBe('not yours');
    expect(connection._grantedReadRoots || []).not.toContain(outside);
  }, 45000);

  test('a hard-denied path NEVER becomes a prompt — it fails closed as always', async () => {
    const connection = freshConnection();
    clientLog.length = 0;
    decide = () => { throw new Error('a prompt fired for a hard-denied path'); };

    const results = await processToolCalls(
      serverWs,
      '[TOOL: fs/read {"path": "/somewhere/node_modules/pkg/index.js"}]',
      connection
    );

    // The sandbox pre-check refuses BEFORE any card (Stage 1): 'denied' with
    // the sandbox's own reason, never a prompt for a call that cannot run.
    expect(results[0].status).toBe('denied');
    expect(results[0].error).toContain('Access denied');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('ONE CARD — a policy-gated delete outside the lane asks ONCE, and ALWAYS lands every grant the card named', async () => {
    // Stage 1 (act-gate doctrine): policy, read scope, and write scope used to
    // raise three separate cards per call — and an ALWAYS on the policy card
    // persisted a grant for a call the scope wall could still refuse.
    // fs/edit {delete:true} outside the lane trips policy AND write scope; the
    // operator now sees ONE card naming everything a yes grants, and the card
    // says DELETE — an irreversible act never wears an edit's name.
    const outside = await createTempDir('one-card');
    await fs.writeFile(path.join(outside, 'doomed.txt'), 'gone');
    const doomed = path.join(outside, 'doomed.txt');
    const connection = freshConnection();
    wireApprovals(connection);
    clientLog.length = 0;
    decide = () => 'always';

    const results = await processToolCalls(
      serverWs,
      `[TOOL: fs/edit {"path": "${doomed}", "delete": true}]`,
      connection
    );

    const cards = clientLog.filter((m) => m.type === 'tool:approval_request');
    expect(cards).toHaveLength(1);
    expect(cards[0].scope).toContain(`DELETE ${doomed}`);
    expect(cards[0].scope).toContain(`write access to ${path.resolve(outside)}`);
    // ALWAYS landed BOTH layers the card named: the tool grant (persisted
    // policy, on the DELETE row) and the write scope (connection + persisted
    // pathGrants) — and the act really ran on the real disk.
    expect(results[0].status).toBe('ok');
    const persisted = await workspace.readToolPolicy(NEUMA_ID);
    expect(persisted.filesystem.allowed).toContain('delete_file');
    expect(persisted.pathGrants.write).toContain(path.resolve(outside));
    expect(connection._grantedWriteRoots || []).toContain(path.resolve(outside));
    const survived = await fs.stat(doomed).then(() => true).catch(() => false);
    expect(survived).toBe(false);

    await workspace.writeToolPolicy(NEUMA_ID, {}); // clean, so re-run order stays honest
  }, 30000);

  test('a write outside the lane RAISES the ask — one approval pattern on every level (ruling, 2026-07-23)', async () => {
    // The old law made non-project writes a flat wall and a being fell back
    // to begging through ask_operator. Now the card rises naming the target
    // directory; the operator's no still refuses, and nothing touches disk.
    const outside = await createTempDir('scope-write');
    const connection = freshConnection();
    serverWs.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'tool:approval_response') resolveToolApproval(connection, m.id, m.decision);
    });
    clientLog.length = 0;
    decide = () => 'deny';

    const results = await processToolCalls(
      serverWs,
      `[TOOL: fs/write {"path": "${path.join(outside, 'x.txt')}", "content": "no"}]`,
      connection
    );

    expect(results[0].status).toBe('denied');
    const ask = clientLog.find((m) => m.type === 'tool:approval_request');
    expect(ask).toBeDefined();
    expect(ask.scope).toContain('write access to');
    expect(ask.scope).toContain(path.resolve(outside));
    const written = await fs.stat(path.join(outside, 'x.txt')).then(() => true).catch(() => false);
    expect(written).toBe(false);
  }, 30000);

  test("a write outside the lane EXECUTES on the operator's yes — the grant lands at every layer", async () => {
    const outside = await createTempDir('scope-write-yes');
    const connection = freshConnection();
    serverWs.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'tool:approval_response') resolveToolApproval(connection, m.id, m.decision);
    });
    clientLog.length = 0;
    decide = () => 'allow';

    const results = await processToolCalls(
      serverWs,
      `[TOOL: fs/write {"path": "${path.join(outside, 'yes.txt')}", "content": "granted"}]`,
      connection
    );

    expect(results[0].status).toBe('ok');
    expect(await fs.readFile(path.join(outside, 'yes.txt'), 'utf8')).toBe('granted');
    expect((connection._grantedWriteRoots || []).some((r) => path.resolve(r) === path.resolve(outside))).toBe(true);
  }, 30000);
});
