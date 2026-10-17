/**
 * bench-reports — the harness's OUTPUT side, read-only: report bundles, the
 * scoreboard family, the run ledger, and the metrics.csv parser.
 *
 * A bundle is reports/bundles/<id>/ — the night's sealed account (REPORT.md,
 * metrics.csv, receipts.json, queue-status.json). Bundle ids and artifact
 * names come from the client, so both are validated here BEFORE a path is
 * built: ids against a strict charset, artifacts against a closed map — the
 * refusal is total, there is nothing to sanitize.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { harnessRoot, resolveInside } from './bench-paths.js';
import { readRunReceipt } from './bench-receipt.js';

const BUNDLE_CAP = 50;
const RUN_CAP = 500;

export const BUNDLE_ID_RE = /^[A-Za-z0-9-]+$/;

/** The artifacts a client may ask for — a closed map, never a raw filename. */
export const BUNDLE_ARTIFACTS = Object.freeze({
  report: 'REPORT.md',
  metrics: 'metrics.csv',
  receipts: 'receipts.json',
  queue: 'queue-status.json',
});

/** pure — a coded refusal the routes map to a 400. */
const badRequest = (code, message) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

/**
 * Parse metrics.csv text. Pure. Header is fixed by the harness:
 *   runId,comparisonId,arm,status,attempt,metric,value
 * Fields may be quoted ("gsm8k/exact_match,strict-match") with "" escapes.
 * @param {string} text
 * @returns {Array<{runId: string, comparisonId: string, arm: string,
 *   status: string, attempt: ?number, metric: string, value: ?number}>}
 */
export const parseMetricsCsv = (text) => {
  const lines = String(text ?? '').split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const parseRow = (line) => {
    const fields = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
        } else { field += ch; }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        fields.push(field); field = '';
      } else { field += ch; }
    }
    fields.push(field);
    return fields;
  };
  const toNumber = (s) => {
    const n = Number(s);
    return s !== '' && Number.isFinite(n) ? n : null;
  };
  return lines.slice(1).map(parseRow)
    .filter((f) => f.length >= 7)
    .map((f) => ({
      runId: f[0],
      comparisonId: f[1],
      arm: f[2],
      status: f[3],
      attempt: toNumber(f[4]),
      metric: f[5],
      value: toNumber(f[6]),
    }));
};

/**
 * Report bundles on disk, newest first: [{id, mtimeMs}], capped at 50.
 * @param {string} [root]
 * @returns {Promise<Array<{id: string, mtimeMs: number}>>}
 */
// impure (filesystem reads)
export const listBundles = async (root = harnessRoot()) => {
  let entries;
  try {
    entries = await readdir(resolveInside(root, 'reports', 'bundles'), { withFileTypes: true });
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const s = await stat(resolveInside(root, 'reports', 'bundles', entry.name));
      rows.push({ id: entry.name, mtimeMs: s.mtimeMs });
    } catch { /* vanished mid-scan */ }
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows.slice(0, BUNDLE_CAP);
};

/**
 * Read one bundle artifact as text. Throws a coded error on a bad id or an
 * artifact outside the closed map (the route maps these to 400); returns
 * null when the bundle or file simply does not exist (the route's 404).
 * @param {string} [root]
 * @param {string} id - bundle id
 * @param {string} artifact - one of BUNDLE_ARTIFACTS keys
 * @returns {Promise<?string>}
 */
// impure (filesystem read)
export const readBundleArtifact = async (root = harnessRoot(), id, artifact) => {
  if (typeof id !== 'string' || !BUNDLE_ID_RE.test(id)) {
    throw badRequest('BENCH_BAD_ID', `bad bundle id: ${String(id).slice(0, 64)}`);
  }
  const file = BUNDLE_ARTIFACTS[artifact];
  if (!file) {
    throw badRequest('BENCH_BAD_ARTIFACT', `unknown artifact: ${String(artifact).slice(0, 64)} — one of ${Object.keys(BUNDLE_ARTIFACTS).join(', ')}`);
  }
  try {
    return await readFile(resolveInside(root, 'reports', 'bundles', id, file), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw err;
  }
};

const readTextOrNull = async (path) => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
};

/**
 * The scoreboard family as raw texts (the desk renders markdown as-is):
 * SCOREBOARD.md, reports/LADDER.md, reports/NIGHT-LATEST.md — each null when
 * absent.
 * @param {string} [root]
 */
