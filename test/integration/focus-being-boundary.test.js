/**
 * Being-boundary regression — SECURITY_ANALYSIS scenario 5, threat T2 (run
 * explorer-window-focus-k37s, Wave 4). THE regression test for the law that
 * a desk window's FOCUS is a witness-plane lens and NEVER a grant surface:
 * a bare-folder focus stamps NO project space onto the connection (D7/D8),
 * so nothing about the focus itself ever widens the being's sandbox.
 *
 * The law evolved (Design note, 2026-07-23, universal approval): a write outside the
 * lane is no longer a silent wall — the being may ASK, and the witness's
 * card is the ONE grant surface. T2 stays guarded in its real shape: the
 * focus grants nothing by itself, no grant materializes without the
 * witness's yes, and her no lands as a real deny in the being's journal.
 *
 * Real on every claimed layer (RULE 0): REAL WebSocket pair, REAL
 * @modelcontextprotocol/server-filesystem, REAL NeumaWorkspace + journal on
 * disk, REAL explorer roots module, REAL sandbox cascade. No mock anywhere.
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
import { setRoots, getRoots } from '../../backend/services/user-files.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { createProject } from '../../backend/services/user-projects.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const { processToolCalls } = __test;
const NEUMA_ID = 'focusbound';
const WALLET = '0x2222222222222222222222222222222222222222';

describe('focus is never a grant surface (bare-folder focus ⇒ hard deny, no prompt — T2 regression)', () => {
  let house, origRoot, origExplorerRoots, httpServer, wss, serverWs, client, port;
  let clientLog, decide, focusedFolder;

  beforeAll(async () => {
    house = await createTempDir('focus-bound-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    setRealmRoot(await createTempDir('focus-bound-realm'));

    // The witness's window focuses this BARE folder — and it is a really-open
    // Explorer FILES root, exactly the surface T2 fears would leak into the
    // being's sandbox. (Focus itself is client-held and stamps NOTHING onto
    // the connection under bare-folder focus — D7/D8 — so the connection
    // below carries no project space, which IS the desk's real wire shape.)
    focusedFolder = await createTempDir('focus-bound-folder');
    origExplorerRoots = getRoots();
    setRoots([...origExplorerRoots, focusedFolder]);

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
    setRoots(origExplorerRoots);
    setWorkspacesRoot(origRoot);
    await mcpService.disconnect('filesystem');
    await fs.rm(house, { recursive: true, force: true });
  });

  test('bare-folder focus: the write ASKS the witness — focus grants NOTHING by itself; her no lands as a real deny', async () => {
    // A general-space connection — exactly what a bare-folder-focused desk
    // binds (focusSpaceFrame stamps nothing; no project space ever set).
    const connection = {
      ws: serverWs,
      companion: { name: 'FocusBound', neumaId: NEUMA_ID },
      walletAddress: WALLET,
      _writeOps: 0,
    };
    serverWs.on('message', async (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'tool:approval_response') {
        const { resolveToolApproval } = await import('../../backend/services/tool-approval.js');
        resolveToolApproval(connection, m.id, m.decision);
      }
    });
    clientLog.length = 0;
    let prompted = false;
    decide = () => { prompted = true; return 'deny'; };

    const target = path.join(focusedFolder, 'leak.txt');
    const results = await processToolCalls(
      serverWs,
      `[TOOL: fs/write {"path": "${target}", "content": "should never land"}]`,
      connection,
    );

    // The universal-approval law: the being may ASK on every level — the
    // witness's card is offered, and HER answer is the only door.
    expect(prompted).toBe(true);
    expect(results[0].status).toBe('denied');
    // Nothing landed on the real disk.
    const landed = await fs.stat(target).then(() => true).catch(() => false);
    expect(landed).toBe(false);
    // T2's actual teeth: the FOCUS materialized no grant — only an explicit
    // witness yes ever could, and she said no.
    expect(connection._grantedWriteRoots || []).not.toContain(focusedFolder);
    // The deny is on the record — the being's real append-only journal
    // (read through the workspace, which owns the at-rest encoding).
    const journal = await workspace.readJournal(NEUMA_ID);
    const deny = journal.find((e) =>
      e.type === 'tool_call' && e.metadata?.tool === 'write' && e.metadata?.status === 'denied');
    expect(deny).toBeTruthy();
  }, 45000);

  test('project space (the positive control): the same write PROMPTS — the envelope, not the focus, is the grant surface', async () => {
    const projectFolder = await createTempDir('focus-bound-project');
    const project = await createProject(WALLET, { name: 'FB', folder: projectFolder });
    const connection = {
      ws: serverWs,
      companion: { name: 'FocusBound', neumaId: NEUMA_ID },
      walletAddress: WALLET,
      space: { id: project.id, kind: 'project', label: 'FB' },
      _writeOps: 0,
    };
    serverWs.on('message', async (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'tool:approval_response') {
        const { resolveToolApproval } = await import('../../backend/services/tool-approval.js');
        resolveToolApproval(connection, m.id, m.decision);
      }
    });
    clientLog.length = 0;
    let prompted = false;
    decide = () => { prompted = true; return 'deny'; };

    const results = await processToolCalls(
      serverWs,
      `[TOOL: fs/write {"path": "${path.join(projectFolder, 'ok.txt')}", "content": "x"}]`,
      connection,
    );

    expect(prompted).toBe(true);
    expect(results[0].status).toBe('denied');
  }, 45000);
});
