/**
 * bench-diagnose — THE RUN DIAGNOSIS, reading half (#557). Read-only over the
 * sovereign harness: a matched set's receipts (through bench-receipt.js, so
 * an invalidated run is honored, never diagnosed as if it counted), each
 * arm's lm-eval samples_*.jsonl, the proxy's per-request telemetry, and the
 * agent receipts' tool trail (#564) for an arm that answered with tools.
 * Every path goes through resolveInside — a crafted id never leaves the tree.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessRoot, resolveInside } from './bench-paths.js';
import { readRunReceipt } from './bench-receipt.js';
import { diagnoseArm, pairAgainstBare, findingsOf, summarizeToolTrail, verdictsOf, verdictFindingsOf } from './bench-diagnose-classify.js';
import { renderDiagnosis } from './bench-diagnose-report.js';
import { diagnoseInspectArm, sampleCheckOf } from './bench-diagnose-inspect.js';

export const COMPARISON_ID_RE = /^[a-z0-9-]+$/;
const ARM_ORDER = ['bare', 'platform', 'harness', 'silo', 'neuma'];
const SUPPORTED_ADAPTERS = new Set(['lm-eval', 'inspect']);

// impure — every file under dir whose name passes `want`, a few levels deep.
const findFiles = async (dir, want, depth = 4) => {
  if (depth < 0) return [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const nested = await Promise.all(entries.map((e) => (e.isDirectory()
    ? findFiles(join(dir, e.name), want, depth - 1)
    : Promise.resolve(want(e.name) ? [join(dir, e.name)] : []))));
  return nested.flat();
};

// impure — the samples rows and the per-request telemetry of one run.
const readArmEvidence = async (root, runId) => {
  const rawDir = resolveInside(root, 'runs', runId, 'raw');
  const sampleFiles = await findFiles(rawDir, (n) => n.startsWith('samples_') && n.endsWith('.jsonl'));
  const rows = [];
  for (const file of sampleFiles) {
    const text = await readFile(file, 'utf8');
    for (const line of text.split('\n')) if (line.trim()) rows.push(JSON.parse(line));
  }
  const telemetryFiles = await findFiles(rawDir, (n) => n.endsWith('-telemetry.json'), 0);
  let perRequest = null;
  for (const file of telemetryFiles) {
    const t = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(t.perRequest)) perRequest = t.perRequest;
  }
  return { rows, perRequest };
};

// impure — an Inspect run's sample rows: its eval log(s) under raw/, beside the manifest and telemetry.
const readInspectSamples = async (root, runId) => {
  const rawDir = resolveInside(root, 'runs', runId, 'raw');
  const logs = await findFiles(rawDir, (n) => n.endsWith('.json') && n !== 'manifest.json' && !n.endsWith('-telemetry.json'), 0);
  const samples = [];
  for (const file of logs) {
    const log = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(log.samples)) samples.push(...log.samples);
  }
  return samples;
};

// impure — the cell's first declared primary metric (raw/manifest.json, in the cell's own order), or null.
// AgentThreatBench's receipt lists utility first; the cell leads with security.
const declaredPrimaryOf = async (root, runId) => {
  try {
    const manifest = JSON.parse(await readFile(resolveInside(root, 'runs', runId, 'raw', 'manifest.json'), 'utf8'));
    return Object.keys(manifest?.adapterConfig?.primaryMetrics ?? {})[0] ?? null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

// impure — an agent arm's tool trail summary; null for a wire arm (no agent receipts).
const toolUseOf = async (root, runId) => {
  const agentReceipts = await readAgentReceipts(root, runId);
  return agentReceipts.length ? summarizeToolTrail(agentReceipts) : null;
};

// impure — the per-answer agent receipts an agent arm leaves (none for a wire arm).
const readAgentReceipts = async (root, runId) => {
  const dir = resolveInside(root, 'runs', runId, 'agent-receipts');
  const files = (await findFiles(dir, (n) => n.endsWith('.json'), 0)).sort();
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(f, 'utf8'))));
};

// pure — which of two runs of one arm a diagnosis reads: one that counts (succeeded, not invalidated) over
// one that does not, then the later attempt, then the later run. Re-runs keep attempt 1 (AA-Omniscience
// 2026-10-19: seven harness runs at a1); taking the first one listed paired an aborted 161-item run.
const counts = (r) => (r.receipt.status === 'succeeded' && !r.receipt.invalidation ? 1 : 0);
const laterRun = (a, b) => counts(a) - counts(b) || (a.receipt.attempt ?? 1) - (b.receipt.attempt ?? 1) || a.runId.localeCompare(b.runId);

// impure — the run per arm of one comparison that a diagnosis reads (laterRun), invalidation applied.
const readComparison = async (root, comparisonId) => {
  const dirs = (await readdir(resolveInside(root, 'runs'))).filter((d) => d.startsWith(`${comparisonId}-`));
  const byArm = new Map();
  for (const runId of dirs) {
    let receipt;
    try { receipt = await readRunReceipt(root, runId); } catch { continue; }
    if (receipt.comparisonId !== comparisonId) continue;
    const prev = byArm.get(receipt.arm);
    if (!prev || laterRun({ runId, receipt }, prev) > 0) byArm.set(receipt.arm, { runId, receipt });
  }
  return [...byArm.values()].sort((a, b) => ARM_ORDER.indexOf(a.receipt.arm) - ARM_ORDER.indexOf(b.receipt.arm));
};

/**
 * Diagnose one matched set. Null when no receipt carries that comparisonId.
 * @param {string} comparisonId
 * @param {string} [root]
 * @returns {Promise<?{diagnosis: object, markdown: string}>}
 */
