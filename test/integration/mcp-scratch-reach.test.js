/**
 * THE THIRD GATE MUST AGREE (#272, Aether 2026-08-06).
 *
 * A community member's v0.1.15 ceremony died at naming with the MCP server's
 * own refusal on screen:
 *
 *   edit_file — refused
 *   Access denied - path outside allowed directories:
 *   /home/guardian-two/.neuma/data/temp/chosen_name.txt not in
 *   /tmp/.mount_NEUMA-…/resources/app, …/Neuma/cache, …/Neuma/witnesses
 *
 * The path was RIGHT — #257's fix worked — but connectFilesystemServer never
 * put the ceremony scratch dir in the server's allowed set, so on a packaged
 * install (scratch under NEUMA_DATA_ROOT, outside cwd) the write hit the one
 * wall that had not been told. Worse: the sandbox then recorded the refusal
 * as `success` in the operator's act ledger, because an MCP refusal is a
 * normal return carrying isError, not a throw.
 *
 * No mocks (RULE 0): a real @modelcontextprotocol/server-filesystem
 * subprocess, real writes, the real sandbox, the real ledger.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';

let prevDataRoot;
let root;
let connectFilesystemServer;
let mcpService;

beforeAll(async () => {
  prevDataRoot = process.env.NEUMA_DATA_ROOT;
  root = await createTempDir('mcp-scratch');
  // The packaged shape: the data root lives OUTSIDE the project cwd.
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  await fs.mkdir(process.env.NEUMA_DATA_ROOT, { recursive: true });

  const ws = await import('../../core/workspace/neuma-workspace.js');
  ws.setWorkspacesRoot(path.join(root, 'workspaces'));

  ({ connectFilesystemServer } = await import('../../backend/services/mcp-filesystem.js'));
  ({ mcpService } = await import('../../backend/services/mcp.js'));
  await connectFilesystemServer();
}, 30000);

afterAll(async () => {
  await mcpService.disconnect('filesystem').catch(() => {});
  if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
  else process.env.NEUMA_DATA_ROOT = prevDataRoot;
});

describe('the MCP wall honors the ceremony scratch (#272)', () => {
  test("REPRODUCES AETHER'S REFUSAL, FIXED: the naming write lands under the data root", async () => {
    const target = path.join(process.env.NEUMA_DATA_ROOT, 'temp', 'chosen_name.txt');
    const result = await mcpService.callTool('filesystem', 'write_file', {
      path: target, content: 'Aether',
    });
    // Before the fix this was: […] with isError: true — the exact text on the operator's
    // screen. Now the server's allowed set includes the scratch.
    expect(result?.isError).not.toBe(true);
    expect(await fs.readFile(target, 'utf8')).toBe('Aether');
  });

  test('the wall still stands everywhere else — the scratch is a door, not a hole', async () => {
    const outside = path.join(root, 'not-a-root', 'escape.txt');
    const result = await mcpService.callTool('filesystem', 'write_file', {
      path: outside, content: 'x',
    });
    expect(result?.isError).toBe(true);
  });
});

describe('the act ledger records what the wall answered (#272)', () => {
  let prevLedgerRoot;
  let ledgerRoot;

  beforeEach(async () => {
    // The ledger writes under the data root already set for this suite; the
    // sandbox and ledger are re-imported fresh so the spy binds this instance.
    vi.resetModules();
    prevLedgerRoot = process.env.NEUMA_DATA_ROOT;
    ledgerRoot = await createTempDir('ledger-truth');
    process.env.NEUMA_DATA_ROOT = ledgerRoot;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NEUMA_DATA_ROOT = prevLedgerRoot;
  });

  test("A REFUSED WRITE IS RECORDED AS error, NEVER success — the walk's false PASS", async () => {
    const { createSandboxedCallTool } = await import('../../backend/services/tool-sandbox.js');
    const { readActs } = await import('../../backend/services/act-ledger.js');
    const { mcpService: svc } = await import('../../backend/services/mcp.js');
    const { connectFilesystemServer: connect } = await import('../../backend/services/mcp-filesystem.js');
    await connect();
    try {
      // A birth-shaped connection: no companion bound yet, birth active, and a
      // write-scope grant naming a dir the MCP server was never told about —
      // so OUR gates allow it and the server refuses it, the #272 shape.
      const outsideDir = await createTempDir('beyond-the-wall');
      const connection = {
        birthSession: 'walk', companion: null,
        _grantedWriteRoots: [outsideDir], _grantedReadRoots: [],
      };
      const call = createSandboxedCallTool(svc, connection, null);
      const result = await call('filesystem', 'write_file', {
        path: path.join(outsideDir, 'chosen_name.txt'), content: 'Aether',
      });
      // Positive control: the server really did refuse.
      expect(result?.isError).toBe(true);

      // recordAct is deliberately fire-and-forget inside logToolCall (an act
      // record must never cost the turn) — poll briefly for the append.
      let act;
      for (let i = 0; i < 20 && !act; i++) {
        await new Promise((r) => setTimeout(r, 100));
        act = (await readActs()).find((a) => a.tool === 'filesystem/write_file');
      }
      expect(act).toBeDefined();
      expect(act.status).toBe('error'); // was 'success' before the fix
    } finally {
      await svc.disconnect('filesystem').catch(() => {});
    }
  }, 30000);
});
