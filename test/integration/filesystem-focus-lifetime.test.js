import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { expect, test } from 'vitest';

test('native filesystem reach follows live focus owners while explicit grants survive', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-focus-lifetime-'));
  const oldData = process.env.NEUMA_DATA_ROOT;
  process.env.NEUMA_DATA_ROOT = path.join(temp, 'data');
  const workspace = await import('../../core/workspace/neuma-workspace.js');
  const oldHouse = workspace.getWorkspacesRoot();
  const oldWitnesses = workspace.getWitnessesRoot();
  workspace.setWorkspacesRoot(path.join(temp, 'house'));
  workspace.setWitnessesRoot(path.join(temp, 'witnesses'));
  const { mcpService } = await import('../../backend/services/mcp.js');
  const { connectFilesystemServer, ensureFilesystemFocus, ensureFilesystemRoots } = await import('../../backend/services/mcp-filesystem.js');
  const { ensureFocusGroundReachable } = await import('../../backend/services/focus-ground.js');
  const { clearLaneRuntime } = await import('../../backend/routes/portal-binding-state.js');
  const files = await import('../../backend/services/user-files.js');
  const oldRoots = files.getRoots();
  let wss;
  const clients = [];
  try {
    const dirs = Object.fromEntries(['a', 'b', 'granted'].map((name) => [name, path.join(temp, name)]));
    for (const dir of Object.values(dirs)) {
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'proof.txt'), 'ordinary temporary proof');
    }
    files.setRoots(Object.values(dirs));
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(wss, 'listening');
    const owner = async (toolWorkspace) => {
      const arriving = once(wss, 'connection');
      const client = new WebSocket(`ws://127.0.0.1:${wss.address().port}`);
      clients.push(client);
      await once(client, 'open');
      const [ws] = await arriving;
      return { connection: { ws, toolWorkspace }, client };
    };
    const read = (dir) => mcpService.callTool('filesystem', 'read_file', { path: path.join(dir, 'proof.txt') });
    const allowed = async (dir) => {
      const result = await read(dir);
      expect(result.isError).not.toBe(true);
      expect(result.content.some((part) => part.text?.includes('ordinary temporary proof'))).toBe(true);
    };
    const denied = async (dir) => expect((await read(dir)).isError).toBe(true);

    await connectFilesystemServer();
    await denied(dirs.a);
    const first = await owner(dirs.a);
    const second = await owner(dirs.a);
    const third = await owner(dirs.b);
    for (const peer of [first, second, third]) await ensureFocusGroundReachable(peer.connection);
    await allowed(dirs.a);
    await allowed(dirs.b);

    files.setRoots([dirs.a, dirs.granted]); // closing the root also revokes stale focus
    await connectFilesystemServer();
    await denied(dirs.b);
    files.setRoots(Object.values(dirs));
    await ensureFocusGroundReachable(third.connection);
    await allowed(dirs.b);
    const stable = await ensureFilesystemFocus(first.connection);
    expect(await ensureFilesystemFocus(first.connection)).toBe(stable);

    clearLaneRuntime(first.connection);
    await ensureFocusGroundReachable(first.connection);
    await allowed(dirs.a); // second stream still owns this root
    clearLaneRuntime(second.connection);
    await connectFilesystemServer();
    await denied(dirs.a);
    await allowed(dirs.b);

    third.connection.toolWorkspace = dirs.a;
    await ensureFocusGroundReachable(third.connection);
    await denied(dirs.b);
    await allowed(dirs.a);
    const closed = once(third.connection.ws, 'close');
    third.client.close();
    await closed;
    await connectFilesystemServer();
    await denied(dirs.a);

    const explicit = await owner(dirs.granted);
    await ensureFocusGroundReachable(explicit.connection);
    await ensureFilesystemRoots([dirs.granted]); // already covered, but now durably granted
    clearLaneRuntime(explicit.connection);
    files.setRoots([dirs.a, dirs.b]);
    await ensureFocusGroundReachable(explicit.connection);
    await allowed(dirs.granted);
    await fs.rm(dirs.granted, { recursive: true });
    expect(await connectFilesystemServer()).not.toContain(dirs.granted);

    // Real mkdir failure, not an injected server: failure stays recoverable.
    const blockedHouse = path.join(temp, 'house-is-a-file');
    await fs.writeFile(blockedHouse, 'not a directory');
    workspace.setWorkspacesRoot(blockedHouse);
    first.connection.toolWorkspace = dirs.b;
    await expect(ensureFocusGroundReachable(first.connection)).resolves.toBeUndefined();
    await denied(dirs.b);
    workspace.setWorkspacesRoot(path.join(temp, 'house'));
    await ensureFocusGroundReachable(first.connection);
    await allowed(dirs.b);
  } finally {
    for (const client of clients) client.terminate();
    if (wss) {
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
    }
    await mcpService.disconnect('filesystem');
    workspace.setWorkspacesRoot(oldHouse);
    workspace.setWitnessesRoot(oldWitnesses);
    files.setRoots(oldRoots);
    if (oldData === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = oldData;
    await fs.rm(temp, { recursive: true, force: true });
  }
}, 30000);
