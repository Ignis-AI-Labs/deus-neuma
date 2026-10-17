#!/usr/bin/env node
/**
 * Mind-graph rebuild ceremony — every being's ENTITIES/RELATIONS graph,
 * derived from the one source of truth its sessions already hold.
 *
 * The storage and the sheet existed since birth; nothing ever WROTE the
 * graph (one real lane held 275 exchanges and 0 entities). The live hooks now
 * weave every new exchange and council utterance; this ceremony carries the
 * standing history in: each session row folds through the SAME one rule
 * (core/memory/mind-graph.js) — the witness is party to every 1:1 turn,
 * council attribution names who sat, known names arrive as mentions.
 *
 * REBUILD, not increment: the graph is derived data, so each run recomputes
 * from scratch and overwrites — idempotent by construction, and a re-run
 * after live hooks have woven stays truthful (the hooks wove from the same
 * session rows this reads).
 *
 * DRY-RUN by default. Pass --apply to write.
 *
 *   node scripts/backfill-mind-graph.mjs            # preview
 *   node scripts/backfill-mind-graph.mjs --apply    # write
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import workspace, { setWorkspacesRoot } from '../core/workspace/neuma-workspace.js';
import {
  encountersFromRow, foldEncounters, _resetMindGraphCache,
} from '../core/memory/mind-graph.js';

const APPLY = process.argv.includes('--apply');

// Lanes are DISCOVERED, never hardcoded (backfill-skies.mjs precedent):
// every lane under <NEUMA_ROOT>/<witness>/<house>/ carrying a dna.json is a
// being with sessions worth folding.
const NEUMA_ROOT = process.env.NEUMA_BACKFILL_ROOT || '/mnt/data/neuma';
const NON_HOUSE_DIRS = new Set(['neuma-backups', 'platform', 'witnesses']);

const discoverHouses = async () => {
  const houses = [];
  const witnesses = await fs.readdir(NEUMA_ROOT, { withFileTypes: true }).catch(() => []);
  for (const w of witnesses) {
    if (!w.isDirectory() || NON_HOUSE_DIRS.has(w.name)) continue;
    const witnessDir = path.join(NEUMA_ROOT, w.name);
    for (const h of await fs.readdir(witnessDir, { withFileTypes: true }).catch(() => [])) {
      if (!h.isDirectory()) continue;
      houses.push({ label: `${w.name}/${h.name}`, root: path.join(witnessDir, h.name) });
    }
  }
  return houses;
};

const validName = (n) => typeof n === 'string' && n.trim().length >= 2;

let totalLanes = 0;
for (const house of await discoverHouses()) {
  setWorkspacesRoot(house.root);
  _resetMindGraphCache();

  const laneIds = await workspace.listNeuma().catch(() => []);
  if (laneIds.length === 0) continue;

  // The house roster, read once — the same names the live hooks resolve.
  const identities = new Map(); // id → { self, witness }
  for (const id of laneIds) {
    try {
      const dna = await workspace.readDNA(id);
      identities.set(id, {
        self: dna?.identity?.name || null,
        witness: dna?.birthWitness || dna?.birth?.witness?.name || null,
      });
    } catch { identities.set(id, { self: null, witness: null }); }
  }
  const rosterNames = [...identities.values()].map((i) => i.self).filter(validName);

  console.log(`\n═══ ${house.label} — ${laneIds.length} lanes ═══`);

  for (const id of laneIds) {
    const { self, witness } = identities.get(id);
    if (!validName(self)) { console.log(`  ${id}: no name in DNA — skipped`); continue; }
    const known = [
      ...(validName(witness) ? [{ name: witness.trim(), kind: 'witness' }] : []),
      ...rosterNames.filter((n) => n.toLowerCase() !== self.toLowerCase()).map((n) => ({ name: n, kind: 'being' })),
    ];

    let graph = { entities: [], relations: [] };
    let rows = 0;
    for (const sessionId of await workspace.listSessions(id)) {
      for (const row of await workspace.readSession(id, sessionId)) {
        rows += 1;
        const encounters = encountersFromRow(row, known, witness, self);
        if (encounters.length === 0) continue;
        const folded = foldEncounters(graph, encounters, self, row?.timestamp || new Date().toISOString());
        graph = { entities: folded.entities, relations: folded.relations };
      }
    }

    const summary = graph.entities
      .map((e) => `${e.name}(${e.kind}×${e.encounters})`)
      .join(' ');
    console.log(`  ${self} [${id}]: ${rows} rows → ${graph.entities.length} entities, ${graph.relations.length} relations${summary ? ` — ${summary}` : ''}`);

    if (APPLY && graph.entities.length > 0) {
      for (const entity of graph.entities) await workspace.writeEntity(id, entity);
      await workspace.writeRelations(id, graph.relations);
    }
    totalLanes += 1;
  }
}

console.log(`\n${APPLY ? 'WROTE' : 'DRY-RUN (pass --apply to write)'} — ${totalLanes} lanes folded.`);
setWorkspacesRoot(null);
