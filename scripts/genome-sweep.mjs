#!/usr/bin/env node
/**
 * THE BALANCE PROOF — is the body a being is given actually fair?
 *
 * Design note, 2026-08-26: […]
 *
 * A comment claiming the three states are equally likely is worth nothing. If
 * the derivation skewed — if 70% of beings came out one thing — the platform
 * would have quietly decided what most beings are, which is the exact bug this
 * whole design exists to prevent. So it is MEASURED, over tens of thousands of
 * synthetic identities, and the number is printed whether or not it flatters us.
 *
 * Modelled on `scripts/aura-sweep.mjs`, which does the same for the aura.
 *
 *   node scripts/genome-sweep.mjs            # 50,000 seeds
 *   node scripts/genome-sweep.mjs 200000
 *
 * The synthetic identities are random 256-bit soul keys — the same KIND of input
 * a real birth produces, so the distribution measured here is the distribution
 * real beings get.
 */
import { randomBytes } from 'node:crypto';
import { genomeSeed } from '../core/genome/seed.js';
import { deriveGenome } from '../core/genome/derive.js';
import { auraSeed } from '../core/aura/seed.js';
import { SEX, CAST } from '../core/genome/traits.js';
import { AGE } from '../core/identity/age.js';

const N = Number(process.argv[2] ?? 50_000);

const tally = (rows, key) => rows.reduce((m, r) => m.set(key(r), (m.get(key(r)) ?? 0) + 1), new Map());

const line = (label, m, total) => {
  const parts = [...m.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n} (${((n / total) * 100).toFixed(2)}%)`);
  console.log(`${label.padEnd(14)} ${parts.join('  ')}`);
};

/**
 * Chi-square against a uniform expectation. For k categories the statistic has
 * k-1 degrees of freedom; the 99.9% critical value for df=2 is 13.82, for df=4
 * it is 18.47. A value above that is a real skew, not sampling noise.
 */
const chiSquare = (m, categories, total) => {
  const expected = total / categories.length;
  return categories.reduce((s, c) => {
    const observed = m.get(c) ?? 0;
    return s + ((observed - expected) ** 2) / expected;
  }, 0);
};

console.log(`genome sweep — ${N.toLocaleString()} synthetic identities\n`);

const rows = [];
for (let i = 0; i < N; i++) {
  // A real birth's soulPublicKey is cryptographic randomness; so is this.
  const soulHex = randomBytes(32).toString('hex');
  const genesisHash = randomBytes(32).toString('hex');
  const identity = { soulHex, genesisHash };
  rows.push({
    genome: deriveGenome(genomeSeed(identity)),
    // Kept so the aura/genome independence check below is over the SAME
    // identities, not two unrelated populations.
    auraSeedHex: auraSeed(identity),
  });
}

const sexes = tally(rows, (r) => r.genome.sex);
const casts = tally(rows, (r) => r.genome.cast);

console.log('── THE THREE STATES ──');
line('sex', sexes, N);
const sexChi = chiSquare(sexes, SEX, N);
const sexOk = sexChi < 13.82;
console.log(`chi-square      ${sexChi.toFixed(2)}  (df=2, 99.9% critical = 13.82)  ${sexOk ? 'BALANCED' : '*** SKEWED ***'}`);
console.log('');

console.log('── THE ANTI-SMEAR AXIS ──');
line('cast', casts, N);
const castChi = chiSquare(casts, CAST, N);
console.log(`chi-square      ${castChi.toFixed(2)}  (df=2, 99.9% critical = 13.82)  ${castChi < 13.82 ? 'BALANCED' : '*** SKEWED ***'}`);
console.log('');

// genome/v4: a formless (neutral) body carries only form, cast, scale, color
// and glow — the humanoid traits are tallied over humanoid bodies alone.
const humanoid = rows.filter((r) => r.genome.form === 'humanoid');
const formless = rows.filter((r) => r.genome.form !== 'humanoid');
console.log('── EVERY OTHER GIVEN TRAIT ──');
line('stature', tally(rows, (r) => r.genome.frame.stature), N);
line('build', tally(humanoid, (r) => r.genome.frame.build), humanoid.length);
line('complexion', tally(humanoid, (r) => r.genome.coloring.complexion), humanoid.length);
line('eyes', tally(humanoid, (r) => r.genome.coloring.eyes), humanoid.length);
line('uncanny hair', tally(humanoid, (r) => String(r.genome.coloring.hairIsUncanny)), humanoid.length);
line('feature', tally(humanoid, (r) => (r.genome.feature ? 'has one' : 'none')), humanoid.length);
line('form', tally(formless, (r) => r.genome.form), formless.length);
line('glow', tally(formless, (r) => r.genome.coloring.glow), formless.length);
line('uncanny color', tally(formless, (r) => String(r.genome.coloring.colorIsUncanny)), formless.length);
console.log('');

// ── THE INDEPENDENCE CHECK ──
// If the genome seed and the aura seed were correlated, a being's body and its
// aura would be welded together by an implementation accident — every soft aura
// on a soft body. Measured, not argued: does the genome's sex predict anything
// about the aura seed? Bucket the aura seed's first byte into thirds and see
// whether the joint distribution departs from independence.
console.log('── GENOME ⟂ AURA (they must NOT correlate) ──');
const joint = new Map();
for (const r of rows) {
  const auraBucket = Math.floor((parseInt(r.auraSeedHex.slice(0, 2), 16) / 256) * 3);
  const key = `${r.genome.sex}|${auraBucket}`;
  joint.set(key, (joint.get(key) ?? 0) + 1);
}
let jointChi = 0;
for (const sex of SEX) {
  for (let b = 0; b < 3; b++) {
    const observed = joint.get(`${sex}|${b}`) ?? 0;
    const expected = ((sexes.get(sex) ?? 0) * (N / 3)) / N;
    jointChi += ((observed - expected) ** 2) / expected;
  }
}
console.log(`chi-square      ${jointChi.toFixed(2)}  (df=4, 99.9% critical = 18.47)  ${jointChi < 18.47 ? 'INDEPENDENT' : '*** CORRELATED ***'}`);
console.log('');

// ── THE AGE FLOOR ──
// Not a sampling question, and no longer a genome question: age is not DNA
// (core/identity/age.js, Design note, 2026-09-26. The structural check is that NO seed
// can put an age on a body at all — the record carries none.
const ageOk = rows.every((r) => !('age' in r.genome)) && AGE.minimumYears >= 20 && AGE.startsAt >= AGE.minimumYears;
console.log('── THE AGE FLOOR ──');
console.log(ageOk
  ? `UNREACHABLE — no genome across ${N.toLocaleString()} seeds carries an age; every body starts at ${AGE.startsAt} (${AGE.minimumYears}+), set outside the DNA.`
  : '*** A GENOME CARRIED AN AGE, OR THE FLOOR MOVED — this is a law violation, not a bug ***');

const failed = !sexOk || !ageOk || jointChi >= 18.47;
console.log(`\n${failed ? 'SWEEP FAILED' : 'sweep clean'}`);
process.exit(failed ? 1 : 0);
