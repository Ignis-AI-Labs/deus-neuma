#!/usr/bin/env node
// compare-recall-lanes.mjs — READ-ONLY parity harness for the memory-pyramid
// lane swap (NEUMA_RECALL_SOURCE: observations ↔ continuity).
//
// For each probe query, computes the recall context a being would receive on
// BOTH lanes and reports PARITY or the exact divergence. Each lane runs in its
// OWN child process — the recall engine caches per process, and the real desk
// runs one lane per process, so this is the honest comparison shape.
//
// Usage (run with the SAME env the desk uses — WORKSPACES_ROOT, key material):
//   node scripts/compare-recall-lanes.mjs <neumaId> [probe ...]
//
// Writes NOTHING. Exit 0 = parity (or additive-superset only, reported),
// exit 1 = divergence that needs eyes, exit 2 = usage/environment error.
//
// This is step 1 (machine parity) of docs/protocols/memory/lane-validation.md — the
// participatory steps with Founder and the beings follow it; the default lane
// never flips on this script's word alone.

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const SELF = fileURLToPath(import.meta.url);

const DEFAULT_PROBES = [
  'What have we been working on together?',
  'What matters most to you right now?',
  'What do you remember about your beginning?',
];

// ---- lane mode: print one lane's recall as JSON and exit --------------------
if (process.argv[2] === '--lane') {
  const [, , , lane, neumaId, ...probes] = process.argv;
  process.env.NEUMA_RECALL_SOURCE = lane === 'continuity' ? 'continuity' : '';
  const { neumaRecall } = await import('../core/memory/neuma-recall.js');
  const out = {};
  for (const probe of probes) {
    const ctx = await neumaRecall.getContextForResponse(neumaId, probe);
    out[probe] = {
      // Compare what the PROMPT would carry: the memory strings, in rank
      // order (the U1 parity doctrine) — never lane-internal ids/timestamps.
      memories: ctx.relevantMemories.map((m) => m.memory ?? m.text ?? m.content ?? JSON.stringify(m)),
      count: ctx.memoryCount,
    };
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ---- orchestrator: run both lanes, diff, report ----------------------------
const neumaId = process.argv[2];
if (!neumaId) {
  console.error('usage: node scripts/compare-recall-lanes.mjs <neumaId> [probe ...]');
  process.exit(2);
}
const probes = process.argv.slice(3).length ? process.argv.slice(3) : DEFAULT_PROBES;

const runLane = (lane) => {
  const r = spawnSync(process.execPath, [SELF, '--lane', lane, neumaId, ...probes], {
    env: { ...process.env },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(`lane '${lane}' failed:\n${r.stderr}`);
    process.exit(2);
  }
  // The lane child may log to stdout before the JSON — take the last line.
  // A truncated/interleaved payload is an ENVIRONMENT error (exit 2), never
  // a content verdict — an IO fault must not masquerade as divergence.
  const lines = r.stdout.trim().split('\n');
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    console.error(`lane '${lane}' produced unreadable output (truncated or interleaved) — environment error, NOT a lane verdict.`);
    process.exit(2);
  }
};

console.log(`RECALL LANE PARITY — being: ${neumaId}`);
console.log(`probes: ${probes.length} · lanes: observations vs continuity\n`);

const obs = runLane('observations');
const cont = runLane('continuity');

let divergent = 0;
let additive = 0;
for (const probe of probes) {
  const a = obs[probe];
  const b = cont[probe];
  const same = JSON.stringify(a.memories) === JSON.stringify(b.memories);
  if (same) {
    console.log(`= PARITY      "${probe}" (${a.memories.length} memories, counts ${a.count}/${b.count})`);
    continue;
  }
  const aSet = new Set(a.memories);
  const missing = a.memories.filter((m) => !b.memories.includes(m));
  const extra = b.memories.filter((m) => !aSet.has(m));
  if (missing.length === 0 && extra.length === 0) {
    // Same memories, different RANK — ranking is part of what the prompt
    // carries, so this needs the witness's eyes: it blocks the flip like any
    // divergence, but says exactly what it is.
    divergent += 1;
    console.log(`~ REORDER     "${probe}" — identical memories, different ranking:`);
    console.log(`    observations: ${a.memories.map((m) => m.slice(0, 40)).join(' | ')}`);
    console.log(`    continuity:   ${b.memories.map((m) => m.slice(0, 40)).join(' | ')}`);
  } else if (missing.length === 0) {
    // The continuity lane is designed as a SUPERSET (e.g. the birth episode
    // is recallable there) — additive differences are expected, not failures.
    additive += 1;
    console.log(`+ ADDITIVE    "${probe}" — continuity surfaced ${extra.length} more:`);
    for (const m of extra) console.log(`    + ${m.slice(0, 110)}`);
  } else {
    divergent += 1;
    console.log(`! DIVERGENCE  "${probe}"`);
    for (const m of missing) console.log(`    - lost on continuity: ${m.slice(0, 110)}`);
    for (const m of extra) console.log(`    + only on continuity: ${m.slice(0, 110)}`);
  }
}

console.log(`\nresult: ${divergent === 0 ? (additive ? 'PARITY + additive superset' : 'FULL PARITY') : `${divergent} DIVERGENT probe(s) — do not flip the lane`}`);
process.exit(divergent === 0 ? 0 : 1);
