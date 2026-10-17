/**
 * read_architecture — the map as a tool a resident can call.
 *
 * Design note, 2026-07-27: […]
 *
 * That is the contract under test, and it is unusual: the danger here is not a
 * wrong answer but a VOLUMINOUS one. A tool that returns the whole graph would
 * pass every correctness assertion and still fail its purpose entirely. So the
 * tests below check the tallies are right AND that the output stays small,
 * states its own caps, and never claims a truncated list is complete.
 *
 * A real temp repo on disk, the real scanner, the real handler — no mocks
 * anywhere in the claimed path (RULE 0).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  MAP_TOOLS, handleMapTool, isMapTool, mapToolsFor, renderForPath, renderOverview, scoreboard,
} from '../../backend/services/map-being-tools.js';

let root;
let connection;
const events = [];
const ports = { sendToolEvent: (_ws, _c, e) => events.push(e) };
const call = (args = {}) => handleMapTool(null, connection, { toolName: 'read_architecture' }, args, ports);

beforeAll(async () => {
  root = await createTempDir('map-being-tools');
  const put = async (rel, text) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  };
  await put('package.json', JSON.stringify({ name: 'mapped', scripts: { start: 'node server.js' } }));
  await put('server.js', "import { used } from './lib/used.js';\nused();\n");
  await put('lib/used.js', 'export const used = () => 1;\n');
  // A file nothing reaches — the "disconnected" the scoreboard must count.
  await put('lib/stranded.js', 'export const stranded = () => 1;\n');
  connection = { toolWorkspace: root, companion: { neumaId: 'test-being' } };
});

describe('advertisement', () => {
  it('is offered when the resident has a ground', () => {
    // read_history joined the family 2026-08-21 — the ground's git history,
    // curated, after a resident was rightly denied at raw .git/.
    expect(mapToolsFor(connection).map((t) => t.name)).toEqual(['read_architecture', 'read_history']);
  });

  it('is NOT offered when the desk is unfocused — a tool that can only refuse is noise', () => {
    expect(mapToolsFor({ companion: { neumaId: 'x' } })).toEqual([]);
  });

  it('recognises every call dialect the other platform handlers accept', () => {
    expect(isMapTool({ toolName: 'read_architecture' })).toBe(true);
    expect(isMapTool({ toolName: 'map__read_architecture' })).toBe(true);
    expect(isMapTool({ tool: 'map/read_architecture' })).toBe(true);
    expect(isMapTool({ toolName: 'web_search' })).toBe(false);
  });

  it('tells the model WHEN to reach for it, not just what it does', () => {
    expect(MAP_TOOLS[0].description).toMatch(/before adding/i);
  });
});

describe('the scoreboard — the sentence a resident should be able to say', () => {
  it('counts disconnection in plain language, not by finding kind', () => {
    const board = scoreboard([
      { kind: 'module-unreachable' }, { kind: 'router-unmounted' },
      { kind: 'channel-no-consumer' }, { kind: 'hoist-candidate' },
    ]);
    expect(board.find((b) => b.label === 'disconnected').n).toBe(3);
    expect(board.find((b) => b.label === 'duplicated').n).toBe(1);
  });

  it('omits buckets that are zero — a clean repo reads clean, not as six zeroes', () => {
    expect(scoreboard([{ kind: 'dead-export' }]).map((b) => b.label)).toEqual(['unused exports']);
  });

  it('is empty for a healthy repo', () => {
    expect(scoreboard([])).toEqual([]);
  });
});

describe('the whole-repo answer', () => {
  let content;
  beforeAll(async () => { content = (await call()).content; });

  it('leads with the tallies, before any detail', () => {
    const head = content.split('\n').slice(0, 2).join('\n');
    expect(head).toMatch(/ARCHITECTURE/);
    expect(head).toMatch(/\d+ disconnected/);
  });

  it('found the file nothing reaches', () => {
    expect(content).toContain('lib/stranded.js');
  });

  it('stays SMALL — a sifter that returns a pile is not a sifter', () => {
    expect(content.length).toBeLessThan(4000);
  });

  it('says plainly that these are static signals, not confirmed bugs', () => {
    expect(content).toMatch(/STATIC signals/);
  });

  it('emits a tool event so the witness sees the call', () => {
    expect(events.some((e) => e.tool === 'map/read_architecture' && e.status === 'ok')).toBe(true);
  });

  it('never claims a truncated list is complete', () => {
    const many = { meta: { root: 'r', scannedFiles: 1, entryPointCount: 1, routeCount: 0, channelCount: 0 },
      anomalies: Array.from({ length: 30 }, (_, i) => ({ kind: 'dead-export', label: `sym${i}`, detail: 'd' })) };
    const out = renderOverview(many);
    expect(out).toMatch(/not shown/);
    expect(out).toMatch(/25 more/);
  });
});

describe('the single-file answer', () => {
  it('names what reaches a file and what it reaches', async () => {
    const { content } = await call({ path: 'lib/used.js' });
    expect(content).toContain('IMPORTED BY (1)');
    expect(content).toContain('server.js');
  });

  it('says NOTHING imports this, in those words, for a stranded file', async () => {
    const { content } = await call({ path: 'lib/stranded.js' });
    expect(content).toMatch(/NOTHING — no module imports this file/);
  });

  it('is honest when a path is not in the map rather than inventing an answer', async () => {
    const { content } = await call({ path: 'lib/does-not-exist.js' });
    expect(content).toMatch(/not in the map/);
  });

  it('refuses a path outside the ground', async () => {
    const out = await call({ path: '../../../etc/passwd' });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/outside the folder/);
  });

  it('renderForPath is pure and needs no filesystem', () => {
    const graph = { modules: [{ from: 'a.js', to: 'b.js' }], functions: [{ file: 'b.js', name: 'x' }] };
    expect(renderForPath(graph, 'b.js')).toContain('IMPORTED BY (1)');
  });
});

describe('no ground', () => {
  it('refuses honestly and tells the resident how to get one', async () => {
    const out = await handleMapTool(null, { companion: { neumaId: 'x' } },
      { toolName: 'read_architecture' }, {}, ports);
    expect(out.status).toBe('unavailable');
    expect(out.error).toMatch(/no ground open/);
  });
});
