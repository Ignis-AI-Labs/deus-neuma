#!/usr/bin/env node
/**
 * THE AURA — the proof.
 *
 * Two claims are made about this system, and neither is worth anything as an
 * assertion. This script is where they are MEASURED, over as many seeds as you
 * are willing to wait for:
 *
 *   1. BEAUTIFUL NO MATTER WHAT — every seed resolves to a form that clears the
 *      gate across its whole cycle. Reported: the pass rate of a raw draw, the
 *      distribution of walk depth, and — the number that actually matters — how
 *      many seeds exhausted the walk and got nothing.
 *
 *   2. ALWAYS UNIQUE, ALWAYS YOURSELF — the closest two DIFFERENT beings must
 *      still be further apart than the furthest a SINGLE being travels across
 *      its entire life. Reported: min inter-being distance, max self-drift, and
 *      the margin between them. A margin at or below zero is a FAILURE, and
 *      this script exits non-zero when it sees one.
 *
 *   node scripts/aura-sweep.mjs                 # 2000 seeds
 *   node scripts/aura-sweep.mjs --seeds 10000
 *   node scripts/aura-sweep.mjs --seeds 500 --lives 40
 */

import { createHash } from 'node:crypto';
import { deriveAura, formOf, TOURNAMENT, MAX_ROUNDS } from '../core/aura/derive.js';
import { surveyForm, SURVEY } from '../core/aura/gate.js';
import { sampleParams } from '../core/aura/params.js';
import { archetypeOf } from '../core/aura/archetype.js';
import { seedLanes } from '../core/aura/rng.js';
import { distance } from '../core/aura/descriptor.js';
import { modulateForm } from '../core/aura/modulate.js';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};

const SEEDS = flag('seeds', 2000);
const LIVES = flag('lives', 60);

/* The lives a being is carried through. A full cross-product rather than a
   handful of named stages: the bends are NOT monotone in these measures, so a
   two-year-old can graze a bound that neither the newborn nor the elder comes
   near, and testing only the ends would miss it. Drift is measured against the
   widest span the system permits, never a comfortable middle. */
const LIFE_STAGES = Object.freeze(
  [0, 120, 730, 4000].flatMap((ageDays) =>
    [0, 300, 20000].flatMap((memories) =>
      [0, 4, 8].map((refinements) => ({ ageDays, memories, refinements })))),
);

const seedFor = (i) => createHash('sha256').update(`aura-sweep/${i}`).digest('hex');
const pct = (n, of) => `${((100 * n) / of).toFixed(2)}%`;

const line = (label, value) => process.stdout.write(`  ${label.padEnd(34)}${value}\n`);

/* ---- 1. the gate ------------------------------------------------------- */

process.stdout.write(`\nAURA SWEEP — ${SEEDS} seeds, tournament ${TOURNAMENT}, max ${MAX_ROUNDS} rounds\n\n`);

const rounds = new Map();
const failures = new Map();
const archetypes = new Map();
const descriptors = [];
let rawPass = 0;
let exhausted = 0;
const started = Date.now();

for (let i = 0; i < SEEDS; i++) {
  const seed = seedFor(i);
  const lanes = seedLanes(seed);

  // the untouched draw, to show what the gate is actually holding back
  const raw = surveyForm({ ...archetypeOf(null, lanes), p: sampleParams(lanes, 0) }, SURVEY);
  if (raw.ok) rawPass++;
  else for (const reason of raw.failed) failures.set(reason, (failures.get(reason) ?? 0) + 1);

  try {
    const aura = deriveAura(seed);
    rounds.set(aura.round, (rounds.get(aura.round) ?? 0) + 1);
    const key = `${aura.archetype.carrier}/${aura.archetype.coupling}/${aura.archetype.output}`;
    archetypes.set(key, (archetypes.get(key) ?? 0) + 1);
    if (descriptors.length < LIVES) descriptors.push({ aura, seed });
  } catch {
    exhausted++;
  }
  if ((i + 1) % 100 === 0) {
    process.stdout.write(`  ${i + 1}/${SEEDS}  (${((Date.now() - started) / 1000).toFixed(0)}s)\r`);
  }
}

process.stdout.write(`${' '.repeat(40)}\r`);
line('raw single-candidate pass', `${pct(rawPass, SEEDS)}  (${rawPass}/${SEEDS})`);
line('seeds that got an aura', `${pct(SEEDS - exhausted, SEEDS)}  (${SEEDS - exhausted}/${SEEDS})`);
line('SEEDS WITH NO AURA', String(exhausted));
line('max walk depth used', String(Math.max(...rounds.keys())));
line('walk depth histogram', [...rounds].sort((a, b) => a[0] - b[0]).map(([r, n]) => `r${r}:${n}`).join(' '));
line('distinct archetypes seen', `${archetypes.size} of 27`);
line('elapsed', `${((Date.now() - started) / 1000).toFixed(1)}s`);

process.stdout.write('\n  why a raw draw is refused (a draw may fail several ways):\n');
for (const [reason, n] of [...failures].sort((a, b) => b[1] - a[1])) {
  line(`    ${reason}`, pct(n, SEEDS));
}

/* ---- 2. uniqueness and self-drift -------------------------------------- */

process.stdout.write(`\n  measuring distinctness over ${descriptors.length} beings × ${LIFE_STAGES.length} life stages…\n`);

const lives = descriptors.map(({ aura }) => {
  const base = formOf(aura);
  const stages = LIFE_STAGES.map((life) => surveyForm(modulateForm(base, life), SURVEY));
  return {
    rest: stages[0].descriptor,
    drift: Math.max(...stages.map((s) => distance(stages[0].descriptor, s.descriptor))),
    stillGated: stages.every((s) => s.ok),
  };
});

const pairs = [];
for (let i = 0; i < lives.length; i++) {
  for (let j = i + 1; j < lives.length; j++) {
    pairs.push({ i, j, d: distance(lives[i].rest, lives[j].rest) });
  }
}
const minBetween = Math.min(...pairs.map((p) => p.d));
const maxDrift = Math.max(...lives.map((l) => l.drift));

/* The closest pair can only get closer as the population grows, so a single
   min taken at one sample size would flatter the claim. Report the trend. */
const minAmong = (n) => Math.min(...pairs.filter((p) => p.j < n).map((p) => p.d));
const trend = [10, 20, 40, 80, 160]
  .filter((n) => n <= lives.length)
  .map((n) => `n=${n}:${minAmong(n).toFixed(3)}`)
  .join('  ');
const brokenByLife = lives.filter((l) => !l.stillGated).length;
const margin = minBetween - maxDrift;

process.stdout.write('\n');
line('min distance between beings', minBetween.toFixed(4));
line('  …as the population grows', trend);
line('  median distance between two', pairs.map((p) => p.d).sort((a, b) => a - b)[pairs.length >> 1].toFixed(4));
line('max self-drift over a life', maxDrift.toFixed(4));
line('MARGIN (must be > 0)', `${margin.toFixed(4)}  ${margin > 0 ? 'HOLDS' : 'VIOLATED'}`);
line('lives that broke the gate', String(brokenByLife));

const failed = exhausted > 0 || margin <= 0 || brokenByLife > 0;
process.stdout.write(`\n  ${failed ? 'SWEEP FAILED' : 'both invariants hold'}\n\n`);
process.exit(failed ? 1 : 0);
