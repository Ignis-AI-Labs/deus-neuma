/**
 * bench-fixture-tree — materialize a harness-shaped tree in a temp dir from
 * the REAL artifacts committed under test/fixtures/bench/ (captured from the
 * sovereign harness, 2026-09-23). Shared by the bench unit + integration
 * suites so both judge the same ground truth.
 *
 * The tree carries a stub bench.mjs so the availability probe passes — the
 * fixture tree is READ, never spawned (spawning belongs to the real-harness
 * gnosis test).
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const BENCH_FIXTURES = fileURLToPath(new URL('../fixtures/bench', import.meta.url));
export const FIXTURE_NIGHT_STAMP = 'night-20260921t192252z';
export const FIXTURE_BUNDLE_ID = 'night-20260920t230631z';
export const FIXTURE_PLAN_NAME = 'tb-rem2a-20260918';

/**
 * Build the fixture harness tree under `dir`.
 * impure (writes the temp tree).
 * @param {string} dir
 * @returns {Promise<string>} dir
 */
export const buildBenchFixtureTree = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
  const put = async (rel, fromFixture) => {
    const target = path.join(dir, rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(BENCH_FIXTURES, fromFixture), target);
  };
  await fs.writeFile(path.join(dir, 'bench.mjs'), '// fixture stub — the probe only needs it present\n');
  await put(`logs/${FIXTURE_NIGHT_STAMP}-status.json`, 'night-status.json');
  await put('logs/serving-incidents.jsonl', 'serving-incidents.jsonl');
  await put(`reports/bundles/${FIXTURE_BUNDLE_ID}/REPORT.md`, 'bundle/REPORT.md');
  await put(`reports/bundles/${FIXTURE_BUNDLE_ID}/metrics.csv`, 'bundle/metrics.csv');
  await put(`reports/bundles/${FIXTURE_BUNDLE_ID}/queue-status.json`, 'bundle/queue-status.json');
  await put('reports/NIGHT-LATEST.md', 'NIGHT-LATEST.md');
  await put('cells/t1/gsm8k/CELL.json', 'CELL.json');
  // The family's real variant overlay (benchmarks, 2026-09-26: variants live
  // beside their base as variants/<id>.json).
  await put('cells/t1/gsm8k/variants/gsm8k-2568.json', 'variants/gsm8k-2568.json');
  await put('models.json', 'models.json');
  await put(`plans/${FIXTURE_PLAN_NAME}.json`, 'plan.json');
  // Scoreboard + ladder are plain markdown reads (no parsing) — short texts stand in.
  await fs.writeFile(path.join(dir, 'SCOREBOARD.md'), '# BENCHMARK SCOREBOARD — fixture\n');
  await fs.writeFile(path.join(dir, 'reports', 'LADDER.md'), '# LADDER — fixture\n');
  return dir;
};

export const FIXTURE_PROOF_ID = '2026-09-24T16-37-29-880Z-e77e0f5c';

/**
 * Add the REAL captured run receipts (test/fixtures/bench/runs/, captured
 * 2026-09-25) to a harness tree: the four-arm gsm8k-2568 n=100 series, an
 * older bare attempt of it, a NEUMA-only n=25 series, a failed run, and an
 * n=50 bare under another protocol. Separate from buildBenchFixtureTree so
 * the suites that pin an empty run ledger keep their ground.
 * impure (copies into the tree).
 * @param {string} dir the harness tree
 * @returns {Promise<string[]>} the run ids copied
 */
export const addBenchRunFixtures = async (dir) => {
  const ids = await fs.readdir(path.join(BENCH_FIXTURES, 'runs'));
  for (const id of ids) {
    await fs.mkdir(path.join(dir, 'runs', id), { recursive: true });
    await fs.copyFile(path.join(BENCH_FIXTURES, 'runs', id, 'receipt.json'), path.join(dir, 'runs', id, 'receipt.json'));
    // A run's sealed logs, where the fixture kept them (the failed heartbeat's real stderr).
    await fs.cp(path.join(BENCH_FIXTURES, 'runs', id, 'stderr'), path.join(dir, 'runs', id, 'stderr'), { recursive: true }).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
  return ids;
};

/**
 * Seat the REAL captured proof certificate (2026-09-24) under a data root,
 * where proof-certificate.js reads it: <dataRoot>/benchmarks/proofs/<id>/.
 * impure (copies into the data root).
 * @param {string} dataRoot
 */
export const addBenchProofFixture = async (dataRoot) => {
  const dir = path.join(dataRoot, 'benchmarks', 'proofs', FIXTURE_PROOF_ID);
  await fs.mkdir(dir, { recursive: true });
  for (const name of ['receipt.json', 'CERTIFICATE.md']) {
    await fs.copyFile(path.join(BENCH_FIXTURES, 'proof', name), path.join(dir, name));
  }
};
