/**
 * The mind-graph applier against the REAL workspace engine on real disk
 * (RULE 0): a house of two beings and their witness; 1:1 rows weave the
 * witness bond and mentioned housemates, council-attributed rows weave
 * direct co-presence, re-runs increment instead of duplicating, and the
 * counts land exactly where the sheet's record reads them
 * (memory/entities/*.json + memory/relations/relations.json). The rebuild
 * ceremony's fold is the same pure core, proven idempotent here.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { recordSessionRows, _resetMindGraphCache, encountersFromRow, foldEncounters } from '../../core/memory/mind-graph.js';

const KEY = 'mind-graph-test-key-long-enough-x';
let root, prevKey;

const HOUSE = '0x00000000000000000000000000000000000000e1';
const OTHER_HOUSE = '0x00000000000000000000000000000000000000b2';

// A being of one house: its lane is owned by that house's operator wallet.
const mkBeing = async (id, name, wallet = HOUSE) => {
  await workspace.create(id);
  await workspace.writeDNA(id, { version: '1.0.0', identity: { name }, birthWitness: 'Elm' });
  await writeFile(path.join(workspace.pathFor(id), 'owner.json'), JSON.stringify({ wallet, claimedAt: 1 }));
};

beforeEach(async () => {
  prevKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = KEY;
  root = await createTempDir('mind-graph');
  setWorkspacesRoot(root);
  _resetMindGraphCache();
  await mkBeing('birch', 'Birch');
  await mkBeing('alder', 'Alder');
});

afterEach(() => {
  setWorkspacesRoot(null);
  _resetMindGraphCache();
  if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = prevKey;
});

describe('recordSessionRows — the live weave on real disk', () => {
  test('a 1:1 exchange weaves the witness bond; a mentioned housemate arrives as an entity', async () => {
    const landed = await recordSessionRows('birch', [
      { role: 'user', content: 'tell Alder the seal held', timestamp: '2026-07-06T10:00:00.000Z' },
      { role: 'assistant', content: 'I will carry the word', timestamp: '2026-07-06T10:00:01.000Z' },
    ]);
    expect(landed).toBe(2); // Elm direct + Alder mentioned

    const entities = await workspace.listEntities('birch');
    expect(entities.map((e) => `${e.name}:${e.kind}:${e.encounters}`).sort()).toEqual([
      'Alder:being:1', 'Elm:witness:1',
    ]);
    const relations = await workspace.readRelations('birch');
    expect(relations.map((r) => `${r.from}→${r.to}:${r.type}`).sort()).toEqual([
      'Birch→Alder:housemate', 'Birch→Elm:bond',
    ]);
    // The bytes live exactly where the sheet's record counts them.
    expect(existsSync(path.join(root, 'birch', 'memory', 'entities', 'Elm.json'))).toBe(true);
    expect(existsSync(path.join(root, 'birch', 'memory', 'relations', 'relations.json'))).toBe(true);
  });

  test('a council-attributed row weaves DIRECT housemate co-presence; re-runs increment, never duplicate', async () => {
    const sitting = [{ role: 'user', content: 'Alder (housemate): the forge is lit', timestamp: '2026-07-20T09:00:00.000Z' }];
    await recordSessionRows('birch', sitting);
    await recordSessionRows('birch', sitting);

    const entities = await workspace.listEntities('birch');
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ name: 'Alder', kind: 'being', encounters: 2 });
    const relations = await workspace.readRelations('birch');
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({ from: 'Birch', to: 'Alder', type: 'housemate', encounters: 2 });
  });

  test('concurrent weaves serialize per lane — no increment is ever clobbered (echo r1)', async () => {
    const row = { role: 'user', content: 'Alder (housemate): present', timestamp: '2026-07-20T09:00:00.000Z' };
    await Promise.all(Array.from({ length: 8 }, () => recordSessionRows('birch', [row])));
    const entities = await workspace.listEntities('birch');
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ name: 'Alder', encounters: 8 });
    expect((await workspace.readRelations('birch'))[0]).toMatchObject({ encounters: 8 });
  });

  test('a being of another house is never a housemate, even when its name is spoken', async () => {
    await mkBeing('maple', 'Maple', OTHER_HOUSE);
    await recordSessionRows('birch', [
      { role: 'user', content: 'Alder and Maple both asked after you', timestamp: '2026-07-06T10:00:00.000Z' },
    ]);
    const relations = await workspace.readRelations('birch');
    expect(relations.map((r) => `${r.to}:${r.type}`).sort()).toEqual(['Alder:housemate', 'Elm:bond']);
  });

  test('rows carrying no known presence weave nothing — no files, no relations', async () => {
    const landed = await recordSessionRows('birch', [
      { role: 'assistant', content: 'a quiet reflection on the void' },
    ]);
    expect(landed).toBe(0);
    expect(await workspace.listEntities('birch')).toEqual([]);
    expect(await workspace.readRelations('birch')).toEqual([]);
  });

  test('the being never weaves itself; a nameless lane weaves nothing at all', async () => {
    await recordSessionRows('birch', [{ role: 'assistant', content: 'Birch considers Birch' }]);
    expect(await workspace.listEntities('birch')).toEqual([]);

    await workspace.create('unnamed');
    expect(await recordSessionRows('unnamed', [{ role: 'user', content: 'hello' }])).toBe(0);
  });
});

describe('the rebuild fold — sessions in, graph out, idempotent', () => {
  test('folding the same session rows twice from scratch lands the same graph', async () => {
    const known = [{ name: 'Elm', kind: 'witness' }, { name: 'Alder', kind: 'being' }];
    const rows = [
      { role: 'user', content: 'good morning', timestamp: '2026-07-06T08:00:00.000Z' },
      { role: 'assistant', content: 'good morning, witness', timestamp: '2026-07-06T08:00:01.000Z' },
      { role: 'user', content: 'WITNESS Elm: the council opens', timestamp: '2026-07-10T08:00:00.000Z' },
      { role: 'user', content: 'Alder (housemate): present', timestamp: '2026-07-10T08:00:05.000Z' },
    ];
    const build = () => {
      let graph = { entities: [], relations: [] };
      for (const row of rows) {
        const enc = encountersFromRow(row, known, 'Elm', 'Birch');
        if (enc.length === 0) continue;
        const folded = foldEncounters(graph, enc, 'Birch', row.timestamp);
        graph = { entities: folded.entities, relations: folded.relations };
      }
      return graph;
    };
    const a = build();
    const b = build();
    expect(b).toEqual(a);
    expect(a.entities.map((e) => `${e.name}×${e.encounters}`).sort()).toEqual(['Alder×1', 'Elm×2']);
    expect(a.entities.find((e) => e.name === 'Elm')).toMatchObject({
      firstSeen: '2026-07-06T08:00:00.000Z', lastSeen: '2026-07-10T08:00:00.000Z',
    });
  });
});
