/**
 * THE ONE ARGUMENT CHECK through the REAL being loop (real dispatch, the real
 * filesystem server, a stamped turn catalog) — no mocks (RULE 0). A call that
 * does not fit its schema is refused before any handler with what to write
 * instead; a call in another harness's spelling runs as meant.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { processToolCalls } from '../../backend/services/portal-tool-loop.js';
import { stashBeingTurnCatalog } from '../../backend/services/being-tool-surface.js';
import { withFsPrimitives } from '../../backend/services/fs-primitives.js';

let kit;
let file;
const fsCall = (toolName, args) => ({ server: 'fs', toolName, tool: `fs/${toolName}`, args });

describe('the one argument check in the real loop', () => {
  beforeEach(async () => {
    kit = await createHarnessTurnKit();
    await connectFilesystemServer();
    await stashBeingTurnCatalog(kit.connection, withFsPrimitives([]), []);
    file = path.join(workspace.pathFor(kit.laneId), 'thumbnail-notes.md');
    await fs.writeFile(file, 'title: draft one\n');
  });

  afterEach(async () => { await kit?.close(); });

  test('fs/edit with {old, new} is refused before the hand, names the right fields, and writes nothing', async () => {
    kit.connection._benchmarkControls = {};
    const [result] = await processToolCalls(kit.ws, '', kit.connection, [fsCall('edit', { path: file, edits: [{ old: 'draft one', new: 'final' }] })]);
    expect(result.status).toBe('invalid');
    expect(result.tool).toBe('fs/edit');
    expect(result.error).toContain('edits[0].old is not a field — did you mean edits[0].oldText?');
    expect(result.error).toContain('edits[0].new is not a field — did you mean edits[0].newText?');
    expect(await fs.readFile(file, 'utf8')).toBe('title: draft one\n');
    // the receipt keeps why, and the names the model wrote
    expect(kit.connection._benchmarkToolTrail).toEqual([expect.objectContaining({
      tool: 'fs/edit', status: 'invalid', argKeys: ['path', 'edits'], message: expect.stringContaining('did you mean edits[0].oldText?'),
    })]);
  });

  test('fs/edit in another harness\'s spelling ({old_string, new_string}) runs as meant', async () => {
    // The edit hand reads only oldText/newText: without the check this call heard "empty oldText".
    kit.connection.toolMode = 'auto';
    const [result] = await processToolCalls(kit.ws, '', kit.connection, [fsCall('edit', { path: file, edits: [{ old_string: 'draft one', new_string: 'final' }] })]);
    expect(result.status, JSON.stringify(result)).toBe('ok');
    expect(await fs.readFile(file, 'utf8')).toBe('title: final\n');
  });

  test('fs/read in another harness\'s spelling ({file_path}) runs as meant', async () => {
    const [result] = await processToolCalls(kit.ws, '', kit.connection, [fsCall('read', { file_path: file })]);
    expect(result.status, JSON.stringify(result)).toBe('ok');
    expect(result.content).toContain('title: draft one');
  });

  test('a call that already fits runs exactly as before', async () => {
    const [result] = await processToolCalls(kit.ws, '', kit.connection, [fsCall('read', { path: file })]);
    expect(result.status, JSON.stringify(result)).toBe('ok');
    expect(result.content).toContain('title: draft one');
  });
});