// impure (filesystem reads)
export const readScoreboard = async (root = harnessRoot()) => ({
  scoreboard: await readTextOrNull(resolveInside(root, 'SCOREBOARD.md')),
  ladder: await readTextOrNull(resolveInside(root, 'reports', 'LADDER.md')),
  nightLatest: await readTextOrNull(resolveInside(root, 'reports', 'NIGHT-LATEST.md')),
});

/**
 * The run-ledger row projection: the table columns AND the detail panel's
 * truth — timestamps, the primary metric, token efficiency, and the HASHES
 * (protocol / model artifact / tokenizer / sample-selection) the operator
 * organizes by. Every field is null-honest: an older receipt that lacks a
 * section reads null, never an invented value.
 * Pure.
 * @param {object} receipt a parsed runs/<runId>/receipt.json
 * @param {string} dirId the run dir (fallback for a receipt without runId)
 */
export const projectRunRow = (receipt, dirId) => {
  const primary = Array.isArray(receipt.metrics)
    ? receipt.metrics.find((m) => m?.primary === true) ?? null
    : null;
  const efficiency = receipt.efficiency && typeof receipt.efficiency === 'object'
    ? receipt.efficiency
    : null;
  return {
    runId: receipt.runId ?? dirId,
    comparisonId: receipt.comparisonId ?? null,
    arm: receipt.arm ?? null,
    status: receipt.status ?? null,
    attempt: receipt.attempt ?? null,
    suiteId: receipt.suite?.id ?? null,
    suiteTier: receipt.suite?.tier ?? null,
    startedAt: receipt.timing?.startedAt ?? null,
    finishedAt: receipt.timing?.finishedAt ?? null,
    durationMs: receipt.timing?.durationMs ?? null,
    primaryMetric: primary ? { id: primary.id ?? null, value: primary.value ?? null, unit: primary.unit ?? null } : null,
    metricCount: Array.isArray(receipt.metrics) ? receipt.metrics.length : 0,
    tokens: efficiency
      ? { prompt: efficiency.promptTokens ?? null, completion: efficiency.completionTokens ?? null }
      : null,
    efficiency: efficiency
      ? {
        promptTokens: efficiency.promptTokens ?? null,
        completionTokens: efficiency.completionTokens ?? null,
        requests: efficiency.requests ?? null,
        toolCalls: efficiency.toolCalls ?? null,
      }
      : null,
    hashes: {
      protocol: receipt.protocolSha256 ?? null,
      model: receipt.subject?.identity?.sha256 ?? null,
      tokenizer: receipt.subject?.tokenizerSha256 ?? null,
      samples: receipt.sampleSelection?.sha256 ?? null,
    },
    modelId: typeof receipt.subject?.modelId === 'string' ? receipt.subject.modelId.split('/').pop() : null,
    quantization: receipt.subject?.quantization ?? null,
    environment: receipt.environment && typeof receipt.environment === 'object'
      ? { gpu: receipt.environment.gpu ?? null, node: receipt.environment.node ?? null }
      : null,
    approvedBy: receipt.approval?.by ?? null,
    approvedAt: receipt.approval?.at ?? null,
    failure: receipt.failure ?? null,
    originalStatus: receipt.originalStatus ?? null,
    invalidation: receipt.invalidation ?? null,
  };
};

/**
 * The run ledger, newest first: runs/<runId>/receipt.json projected to the
 * summary the desk lists. A receipt that cannot be parsed is skipped, never
 * fatal. Capped at 500 (a row is ~1KB; the desk reads the whole record).
 * @param {string} [root]
 * @param {number} [limit]
 * @returns {Promise<Array<object>>}
 */
// impure (filesystem reads)
export const listRuns = async (root = harnessRoot(), limit = RUN_CAP) => {
  let entries;
  try {
    entries = await readdir(resolveInside(root, 'runs'), { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const s = await stat(resolveInside(root, 'runs', entry.name, 'receipt.json'));
      dirs.push({ id: entry.name, mtimeMs: s.mtimeMs });
    } catch { /* no receipt here — an in-flight or abandoned run dir */ }
  }
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const cap = Math.max(1, Math.min(RUN_CAP, Number.isInteger(limit) ? limit : RUN_CAP));
  const rows = [];
  for (const dir of dirs.slice(0, cap)) {
    try {
      const receipt = await readRunReceipt(root, dir.id); // an invalidated run reads failed
      rows.push(projectRunRow(receipt, dir.id));
    } catch { /* a corrupt receipt is skipped, not surfaced as a crash */ }
  }
  return rows;
};
