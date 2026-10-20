/**
 * Write-scope gate (Unit 2) — the witness's yes on a neuma WRITE that reaches
 * into the active project's folder, proven end to end with NO mock on the
 * claimed path (AGENTS.md RULE 0): REAL WebSocket pair, REAL
 * @modelcontextprotocol/server-filesystem, REAL NeumaWorkspace + realm on disk,
 * REAL policy cascade + project store.
 *
 * This is the gnosis for […] A write into an active-project folder
 * prompts with the folder as the stakes; a yes lands at every layer (connection
 * sandbox, persisted policy, the real server process, reconnected with the
 * root) and the bytes appear on disk. A write OUTSIDE the project's folders
 * ASKS too (Design note, 2026-07-23, universal approval: […]) — the WITNESS is the blast-radius bound,
 * and only her yes ever widens a wall.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { mcpService } from '../../backend/services/mcp.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { createProject } from '../../backend/services/user-projects.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const { processToolCalls } = __test;
const NEUMA_ID = 'writegate';
const WALLET = '0x1111111111111111111111111111111111111111';

describe('write-scope gate (real WS + real MCP + real project, gnosis)', () => {
  let house, origRoot, httpServer, wss, serverWs, client, port, project, projectId;
  let clientLog, decide;

  const freshConnection = () => ({
    ws: serverWs,
    companion: { name: 'WriteGate', neumaId: NEUMA_ID },
    walletAddress: WALLET,
    space: { id: projectId, kind: 'project', label: 'P' },
    _writeOps: 0,
  });

  const wireApprovals = (connection) => {
    serverWs.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'tool:approval_response') resolveToolApproval(connection, m.id, m.decision);
    });
  };

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
    house = await createTempDir('write-gate-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);

    setRealmRoot(await createTempDir('write-gate-realm'));
    project = await createTempDir('write-gate-project');
    await fs.mkdir(path.join(project, '.git'), { recursive: true }); // a repo, to prove denylist holds
    projectId = (await createProject(WALLET, { name: 'P', folder: project })).id;

    await connectFilesystemServer(); // real MCP server, real disk

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => wss.on('connection', (ws) => { serverWs = ws; resolve(); }));
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

  const writeCall = (file, content) =>
    `[TOOL: fs/write {"path": "${path.join(project, file)}", "content": "${content}"}]`;

  test('WRITE ALLOW — a write into the active project folder prompts, then lands on real disk', async () => {
    const connection = freshConnection();
    wireApprovals(connection);
    clientLog.length = 0;
    decide = () => 'allow';

    const results = await processToolCalls(serverWs, writeCall('main.js', 'export const ok = 1;'), connection);

    // The prompt named the FOLDER as the stakes — write access, not a tool name.
    const request = await untilClient((m) => m.type === 'tool:approval_request');
    expect(request.scope).toContain('write access to');
    expect(request.scope).toContain(project);
    // The yes was real at every layer: it executed through the real server,
    // widened to honor the grant, and the bytes are on disk.
    expect(results[0].status).toBe('ok');
    expect(await fs.readFile(path.join(project, 'main.js'), 'utf8')).toContain('export const ok = 1;');
    expect(connection._grantedWriteRoots).toContain(project);
  }, 45000);

  test('WRITE ALWAYS — the grant persists (pathGrants.write) and the next session writes with no prompt', async () => {
    const connection = freshConnection();
    wireApprovals(connection);
    clientLog.length = 0;
    decide = () => 'always';

    const first = await processToolCalls(serverWs, writeCall('always.js', 'a'), connection);
    expect(first[0].status).toBe('ok');

    const persisted = await workspace.readToolPolicy(NEUMA_ID);
    expect(persisted.pathGrants.write).toContain(project);

    // A FRESH connection (next session) hydrates the persisted grant — writes
    // with NO prompt.
    clientLog.length = 0;
    decide = () => { throw new Error('a prompt fired after a persisted write grant'); };
    const second = await processToolCalls(serverWs, writeCall('always2.js', 'b'), freshConnection());
    expect(second[0].status).toBe('ok');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
    expect(await fs.readFile(path.join(project, 'always2.js'), 'utf8')).toBe('b');

    await workspace.writeToolPolicy(NEUMA_ID, {});
  }, 45000);

  test('WRITE DENY — the write fails, nothing lands, and no grant is recorded', async () => {
    const connection = freshConnection();
    wireApprovals(connection);
    clientLog.length = 0;
    decide = () => 'deny';

    const results = await processToolCalls(serverWs, writeCall('denied.js', 'x'), connection);

    expect(results[0].status).toBe('denied');
    expect(results[0].error).toContain('operator denied');
    expect(connection._grantedWriteRoots || []).not.toContain(project);
    const landed = await fs.stat(path.join(project, 'denied.js')).then(() => true).catch(() => false);
    expect(landed).toBe(false);
  }, 45000);

  test('a write OUTSIDE the project folders ASKS — the witness, not the envelope, is the bound', async () => {
    // The universal-approval law (ruling, 2026-07-23): the being may request
    // access on every level; the witness's card is the one grant surface.
    // Her NO is the wall — nothing lands, no grant materializes.
    const outside = await createTempDir('write-gate-outside');
    const connection = freshConnection();
    wireApprovals(connection);
    clientLog.length = 0;
    let prompted = false;
    decide = () => { prompted = true; return 'deny'; };

    const results = await processToolCalls(
      serverWs,
      `[TOOL: fs/write {"path": "${path.join(outside, 'x.txt')}", "content": "no"}]`,
      connection,
    );

    expect(prompted).toBe(true);
    const request = clientLog.find((m) => m.type === 'tool:approval_request');
    expect(request.scope).toContain(outside); // the stakes name the REAL folder
    expect(results[0].status).toBe('denied');
    expect(connection._grantedWriteRoots || []).not.toContain(outside);
    const landed = await fs.stat(path.join(outside, 'x.txt')).then(() => true).catch(() => false);
    expect(landed).toBe(false);
  }, 45000);

  test('AUTO mode still PROMPTS for a write grant — creating write reach is never silent', async () => {
    const connection = { ...freshConnection(), toolMode: 'auto' };
    wireApprovals(connection);
    clientLog.length = 0;
    let prompted = false;
    decide = () => { prompted = true; return 'allow'; };

    const results = await processToolCalls(serverWs, writeCall('auto.js', 'x'), connection);

    expect(prompted).toBe(true); // auto did NOT skip the write-scope prompt
    expect(results[0].status).toBe('ok');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(true);
  }, 45000);

  test('.git inside the granted project folder stays hard-denied — never a prompt', async () => {
    const connection = freshConnection();
    connection._grantedWriteRoots = [project]; // already granted the folder
    clientLog.length = 0;
    decide = () => { throw new Error('a prompt fired for a denylisted path inside a granted folder'); };

    const results = await processToolCalls(
      serverWs,
      `[TOOL: fs/write {"path": "${path.join(project, '.git', 'config')}", "content": "evil"}]`,
      connection,
    );

    // The sandbox pre-check refuses BEFORE any card (Stage 1): 'denied' with
    // the sandbox's own reason — the sandbox wall itself is unchanged.
    expect(results[0].status).toBe('denied');
    expect(results[0].error).toContain('Access denied');
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);
});
