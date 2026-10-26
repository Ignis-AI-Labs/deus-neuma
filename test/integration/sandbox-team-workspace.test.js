/**
 * Team workspace confinement (#171) — REAL MCP filesystem server, REAL disk,
 * NO mock (AGENTS.md RULE 0).
 *
 * The gnosis for […]:
 * while a plan's workspace is in force on a connection, EVERY write is
 * confined to that one root — the being's own lane included — and metered
 * against the byte budget. The proof a denied write did not run is the
 * unchanged disk; the proof of an allowed one is the bytes.
 *
 * THE ACT CHANNEL (ruling, 2026-10-10): the being's OWN lane/intents/ stays
 * writable under confinement — filing an intent is how it acts, and the
 * intent sweep gates every act. A plan that took that away stalled a team's
 * sprint. Intent filings never spend the lane's 10-op cap either.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { FILESYSTEM_SERVER_SPEC } from '../helpers/mcp-fs-server-spec.js';
import { mcpService } from '../../backend/services/mcp.js';
import { createSandboxedCallTool } from '../../backend/services/tool-sandbox.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const SERVER = 'team-ws-fs';

describe('sandbox team workspace — one arena, byte-metered (gnosis, no mock)', () => {
  let house, arena, lane, origRoot;

  beforeAll(async () => {
    house = await createTempDir('team-ws-house');
    arena = await createTempDir('team-ws-arena');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create('lead-being');
    await workspace.create('other-being');
    lane = path.resolve(house, 'lead-being');
    // The real server can reach BOTH the house and the arena — the sandbox
    // (with the team workspace in force) is the only thing that confines.
    await mcpService.connectToServer(SERVER, 'npx', ['-y', FILESYSTEM_SERVER_SPEC, house, arena], {});
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    setWorkspacesRoot(origRoot);
    await mcpService.disconnect(SERVER);
  });

  const callFor = (teamWorkspace) => {
    const connection = {
      companion: { neumaId: 'lead-being' },
      _writeOps: 0,
      _teamWorkspace: teamWorkspace,
    };
    return { call: createSandboxedCallTool(mcpService, connection, workspace), connection };
  };

  test('a write INSIDE the assigned workspace lands on disk and meters bytes', async () => {
    const ws = { root: arena, budgetBytes: 1024, usedBytes: 0 };
    const { call } = callFor(ws);
    const file = path.join(arena, 'artifact.py');
    await call(SERVER, 'write_file', { path: file, content: 'print("one-shot")\n' });
    expect(await fs.readFile(file, 'utf8')).toBe('print("one-shot")\n');
    expect(ws.usedBytes).toBe(Buffer.byteLength('print("one-shot")\n'));
  });

  test('a write into the being\'s OWN LANE is refused while the workspace is in force', async () => {
    const { call } = callFor({ root: arena, budgetBytes: 1024, usedBytes: 0 });
    const laneFile = path.join(lane, 'dna', 'sneak.json');
    await expect(
      call(SERVER, 'write_file', { path: laneFile, content: '{"outside":true}' }),
    ).rejects.toThrow();
    await expect(fs.access(laneFile)).rejects.toThrow(); // nothing landed
  });

  test('a write past the byte budget is refused with the honest numbers, and nothing lands', async () => {
    const ws = { root: arena, budgetBytes: 10, usedBytes: 8 };
    const { call } = callFor(ws);
    const file = path.join(arena, 'too-big.txt');
    await expect(
      call(SERVER, 'write_file', { path: file, content: 'this is more than two bytes' }),
    ).rejects.toThrow(/8.*10|budget/i);
    await expect(fs.access(file)).rejects.toThrow();
    expect(ws.usedBytes).toBe(8); // a refused write never meters
  });

  test('reads from the being\'s own lane STAY allowed during confined work', async () => {
    const note = path.join(lane, 'context.md');
    await fs.writeFile(note, 'house context');
    const { call } = callFor({ root: arena, budgetBytes: 1024, usedBytes: 0 });
    const res = await call(SERVER, 'read_file', { path: note });
    const text = res.content?.find((c) => c.type === 'text')?.text ?? '';
    expect(text).toContain('house context');
  });

  test('the 10-op session cap does NOT throttle confined workspace writes — the byte budget governs', async () => {
    const ws = { root: arena, budgetBytes: 4096, usedBytes: 0 };
    const { call, connection } = callFor(ws);
    connection._writeOps = 10; // session cap exhausted — irrelevant in the arena
    const file = path.join(arena, 'eleventh.txt');
    await call(SERVER, 'write_file', { path: file, content: 'still writes' });
    expect(await fs.readFile(file, 'utf8')).toBe('still writes');
  });

  test('without a team workspace the old law stands — lane writes work, arena writes are refused', async () => {
    const { call } = callFor(null);
    const laneFile = path.join(lane, 'dna', 'normal.json');
    await call(SERVER, 'write_file', { path: laneFile, content: '{"ok":true}' });
    expect(JSON.parse(await fs.readFile(laneFile, 'utf8')).ok).toBe(true);
    await expect(
      call(SERVER, 'write_file', { path: path.join(arena, 'unplanned.txt'), content: 'x' }),
    ).rejects.toThrow();
  });

  test('the being\'s OWN intents/ stays writable under confinement — the act lands, metered in bytes', async () => {
    const ws = { root: arena, budgetBytes: 4096, usedBytes: 0 };
    const { call } = callFor(ws);
    const intent = path.join(lane, 'intents', 'team-run-sprint.json');
    const body = '{"type":"team/run"}';
    await call(SERVER, 'write_file', { path: intent, content: body });
    expect(await fs.readFile(intent, 'utf8')).toBe(body);
    expect(ws.usedBytes).toBe(Buffer.byteLength(body)); // the team budget still sees it
  });

  test('confinement still holds around the act channel: the rest of the lane, and ANOTHER being\'s intents/, stay refused', async () => {
    const { call } = callFor({ root: arena, budgetBytes: 4096, usedBytes: 0 });
    const notes = path.join(lane, 'notes', 'side.md');
    const foreign = path.join(house, 'other-being', 'intents', 'forged.json');
    await expect(call(SERVER, 'write_file', { path: notes, content: 'x' })).rejects.toThrow();
    await expect(call(SERVER, 'write_file', { path: foreign, content: '{}' })).rejects.toThrow();
    await expect(fs.access(notes)).rejects.toThrow();
    await expect(fs.access(foreign)).rejects.toThrow();
  });

  test('intent filings never spend the 10-op cap; other lane writes still do', async () => {
    const { call, connection } = callFor(null);
    connection._writeOps = 10; // the session cap is spent
    const intent = path.join(lane, 'intents', 'eleventh-act.json');
    await call(SERVER, 'write_file', { path: intent, content: '{"type":"task/add"}' });
    expect(await fs.readFile(intent, 'utf8')).toBe('{"type":"task/add"}');
    expect(connection._writeOps).toBe(10); // the act did not count
    await expect(
      call(SERVER, 'write_file', { path: path.join(lane, 'dna', 'eleventh.json'), content: '{}' }),
    ).rejects.toThrow(/limit/);
  });
});
