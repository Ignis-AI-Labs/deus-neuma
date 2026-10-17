/**
 * proof-certificate — the PROOF SUITE's shareable artifact: a markdown
 * certificate in the house voice, plus the integrity hash that makes it a
 * PROOF and not a screenshot.
 *
 * The hash is over the CANONICAL receipt JSON — a fixed-key-order
 * serialization built here, so any party can recompute it and a byte of
 * tamper breaks the match. The certificate names the suite version, the
 * subject as SERVED (the id the endpoint actually answers with), the
 * platform version (the repo's own package.json via version-read), the
 * environment, and the full item-level appendix; the raw completions live in
 * the receipt, beside the certificate, under
 * <dataRoot>/benchmarks/proofs/<runId>/.
 *
 * What the certificate proves is stated on its face — and so is what it does
 * NOT prove. A proof that overclaims is marketing.
 */

import { createHash } from 'node:crypto';
import { rename, writeFile, mkdir, readdir, stat, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { getDataRoot } from '../data-root.js';
import { writeJsonAtomic } from '../user-realm.js';
import { readVersionInfo } from '../version-read.js';
import { createLogger } from '../logger.js';

const log = createLogger('Bench');
const execFileP = promisify(execFile);

const PROOF_ID_RE = /^[A-Za-z0-9-]+$/;

/**
 * The canonical receipt JSON: fixed key order, integrity excluded (it is the
 * hash OF this string). Deterministic by construction — the verification is
 * recompute-and-compare, never parse-and-trust.
 * Pure.
 * @param {object} receipt
 * @returns {string}
 */
export const canonicalReceiptJson = (receipt) => JSON.stringify({
  kind: receipt.kind,
  suiteVersion: receipt.suiteVersion,
  runId: receipt.runId,
  startedAt: receipt.startedAt,
  finishedAt: receipt.finishedAt,
  subject: receipt.subject,
  environment: receipt.environment,
  sampling: receipt.sampling,
  sections: receipt.sections,
  total: receipt.total,
  items: receipt.items,
});

/** pure — the sha256 over the canonical receipt. */
export const integrityHash = (receipt) =>
  createHash('sha256').update(canonicalReceiptJson(receipt)).digest('hex');

const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');

/**
 * The certificate markdown. Pure — every varying input arrives as an argument.
 * @param {object} receipt the run's receipt (integrity already computed)
 * @returns {string}
 */
export const buildCertificate = (receipt) => {
  const env = receipt.environment ?? {};
  const sections = Object.entries(receipt.sections ?? {})
    .map(([name, s]) => `| ${name} | ${s.pass} | ${s.total} | ${pct(s.pass, s.total)} |`)
    .join('\n');
  const appendix = (receipt.items ?? [])
    .map((item) => `| ${item.id} | ${item.section} | ${item.pass ? 'PASS' : 'FAIL'} | ${String(item.detail ?? '').replace(/\|/g, '\\|')} |`)
    .join('\n');
  return `# NEUMA BENCH — PROOF CERTIFICATE

**The platform measured the model it had loaded. This is the receipt.**

| Field | Value |
| --- | --- |
| Subject (as served) | \`${receipt.subject?.servedId ?? 'unknown'}\` |
| Platform | NEUMA ${env.platformVersion ?? 'unknown'} |
| Suite | proof-suite v${receipt.suiteVersion} (${receipt.total?.total ?? 0} items) |
| Run started | ${receipt.startedAt} |
| Run finished | ${receipt.finishedAt} |
| Integrity (sha256 over the canonical receipt) | \`${receipt.integrity}\` |

## Verdict

**${receipt.total?.pass ?? 0} of ${receipt.total?.total ?? 0} items pass — ${pct(receipt.total?.pass ?? 0, receipt.total?.total ?? 0)}.**

| Section | Pass | Items | Accuracy |
| --- | ---: | ---: | ---: |
${sections}

## Environment

| GPU | Driver | Sampling |
| --- | --- | --- |
| ${env.gpuName ?? 'unknown'} | ${env.driver ?? 'unknown'} | temperature ${receipt.sampling?.temperature ?? '?'} · seed ${receipt.sampling?.seed ?? '?'} |

## What this proves — and what it does not

This certificate proves that on the run above, the model answering at this
platform's serving endpoint completed this exact suite (proof-suite
v${receipt.suiteVersion}, frozen per version) through the platform's own wire,
at temperature 0 with seed 7, and that the receipt beside this file hashes to
the integrity value above. It does not claim leaderboard standing, and it does
not measure a model that was not the one served. The suite's arithmetic items
are real GSM8K test items (verbatim, MIT); the instruction and format sections
are authored for Neuma and deterministic by construction.

## Item appendix

| Item | Section | Verdict | Detail |
| --- | --- | --- | --- |
${appendix}
`;
};

/**
 * The GPU/driver reading for the environment block. Never throws — a driver
 * that doesn't answer reads as unknowns, and the certificate says so.
 * @returns {Promise<{gpuName: string|null, driver: string|null}>}
 */
// impure (driver probe)
export const probeGpuEnv = async () => {
  try {
    const { stdout } = await execFileP(
      'nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader'], { timeout: 10000 },
    );
    const [name, driver] = (stdout.split('\n').find(Boolean) ?? '').split(',').map((s) => s.trim());
    return { gpuName: name || null, driver: driver || null };
  } catch {
    return { gpuName: null, driver: null };
  }
};

