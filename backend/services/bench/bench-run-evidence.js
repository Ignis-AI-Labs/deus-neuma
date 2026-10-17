/**
 * bench-run-evidence — WHAT HAPPENED inside one run, read-only (Founder,
 * 2026-09-26: […]).
 *
 * A receipt records every stage it executed (`executions`: command stage,
 * exit code, signal, timeout, abort, duration) and seals every log it kept as
 * an artifact (`artifacts`: kind stdout/stderr, a run-relative path, bytes,
 * sha256). This reads both: the stages as the receipt states them, and the
 * TAIL of each non-empty log — the lines a developer needs first. The
 * receipt goes through bench-receipt.js, so a struck run reads struck.
 *
 * Paths come only from the receipt's own artifact list and are resolved
 * inside the run's directory — a crafted run id or artifact path never
 * leaves the tree.
 */

import { open } from 'node:fs/promises';
import { harnessRoot, resolveInside } from './bench-paths.js';
import { readRunReceipt } from './bench-receipt.js';

export const RUN_ID_RE = /^[A-Za-z0-9-]+$/;
const LOG_KINDS = new Set(['stdout', 'stderr']);
const TAIL_BYTES = 12 * 1024;
const TAIL_LINES = 80;
// Terminal colour codes in a log are noise once it leaves the terminal.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** pure — a log text's last lines, colour codes stripped, a cut first line dropped. */
export const tailLines = (text, { cut = false, lines = TAIL_LINES } = {}) => {
  const all = String(text ?? '').replace(ANSI_RE, '').replace(/\r\n?/g, '\n').split('\n');
  if (cut) all.shift(); // the read began mid-line
  while (all.length && !all[all.length - 1].trim()) all.pop();
  return all.slice(-lines).join('\n');
};

/** pure — one execution as the desk shows it; the command's argv stays out. */
export const projectExecution = (e) => ({
  stage: e?.stage ?? '?',
  exitCode: Number.isInteger(e?.exitCode) ? e.exitCode : null,
  signal: e?.signal ?? null,
  durationMs: Number.isFinite(e?.durationMs) ? e.durationMs : null,
  timedOut: e?.timedOut === true,
  aborted: e?.aborted === true,
  ok: e?.exitCode === 0 && !e?.timedOut && !e?.aborted && !e?.signal,
});

// impure — the last TAIL_BYTES of a file.
const readTail = async (file, bytes) => {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    return { text: buf.toString('utf8'), cut: start > 0, size };
  } finally {
    await fh.close();
  }
};

/**
 * One run's evidence. Null when the run has no receipt.
 * impure (filesystem reads)
 * @param {string} runId
 * @param {string} [root]
 */
export const readRunEvidence = async (runId, root = harnessRoot()) => {
  if (!RUN_ID_RE.test(String(runId))) throw Object.assign(new Error('bad run id'), { code: 'BENCH_BAD_ID' });
  let receipt;
  try {
    receipt = await readRunReceipt(root, runId);
  } catch {
    return null;
  }
  const logs = [];
  for (const a of Array.isArray(receipt.artifacts) ? receipt.artifacts : []) {
    if (!LOG_KINDS.has(a?.kind) || typeof a.path !== 'string' || !(a.bytes > 0)) continue;
    try {
      const { text, cut, size } = await readTail(resolveInside(root, 'runs', runId, ...a.path.split('/')), TAIL_BYTES);
      logs.push({ kind: a.kind, path: a.path, bytes: size, tail: tailLines(text, { cut }), truncated: cut });
    } catch { /* a sealed log that is gone or outside the run is not evidence */ }
  }
  // stderr first — it is where a failing stage says why.
  logs.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'stderr' ? -1 : 1));
  return {
    runId,
    status: receipt.status ?? null,
    failure: receipt.failure ?? null,
    executions: (Array.isArray(receipt.executions) ? receipt.executions : []).map(projectExecution),
    logs,
  };
};
