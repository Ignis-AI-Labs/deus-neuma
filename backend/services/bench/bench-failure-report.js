/**
 * bench-failure-report — the matched set's FAILURE REPORT: one markdown
 * block the operator copies straight into a repair conversation. The
 * operator (2026-09-25, on […]): […]
 *
 * The chain state knows only exit codes; the REASON lives in each arm's own
 * journal (the harness prints its refusal there — […], a stack, a gate verdict). So the report is the chain's facts plus
 * the tail of every arm that did not come back clean.
 *
 * Leaf module: reads chainStates() and the arm logs, never the launch plane.
 */

import { open } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chainStates } from './bench-matched.js';
import { benchLaunchLogDir } from './bench-paths.js';

const TAIL_BYTES = 12000;
const TAIL_LINES = 80;
// The harness colors its terminal output; a pasted report must read clean.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

const ARM_NAMES = Object.freeze({
  bare: 'BARE MODEL',
  platform: 'PLATFORM WIRE',
  harness: 'HARNESS',
  silo: 'SILO',
  neuma: 'FULL BEING',
});

/** pure — did this arm come back anything but clean (skipped arms never ran)? */
const armFailed = (outcome) => !outcome.skipped && !outcome.ok;

/** pure — m:ss (or h:mm:ss) from milliseconds; '?' when unknown. */
const clockText = (ms) => {
  if (!Number.isFinite(ms)) return '?';
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};

/** pure — the last TAIL_LINES lines of a log text, ANSI stripped, trimmed. */
export const tailText = (text) =>
  String(text ?? '').replace(ANSI_RE, '').trimEnd().split('\n').slice(-TAIL_LINES).join('\n');

/** pure — one arm's verdict words: exit code, signal, spawn error. */
const verdictText = (o) => {
  if (o.skipped) return 'skipped — never ran';
  if (o.ok) return 'clean';
  if (o.signal) return `stopped by ${o.signal}`;
  if (o.error) return `spawn failed — ${o.error}`;
  return `exit ${o.exitCode ?? '?'}`;
};

/**
 * The report text. Pure — the log tails arrive keyed by logFile.
 * @param {object} chain a chainStates() snapshot
 * @param {Record<string, string|null>} tails logFile → tail text (null = unreadable)
 * @returns {string} markdown
 */
export const buildFailureReport = (chain, tails = {}) => {
  const outcomes = chain.outcomes ?? [];
  const failed = outcomes.filter(armFailed);
  const lines = [
    `## BENCH FAILURE REPORT — ${chain.cell ?? '?'} · ${failed.length}/${chain.arms.length} arm${chain.arms.length === 1 ? '' : 's'} failed`,
    '',
    `- chain: ${chain.chainId} (${chain.state})`,
    `- comparison: ${chain.comparisonId ?? '?'}`,
    `- started: ${chain.startedAt ?? '?'} · finished: ${chain.finishedAt ?? '—'}`,
  ];
  if (chain.error) lines.push(`- chain error: ${chain.error}`);
  lines.push('', '### Arms');
  for (const arm of chain.arms) {
    const o = outcomes.find((x) => x.arm === arm);
    const mark = !o ? '·' : o.skipped ? '—' : o.ok ? '✓' : '✗';
    const verdict = o ? verdictText(o) : 'never reached';
    const time = o && !o.skipped ? ` · ${clockText(o.durationMs)}` : '';
    lines.push(`- ${mark} ${ARM_NAMES[arm] ?? arm} (${arm}) — ${verdict}${time}`);
  }
  for (const o of failed) {
    lines.push('', `### ✗ ${ARM_NAMES[o.arm] ?? o.arm} (${o.arm}) — ${verdictText(o)}`, `log: ${o.logFile ?? '—'}`);
    const tail = o.logFile ? tails[o.logFile] : null;
    lines.push('```text', tail ? tail : '(the log could not be read)', '```');
  }
  return lines.join('\n');
};

/**
 * The tail of one arm log, bounded to TAIL_BYTES. Refuses any path outside
 * the launch log dir — the path comes from server state, but a report read
 * must never become a file read of anything else. Null when unreadable.
 */
// impure (reads the filesystem)
const readLogTail = async (logFile) => {
  const root = resolve(benchLaunchLogDir()) + sep;
  const target = resolve(logFile);
  if (!target.startsWith(root)) return null;
  let handle;
  try {
    handle = await open(target, 'r');
    const { size } = await handle.stat();
    const length = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, size - length);
    return tailText(buf.toString('utf8'));
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
};

/**
 * The current chain's failure report, or null when no chain has run.
 * @returns {Promise<?{text: string, failedArms: string[], state: string}>}
 */
// impure (reads the arm logs)
export const readChainReport = async () => {
  const chain = chainStates();
  if (!chain) return null;
  const failed = chain.outcomes.filter(armFailed);
  const tails = {};
  for (const o of failed) {
    // sequential on purpose: at most four small reads
    if (o.logFile) tails[o.logFile] = await readLogTail(o.logFile);
  }
  return {
    text: buildFailureReport(chain, tails),
    failedArms: failed.map((o) => o.arm),
    state: chain.state,
  };
};