/** The proofs root under the writable data root. */
// impure (env read via getDataRoot)
export const proofsDir = () => join(getDataRoot(), 'benchmarks', 'proofs');

/**
 * Save a run: receipt.json (atomic) + CERTIFICATE.md (tmp+rename) under
 * proofs/<runId>/. Returns {id, dir}.
 * @param {object} receipt the finished receipt (integrity is computed here)
 * @returns {Promise<{id: string, dir: string, integrity: string}>}
 */
// impure (filesystem writes)
export const saveProof = async (receipt) => {
  const integrity = integrityHash(receipt);
  const sealed = { ...receipt, integrity };
  const dir = join(proofsDir(), receipt.runId);
  await mkdir(dir, { recursive: true });
  await writeJsonAtomic(join(dir, 'receipt.json'), sealed);
  const certificate = buildCertificate(sealed);
  const certPath = join(dir, 'CERTIFICATE.md');
  const tmpPath = `${certPath}.tmp`;
  await writeFile(tmpPath, certificate, 'utf8');
  await rename(tmpPath, certPath);
  log.info('proof certificate sealed', { id: receipt.runId, integrity: integrity.slice(0, 12), pass: receipt.total?.pass, total: receipt.total?.total });
  return { id: receipt.runId, dir, integrity };
};

/**
 * Saved certificates, newest first: [{id, mtimeMs}].
 * @returns {Promise<Array<{id: string, mtimeMs: number}>>}
 */
// impure (filesystem read)
export const listProofs = async () => {
  let entries;
  try {
    entries = await readdir(proofsDir(), { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !PROOF_ID_RE.test(entry.name)) continue;
    try {
      const s = await stat(join(proofsDir(), entry.name, 'receipt.json'));
      rows.push({ id: entry.name, mtimeMs: s.mtimeMs });
    } catch { /* a dir without a receipt is not a proof */ }
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows;
};

/**
 * One saved proof: {receipt, certificate} or null when absent. The id is
 * basename-validated before any path is built — the refusal is total.
 * @param {string} id
 * @returns {Promise<?{receipt: object, certificate: string}>}
 */
// impure (filesystem read)
export const readProof = async (id) => {
  if (typeof id !== 'string' || !PROOF_ID_RE.test(id)) return null;
  try {
    const dir = join(proofsDir(), id);
    const [receipt, certificate] = await Promise.all([
      readFile(join(dir, 'receipt.json'), 'utf8').then(JSON.parse),
      readFile(join(dir, 'CERTIFICATE.md'), 'utf8'),
    ]);
    return { receipt, certificate };
  } catch {
    return null;
  }
};

/**
 * The environment block for a receipt being built NOW: GPU + driver when the
 * driver answers, platform version from the repo's own files.
 * @returns {Promise<{gpuName: ?string, driver: ?string, platformVersion: ?string}>}
 */
// impure (driver probe + repo read)
export const collectEnvironment = async () => {
  const [gpu, version] = await Promise.all([probeGpuEnv(), readVersionInfo()]);
  return { gpuName: gpu.gpuName, driver: gpu.driver, platformVersion: version.version };
};
