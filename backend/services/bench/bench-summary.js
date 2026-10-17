/**
 * bench-summary — the REPORTS tab's SUMMARY: one chart per benchmark taken,
 * the benchmarks never taken named plainly, and the proof suite's history.
 *
 * THE COMPARABILITY LAW (mirrors the harness's own ladder,
 * benchmarks/scripts/ladder-report.mjs): arms share a chart only when they
 * answered the SAME questions under the SAME protocol — series key = suite id
 * + protocolSha256 + sampleSelection.sha256. A bar chart that set BARE from
 * one question set beside NEUMA from another would be a chart that lies, and
 * these charts are made to be shared. Inside a series the latest succeeded
 * attempt per arm stands.
 *
 * Read-only over the sovereign harness (runs/<id>/receipt.json) and the
 * platform's own proof certificates. Reading every receipt costs ~25ms at 271
 * runs (measured 2026-09-25), so the summary is computed per request — no
 * cache to go stale.
 */

import { readdir } from 'node:fs/promises';
import { harnessRoot, resolveInside } from './bench-paths.js';
import { readRunReceipt } from './bench-receipt.js';
import { listProofs, readProof } from './proof-certificate.js';

export const ARM_ORDER = Object.freeze(['bare', 'platform', 'harness', 'silo', 'neuma', 'reference']);
export const ARM_LABEL = Object.freeze({
  bare: 'BARE', platform: 'HARNESS', silo: 'SILO', neuma: 'NEUMA', reference: 'REFERENCE',
});

/** pure — the receipt's primary metric (first primary, else first), or null. */
const primaryMetric = (receipt) => {
  const metrics = Array.isArray(receipt.metrics) ? receipt.metrics : [];
  return metrics.find((m) => m?.primary === true) ?? metrics[0] ?? null;
};

/** pure — the series key: suite + protocol digest + measured sample selection. */
const seriesKey = (receipt) => JSON.stringify([
  receipt.suite?.id ?? null, receipt.protocolSha256 ?? null, receipt.sampleSelection?.sha256 ?? null,
]);

/** pure — the matched-set key: suite + the operator's comparison id + the same questions. */
const setKey = (receipt) => (receipt.comparisonId
  ? JSON.stringify([receipt.suite?.id ?? null, `set:${receipt.comparisonId}`, receipt.sampleSelection?.sha256 ?? null])
  : null);

const finishedOf = (receipt) => receipt.timing?.finishedAt ?? '';

/** pure — the model's file name without its directory. */
const modelName = (receipt) =>
  typeof receipt.subject?.modelId === 'string' ? receipt.subject.modelId.split('/').pop() : null;

/**
 * One series projected for the chart: latest succeeded attempt per arm, arms
 * in ladder order, each with its primary value (a ratio, 0..1). Pure.
 * @param {Array<object>} runs succeeded receipts sharing the key
 */
const projectSeries = (runs) => {
  const perArm = new Map();
  for (const r of runs) {
    const prev = perArm.get(r.arm);
    if (!prev || finishedOf(r) > finishedOf(prev)) perArm.set(r.arm, r);
  }
  const arms = ARM_ORDER.filter((a) => perArm.has(a)).map((a) => {
    const r = perArm.get(a);
    const m = primaryMetric(r);
    const eff = r.efficiency ?? {};
    const num = (v) => (Number.isFinite(v) ? v : null);
    return {
      arm: a,
      label: ARM_LABEL[a],
      value: typeof m?.value === 'number' ? m.value : null,
      metric: m?.id ?? null,
      runId: r.runId ?? null,
      attempt: r.attempt ?? null,
      finishedAt: finishedOf(r) || null,
      comparisonId: r.comparisonId ?? null,
      // The deeper read (REPORTS' explorer): every metric the run scored,
      // what it cost in time and tokens, how much it acted.
      durationMs: num(r.timing?.durationMs),
      promptTokens: num(eff.promptTokens),
      completionTokens: num(eff.completionTokens),
      requests: num(eff.requests),
      toolCalls: num(eff.toolCalls),
      identityPinned: Boolean(r.subject?.silo),
      metrics: (Array.isArray(r.metrics) ? r.metrics : [])
        .filter((x) => typeof x?.value === 'number')
        .map((x) => ({ id: x.id, value: x.value, unit: x.unit ?? null, primary: x.primary === true })),
    };
  });
  const newest = runs.reduce((a, b) => (finishedOf(b) > finishedOf(a) ? b : a));
  return {
    id: seriesId(newest.suite?.id, newest.protocolSha256, newest.sampleSelection?.sha256),
    suiteId: newest.suite?.id ?? null,
    n: newest.sampleSelection?.count ?? null,
    maxTokens: newest.protocol?.maxTokens ?? null,
    temperature: newest.protocol?.temperature ?? null,
    evidence: newest.evidence ?? null,
    model: modelName(newest),
    quantization: newest.subject?.quantization ?? null,
    protocolSha256: newest.protocolSha256 ?? null,
    finishedAt: finishedOf(newest) || null,
    comparisonIds: [...new Set(arms.map((a) => a.comparisonId).filter(Boolean))],
    // Identity arms pin the being's silo, so their protocol digest differs
    // from the floor arms' by exactly that pin — said, never hidden.
    protocolKeys: new Set(runs.map((r) => r.protocolSha256 ?? null)).size,
    history: historyOf(runs),
    arms,
  };
};

/**
 * Every run in the series as a point in time — per arm, oldest first — so
 * the explorer can draw how each arm's score moved across nights and sets.
 * Pure.
 */
