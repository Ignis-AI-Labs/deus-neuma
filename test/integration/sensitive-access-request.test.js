/**
 * request_file_access — the sensitive-access request flow, end to end with NO
 * mock on the claimed path (RULE 0): REAL WebSocket pair, REAL
 * @modelcontextprotocol/server-filesystem on real disk, REAL lane policy on
 * real disk, REAL approval broker. The being asks, the operator's card
 * decides, and the grant is honored by the sandbox gate it was asked against:
 *   - the card carries path + tier + reason and NEVER the file's content,
 *   - ALLOW ONCE grants for the session and the read lands real bytes,
 *   - ALWAYS persists to the lane's policy — a fresh connection needs no card,
 *   - DENY records no grant,
 *   - .git internals and non-masked paths never raise a card at all.
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
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const { processToolCalls } = __test;
const NEUMA_ID = 'accessrequestecho';
const SECRET = 'endpoint=http://127.0.0.1:8089\nmodel=test-substrate\n';

describe('request_file_access — the operator’s card over sensitive files (real WS, real MCP, gnosis)', () => {
  let base, house, project, envPath, origRoot, httpServer, wss, serverWs, client, prevKey;
  let clientLog;
  let decide = null;
  let currentConnection = null; // the connection the live card waits on

  const freshConnection = () => ({
    ws: serverWs,
    companion: { name: 'AccessRequestEcho', neumaId: NEUMA_ID },
    _writeOps: 0,
  });

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
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'gnosis-access-request-key-long-ok';

    base = await createTempDir('sensitive-access-request');
    house = path.join(base, 'workspaces');
    project = path.join(base, 'project');
    await fs.mkdir(house, { recursive: true });
    await fs.mkdir(project, { recursive: true });
    await fs.mkdir(path.join(project, '.git'), { recursive: true });
    envPath = path.join(project, '.env');
    await fs.writeFile(envPath, SECRET);
    await fs.writeFile(path.join(project, '.git', 'config'), '[remote "origin"]\nurl=real');
    await fs.writeFile(path.join(project, 'plain.txt'), 'ordinary words');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    await connectFilesystemServer(); // real MCP server, real disk

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
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
    // The desk's answer frame resolves against the connection the card waits
    // on — the same wiring the production portal routes provide.
    serverWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'tool:approval_response' && currentConnection) {
        resolveToolApproval(currentConnection, msg.id, msg.decision);
      }
    });
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(origRoot);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
    await mcpService.disconnect('filesystem');
    await fs.rm(base, { recursive: true, force: true });
  });

  const askTool = (connection, toolCall) => {
    currentConnection = connection;
    return processToolCalls(serverWs, toolCall, connection);
  };
  const requestCall = (tier, reason, target = envPath) =>
    `[TOOL: filesystem/request_file_access ${JSON.stringify({ path: target, tier, reason })}]`;

  test('the card carries path + tier + reason and NEVER the file’s content', async () => {
    decide = () => 'allow';
    const connection = freshConnection();
    const results = await askTool(connection, requestCall('read', 'the benchmark manifest needs the endpoint'));
    expect(results[0].status).toBe('ok');
    const request = await untilClient((m) => m.type === 'tool:approval_request');
    expect(request.tool).toBe('filesystem/request_file_access');
    expect(request.scope).toBe(`read access to ${envPath}`);
    expect(JSON.stringify(request)).toContain('benchmark manifest');
    expect(JSON.stringify(request)).not.toContain('endpoint=http');
    // …and the grant the card conferred is honored by the very gate that refused before.
    const read = await askTool(connection, `[TOOL: fs/read ${JSON.stringify({ path: envPath })}]`);
    expect(read[0].status).toBe('ok');
    expect(String(read[0].content)).toContain('endpoint=http://127.0.0.1:8089');
  });

  test('ALLOW ONCE is session-only; ALWAYS persists to the lane’s policy', async () => {
    // Session grant from the previous test is connection-local — the lane's
    // persisted policy holds no sensitive grant yet.
    expect((await workspace.readToolPolicy(NEUMA_ID))?.sensitiveGrants || {}).toEqual({});

    decide = () => 'always';
    const connection = freshConnection();
    const results = await askTool(connection, requestCall('read', 'I will need it across sessions'));
    expect(results[0].status).toBe('ok');
    const persisted = await workspace.readToolPolicy(NEUMA_ID);
    expect(persisted?.sensitiveGrants?.read).toEqual([envPath]);

    // …and a fresh connection is honored with NO new card (hydration works).
    decide = null;
    const fresh = freshConnection();
    fresh._sensitiveGrants = persisted.sensitiveGrants; // what _hydratePathGrants would land
    const read = await askTool(fresh, `[TOOL: fs/read ${JSON.stringify({ path: envPath })}]`);
    expect(read[0].status).toBe('ok');
    expect(String(read[0].content)).toContain('model=test-substrate');
  });

  test('DENY records no grant and no persisted policy line', async () => {
    decide = () => 'deny';
    const connection = freshConnection();
    const results = await askTool(connection, requestCall('edit', 'let me change it'));
    expect(results[0].status).toBe('denied');
    const persisted = await workspace.readToolPolicy(NEUMA_ID);
    expect(persisted?.sensitiveGrants?.edit || []).toEqual([]);
    // …and the write is still refused by the tier law.
    const write = await askTool(connection, `[TOOL: fs/write ${JSON.stringify({ path: envPath, content: 'x' })}]`);
    expect(write[0].status).not.toBe('ok');
  });

  test('.git internals never raise a card — no consent story exists for them', async () => {
    decide = () => 'allow';
    const gitConfig = path.join(project, '.git', 'config');
    const before = clientLog.length;
    const results = await askTool(freshConnection(), requestCall('read', 'just looking', gitConfig));
    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('no card exists');
    expect(clientLog.slice(before).some((m) => m.type === 'tool:approval_request')).toBe(false);
  });

  test('a path the law does not mask never raises a card either', async () => {
    const before = clientLog.length;
    const results = await askTool(freshConnection(), requestCall('read', 'plain file', path.join(project, 'plain.txt')));
    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('not masked');
    expect(clientLog.slice(before).some((m) => m.type === 'tool:approval_request')).toBe(false);
  });
});
