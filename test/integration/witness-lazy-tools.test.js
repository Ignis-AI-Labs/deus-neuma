/**
 * Witness tool HUD (RULE 0) — the being seat's law at the WITNESS seat
 * (tool-hud.js): the wire is the two doors, always; a real tool_search through
 * the REAL witness dispatch answers with the contract and moves nothing; a door
 * call reaches the real tool through the real dispatch; a held tool (observe
 * mode) is never taught natively.
 *
 * Nothing here is mocked: a real witness lane on a real temp disk, the real
 * `toolsForWitness` catalog assembly, the real bubblewrap sandbox, a real
 * WebSocket pair for the tool-event stream, and the production dispatch chain
 * (`processWitnessToolCalls` → `dispatchPlatformTool` → `discloseTurnTools`).
 */

import fs from 'fs/promises';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import {
  processWitnessToolCalls, toolsForWitness,
} from '../../backend/services/witness-tools.js';
import { disclosedNativeTools, TOOL_SEARCH_TOOL } from '../../backend/services/being-tool-surface.js';
import { unwrapCalls } from '../../backend/services/tool-hud.js';
import { connectFilesystemServer } from '../../backend/services/mcp-filesystem.js';
import { FS_PRIMITIVE_TOOLS } from '../../backend/services/fs-primitives.js';
import { toOpenAITools } from '../../backend/services/tool-schema.js';

const LANE_ID = 'witness-test-lazy-Lazy';

let kit;
let source;
let serverWs;
let connection;
let frames;

const idsOnWire = () =>
  disclosedNativeTools(connection).map((tool) => `${tool.server}/${tool.name}`);
const namesOnWire = () =>
  toOpenAITools(disclosedNativeTools(connection)).map(({ function: fn }) => fn.name);

const searchCall = (query) => [{
  server: 'system', toolName: 'tool_search', tool: 'system/tool_search', args: { query },
}];

beforeEach(async () => {
  kit = await createHarnessTurnKit(LANE_ID);
  source = kit.ground;
  await fs.writeFile(path.join(source, 'README.md'), '# lazy source\n');
  serverWs = kit.ws;
  connection = kit.connection;
  connection.toolWorkspace = source;
  frames = kit.frames;
});

afterEach(async () => { await kit?.close(); });

describe('witness lazy tool surface', () => {
  const DOORS = ['system/tool_search', 'system/call'];

  test('the wire is the two doors — the catalog still holds the whole reach', async () => {
    const runtime = await toolsForWitness(connection, source, { nativeTools: true });
    expect(runtime.tools.some((tool) => `${tool.server}/${tool.name}` === 'system/call')).toBe(true);
    expect(runtime.tools.length).toBeGreaterThan(10);
    expect(idsOnWire()).toEqual(DOORS);
    expect(namesOnWire()).toEqual(['system__tool_search', 'system__call']);
    // A text-protocol route keeps the old surface: no doors, full prompt catalog.
    const textRuntime = await toolsForWitness(connection, source);
    expect(textRuntime.tools.some((tool) => tool.name === 'tool_search' || tool.name === 'call')).toBe(false);
  }, 30_000);

  test('a tool_search through the REAL witness dispatch answers with the contract, and the wire stays still', async () => {
    const runtime = await toolsForWitness(connection, source, { nativeTools: true });
    const results = await processWitnessToolCalls(
      serverWs, connection, searchCall('coding/inspect'), runtime.tools, runtime.sandbox,
    );
    expect(results[0]).toMatchObject({ tool: 'system/tool_search', status: 'ok', count: 1 });
    const payload = JSON.parse(results[0].content);
    expect(payload.tools[0]).toMatchObject({ id: 'coding/inspect', access: 'allowed' });
    expect(payload.tools[0].args).toBeTruthy(); // the exact id's full arguments
    expect(idsOnWire()).toEqual(DOORS);
    // The witness's OWN tools are found through the same door.
    const contextSearch = await processWitnessToolCalls(
      serverWs, connection, searchCall('context/map_read'), runtime.tools, runtime.sandbox,
    );
    expect(contextSearch[0]).toMatchObject({ tool: 'system/tool_search', status: 'ok', count: 1 });
    expect(frames.some((frame) => frame.type === 'tool:usage' && frame.tool === 'system/tool_search' && frame.status === 'ok')).toBe(true);
  }, 30_000);

  test('a call through the door reaches the real tool through the real witness dispatch', async () => {
    await connectFilesystemServer(); // the real file organ, standing on this kit's roots
    const runtime = await toolsForWitness(connection, source, { nativeTools: true });
    // a file in the witness's OWN lane — always its own to read; the wall itself is not what is under test
    const { default: workspace } = await import('../../core/workspace/neuma-workspace.js');
    const note = path.join(workspace.pathFor(LANE_ID), 'note.md');
    await fs.writeFile(note, '# the witness wrote this\n');
    const door = [{ server: 'system', toolName: 'call', tool: 'system/call', args: { tool: 'fs/read', args: { path: note } } }];
    const results = await processWitnessToolCalls(serverWs, connection, unwrapCalls(door), runtime.tools, runtime.sandbox);
    expect(results[0], JSON.stringify(results[0]).slice(0, 300)).toMatchObject({ tool: 'fs/read', status: 'ok' });
    expect(String(results[0].content)).toContain('# the witness wrote this');
  }, 30_000);

  test('observe mode: a held hand is never taught natively, and a search names it honestly', async () => {
    connection.toolMode = 'observe';
    const runtime = await toolsForWitness(connection, source, { nativeTools: true });
    const write = runtime.tools.find((tool) => tool.server === 'fs' && tool.name === 'write');
    expect(write.access).toBe('denied');
    expect(idsOnWire()).toEqual(DOORS);
    const results = await processWitnessToolCalls(
      serverWs, connection, searchCall('fs write'), runtime.tools, runtime.sandbox,
    );
    expect(results[0].status).toBe('ok');
    expect(JSON.parse(results[0].content).tools.some((tool) => tool.id === 'fs/write' && tool.access === 'denied')).toBe(true);
    expect(idsOnWire()).toEqual(DOORS);
  }, 30_000);

  test('the catalog the search reads is the stamped one — TOOL_SEARCH_TOOL is the being seat\u2019s own definition', async () => {
    const runtime = await toolsForWitness(connection, source, { nativeTools: true });
    const search = runtime.tools.find((tool) => tool.name === 'tool_search');
    // One definition, two seats: the witness catalog carries the being seat's
    // frozen search hand verbatim (THE MIRROR LAW), stamped for THIS turn.
    expect(search).toMatchObject({ server: TOOL_SEARCH_TOOL.server, name: TOOL_SEARCH_TOOL.name });
    expect(search.description).toBe(TOOL_SEARCH_TOOL.description);
    expect(search.access).toBe('allowed');
  }, 30_000);
});