const historyOf = (runs) => runs
  .map((r) => ({
    arm: r.arm,
    value: typeof primaryMetric(r)?.value === 'number' ? primaryMetric(r).value : null,
    finishedAt: finishedOf(r) || null,
    comparisonId: r.comparisonId ?? null,
    runId: r.runId ?? null,
  }))
  .filter((h) => h.value !== null && h.finishedAt)
  .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));

/** pure — a series' stable, URL-safe id: suite ~ protocol ~ sample digests (12 hex each). */
export const seriesId = (suiteId, protocolSha256, samplesSha256) =>
  [suiteId, String(protocolSha256 ?? 'none').slice(0, 12), String(samplesSha256 ?? 'none').slice(0, 12)].join('~');

/**
 * The strongest comparison leads: a real comparison (2+ arms) before a lone
 * arm, then more questions (n=5 is a smoke, not evidence), then more arms,
 * then the newest. Pure.
 */
const byStrength = (a, b) =>
  Number(b.arms.length > 1) - Number(a.arms.length > 1)
  || (b.n ?? 0) - (a.n ?? 0)
  || b.arms.length - a.arms.length
  || String(b.finishedAt).localeCompare(String(a.finishedAt));

/**
 * Every succeeded receipt grouped by the comparability law, then gathered per
 * suite — each suite's series strongest first. Sorted by suite id. Pure.
 * @param {Array<object>} receipts parsed run receipts (any status)
 * @returns {Array<{suiteId: string, series: Array<object>}>}
 */
export const suitesSummary = (receipts) => {
  // Receipts join one comparison when they share the protocol digest and the
  // questions (the harness's law) OR were run together as one matched set on
  // the same questions (the operator's comparison id). The second link is
  // what keeps a four-arm set whole: identity arms pin the being's silo,
  // which changes their protocol digest — and split the set in two (live,
  // 2026-09-26: Founder's smoke set read as BARE/HARNESS and SILO/NEUMA apart).
  const ok = receipts.filter((r) => r?.status === 'succeeded' && r.suite?.id);
  const parent = ok.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const firstBy = new Map();
  ok.forEach((r, i) => {
    for (const k of [seriesKey(r), setKey(r)]) {
      if (!k) continue;
      if (firstBy.has(k)) parent[find(i)] = find(firstBy.get(k));
      else firstBy.set(k, i);
    }
  });
  const groups = new Map();
  ok.forEach((r, i) => {
    const g = find(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  });
  const bySuite = new Map();
  for (const runs of groups.values()) {
    const s = projectSeries(runs);
    if (!bySuite.has(s.suiteId)) bySuite.set(s.suiteId, []);
    bySuite.get(s.suiteId).push(s);
  }
  return [...bySuite.entries()]
    .map(([suiteId, series]) => ({ suiteId, series: series.sort(byStrength) }))
    .sort((a, b) => a.suiteId.localeCompare(b.suiteId));
};

/**
 * The catalog cells no succeeded run has ever answered — named so the
 * operator sees what is still owed. Pure.
 * @param {Array<{id: string, label?: string, tier?: string}>} cells
 * @param {Array<{suiteId: string}>} suites
 */
export const notTakenCells = (cells, suites) => {
  const taken = new Set(suites.map((s) => s.suiteId));
  // Owed is counted in BENCHMARKS: a family is taken when any of its
  // versions has been, and a variant is never owed on its own.
  const familyOf = (c) => c.family ?? c.id;
  const takenFamilies = new Set(cells.filter((c) => c?.id && taken.has(c.id)).map(familyOf));
  return cells
    .filter((c) => c?.id && !c.variant && !taken.has(c.id) && !takenFamilies.has(familyOf(c)))
    .map((c) => ({ id: c.id, label: c.label ?? null, tier: c.tier ?? null }));
};

/**
 * A proof receipt projected for the history chart — sections in the
 * receipt's own order, integrity carried so a shared card can cite it. Pure.
 * @param {object} receipt a bench-proof receipt
 */
export const projectProof = (receipt) => ({
  id: receipt.runId ?? null,
  finishedAt: receipt.finishedAt ?? null,
  servedId: receipt.subject?.servedId ?? null,
  platformVersion: receipt.environment?.platformVersion ?? null,
  gpu: receipt.environment?.gpuName ?? null,
  suiteVersion: receipt.suiteVersion ?? null,
  temperature: receipt.sampling?.temperature ?? null,
  sections: Object.entries(receipt.sections ?? {}).map(([id, s]) => ({
    id, pass: s?.pass ?? 0, total: s?.total ?? 0,
  })),
  total: { pass: receipt.total?.pass ?? 0, total: receipt.total?.total ?? 0 },
  integrity: receipt.integrity ?? null,
});

/**
 * Every run receipt under the harness, parsed, each with its invalidation
 * applied (bench-receipt.js). Unreadable ones are skipped — an in-flight run
 * dir has no receipt yet.
 * @param {string} [root]
 * @returns {Promise<Array<object>>}
 */
// impure (filesystem reads)
export const readAllRunReceipts = async (root = harnessRoot()) => {
  let entries;
  try {
    entries = await readdir(resolveInside(root, 'runs'), { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      out.push(await readRunReceipt(root, entry.name)); // an invalidated run reads failed — it never scores
    } catch { /* no receipt (in flight) or a corrupt one — skipped, never fatal */ }
  }
  return out;
};

/**
 * The proof history, newest first.
 * @returns {Promise<Array<object>>}
 */
// impure (filesystem reads)
export const readProofHistory = async () => {
  const out = [];
  for (const { id } of await listProofs()) {
    const proof = await readProof(id);
    if (proof?.receipt) out.push(projectProof(proof.receipt));
  }
  return out;
};