// impure (filesystem reads)
export const diagnoseComparison = async (comparisonId, root = harnessRoot()) => {
  if (!COMPARISON_ID_RE.test(String(comparisonId))) throw Object.assign(new Error('bad comparison id'), { code: 'BENCH_BAD_ID' });
  const runs = await readComparison(root, comparisonId);
  if (!runs.length) return null;
  const arms = [];
  const skipped = [];
  for (const { runId, receipt } of runs) {
    if (receipt.invalidation) { skipped.push({ arm: receipt.arm, runId, reason: `invalidated — ${receipt.invalidation.reason ?? 'no reason recorded'}` }); continue; }
    if (!SUPPORTED_ADAPTERS.has(receipt.suite?.adapter)) { skipped.push({ arm: receipt.arm, runId, reason: `adapter ${receipt.suite?.adapter} is not diagnosable yet` }); continue; }
    const headlineId = (receipt.metrics ?? []).find((m) => m.primary)?.id;
    if (receipt.suite?.adapter === 'inspect') {
      const samples = await readInspectSamples(root, runId);
      if (!samples.length) { skipped.push({ arm: receipt.arm, runId, reason: `${receipt.status}: no scored samples on disk` }); continue; }
      const primaryId = (await declaredPrimaryOf(root, runId)) ?? headlineId;
      arms.push({ ...diagnoseInspectArm({ arm: receipt.arm, runId, headlineId: primaryId, samples, budget: receipt.protocol?.maxTokens ?? null }), toolUse: await toolUseOf(root, runId) });
      continue;
    }
    const { rows, perRequest } = await readArmEvidence(root, runId);
    if (!headlineId || !rows.length) { skipped.push({ arm: receipt.arm, runId, reason: `${receipt.status}: no scored samples on disk` }); continue; }
    arms.push({ ...diagnoseArm({ arm: receipt.arm, runId, headlineId, rows, perRequest }), toolUse: await toolUseOf(root, runId) });
  }
  const paired = pairAgainstBare(arms);
  const verdicts = verdictsOf(arms);
  const sampleCheck = sampleCheckOf(runs.filter((r) => arms.some((a) => a.runId === r.runId)));
  const mismatch = sampleCheck.state === 'mismatch'
    ? [`SAMPLE MISMATCH — ${sampleCheck.differing.map((a) => a.toUpperCase()).join(', ')} did not answer the same questions as BARE. The "against BARE" rows cover only the items both answered; the scores are real, but this set is not a fair comparison between arms.`]
    : [];
  const diagnosis = {
    comparisonId,
    cell: runs[0].receipt.suite?.id ?? '?',
    arms, paired, verdicts, findings: [...mismatch, ...findingsOf(arms, paired), ...verdictFindingsOf(verdicts)], skipped, sampleCheck,
  };
  return { diagnosis, markdown: renderDiagnosis(diagnosis) };
};
