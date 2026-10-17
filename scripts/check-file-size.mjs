#!/usr/bin/env node
/**
 * THE SIZE LAW — objective enforcement of AGENTS.md Rule 1 "No Monoliths".
 *
 * Design note, 2026-08-06, after finding a 9,092-line service: […] The prose rule was unenforceable, so this is the number and the
 * tripwire: 500 lines caps every hand-written file; 500–1,000 only with a
 * `SIZE EXCEPTION:` declaration in the file's header stating why subdivision
 * genuinely loses; over 1,000 forbidden. Generated artifacts, `archive/`,
 * look-dev specimens (`frontend/lookdev/index.html`, `look-dev/` — design
 * artifacts, not maintained app code) and markdown are exempt — the law
 * binds what hands maintain.
 *
 * THE RATCHET: offenders that predate the law are frozen at their recorded
 * size in `scripts/file-size-baseline.json`, shrink-only. Growing one is a
 * violation like crossing the cap. Shrinking one earns a `--write-baseline`
 * ratchet-down. The baseline only ever shrinks — new sins are never
 * grandfathered.
 *
 * Modes:
 *   node scripts/check-file-size.mjs                  scan tracked files; exit 1 on violations
 *   node scripts/check-file-size.mjs --init           bootstrap the baseline (one time)
 *   node scripts/check-file-size.mjs --write-baseline ratchet shrunk entries down / drop cured ones
 *   node scripts/check-file-size.mjs --hook           PostToolUse mode: judge the edited file, advisory only
 *   node scripts/check-file-size.mjs --verify-baseline re-measure every frozen entry; exit 1 on any drift
 *   node scripts/check-file-size.mjs --staged         judge staged files only (the pre-commit gate)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CAP = 500;
export const EXCEPTION_CAP = 1000;
const SOURCE_EXT = /\.(js|jsx|mjs|cjs|css|html|sh)$/;
const EXEMPT_PATHS = [/^archive\//, /^frontend\/sounds-baked\//, /^frontend\/lookdev\/index\.html$/, /^look-dev\//];
const GENERATED_MARK = /GENERATED FILE|@generated/i;
const EXCEPTION_MARK = /SIZE EXCEPTION:/;
const HEADER_CHARS = 2000;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'scripts', 'file-size-baseline.json');

/**
 * Line count the way the law reads it. Pure.
 * @param {string} content - Whole file text
 * @returns {number}
 */
export const countLines = (content) => {
  if (content === '') return 0;
  const lines = content.split('\n');
  return content.endsWith('\n') ? lines.length - 1 : lines.length;
};

/**
 * Is this path bound by the law at all? Pure.
 * @param {string} file - Repo-relative path
 * @returns {boolean}
 */
export const isBound = (file) => SOURCE_EXT.test(file) && !EXEMPT_PATHS.some((p) => p.test(file));

/**
 * The law's verdict on one file. Pure.
 * @param {{file: string, lines: number, header: string}} entry - Path, measured lines, first header chars
 * @param {Object<string, number>} baseline - Frozen offender sizes
 * @returns {{file: string, lines: number, verdict: string, frozen?: number}}
 */
export const judgeFile = ({ file, lines, header }, baseline) => {
  if (GENERATED_MARK.test(header)) return { file, lines, verdict: 'exempt-generated' };
  const frozen = baseline[file];
  if (frozen !== undefined) {
    if (lines > frozen) return { file, lines, frozen, verdict: 'grew-past-baseline' };
    if (lines < frozen) return { file, lines, frozen, verdict: 'shrunk' };
    return { file, lines, frozen, verdict: 'frozen' };
  }
  if (lines <= CAP) return { file, lines, verdict: 'ok' };
  if (lines <= EXCEPTION_CAP && EXCEPTION_MARK.test(header)) return { file, lines, verdict: 'declared-exception' };
  return { file, lines, verdict: lines > EXCEPTION_CAP ? 'over-hard-cap' : 'over-cap' };
};

export const isViolation = (verdict) => ['grew-past-baseline', 'over-cap', 'over-hard-cap'].includes(verdict);

/**
 * One line of judgment, human-readable. Pure.
 * @param {{file: string, lines: number, verdict: string, frozen?: number}} j - A judgeFile result
 * @returns {string}
 */
export const describeVerdict = (j) => {
  if (j.verdict === 'grew-past-baseline') return `${j.file}: ${j.lines} lines — GREW past its frozen ${j.frozen} (the ratchet is shrink-only)`;
  if (j.verdict === 'over-hard-cap') return `${j.file}: ${j.lines} lines — over the ${EXCEPTION_CAP} hard cap (forbidden; owes a decomposition issue)`;
  if (j.verdict === 'over-cap') return `${j.file}: ${j.lines} lines — over the ${CAP} cap with no SIZE EXCEPTION declared`;
  if (j.verdict === 'shrunk') return `${j.file}: ${j.lines} lines — shrunk below its frozen ${j.frozen}; ratchet it down with --write-baseline`;
  return `${j.file}: ${j.lines} lines — ${j.verdict}`;
};

// impure — read one file into a judgment input; null when unreadable
const measure = (file) => {
  try {
    const content = readFileSync(path.join(repoRoot, file), 'utf8');
    return { file, lines: countLines(content), header: content.slice(0, HEADER_CHARS) };
  } catch {
    return null;
  }
};

// impure — every tracked path the law binds
const boundFiles = () => execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter(isBound);

// impure — staged bound files only (the pre-commit gate: fast, never scans the tree)
const stagedFiles = () => execFileSync('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter(isBound);

// impure — the committed ratchet, or empty before --init
const readBaseline = () => {
  if (!existsSync(baselinePath)) return {};
  return JSON.parse(readFileSync(baselinePath, 'utf8'));
};

// impure — measure what Git will commit, including headers and the ratchet.
// Failed reads are fatal: skipping an index entry would silently bless a commit.
const indexText = (file) => execFileSync('git', ['show', `:${file}`], { cwd: repoRoot, encoding: 'utf8' });
const measureIndex = (file) => {
  const content = indexText(file);
  return { file, lines: countLines(content), header: content.slice(0, HEADER_CHARS) };
};
const readIndexBaseline = () => {
  const file = 'scripts/file-size-baseline.json';
  const present = execFileSync('git', ['ls-files', '--cached', '-z', '--', file], { cwd: repoRoot, encoding: 'utf8' });
  return present ? JSON.parse(indexText(file)) : {};
};

// impure
const writeBaseline = (baseline) => {
  const sorted = Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
};

// impure — judge the given files (default: every bound tracked file) against the ratchet
const scan = (files = boundFiles(), measureFile = measure, baseline = readBaseline()) => {
  return files.map(measureFile).filter(Boolean).map((m) => judgeFile(m, baseline));
};

const runInit = () => {
  if (existsSync(baselinePath)) {
    console.error(`refusing --init: ${baselinePath} exists — the baseline only ever shrinks`);
    process.exit(1);
  }
  const judged = scan().filter((j) => isViolation(j.verdict));
  writeBaseline(Object.fromEntries(judged.map((j) => [j.file, j.lines])));
  console.log(`baseline frozen: ${judged.length} offenders recorded shrink-only at ${path.relative(repoRoot, baselinePath)}`);
};

const runWriteBaseline = () => {
  const baseline = readBaseline();
  const judged = scan();
  const next = { ...baseline };
  for (const j of judged) {
    if (j.verdict !== 'shrunk') continue;
    if (j.lines <= CAP) delete next[j.file];
    else next[j.file] = j.lines;
  }
  for (const file of Object.keys(next)) {
    if (!judged.some((j) => j.file === file)) delete next[file]; // deleted or untracked — cured
  }
  writeBaseline(next);
  console.log(`ratchet written: ${Object.keys(next).length} files remain frozen`);
};

const runScan = (files, measureFile, baseline) => {
  const judged = scan(files, measureFile, baseline);
  const violations = judged.filter((j) => isViolation(j.verdict));
  const shrunk = judged.filter((j) => j.verdict === 'shrunk');
  for (const j of [...violations, ...shrunk]) console.log(describeVerdict(j));
  const scope = files ? 'staged files' : 'files';
  console.log(`${judged.length} ${scope} bound by the law — ${violations.length} violations, ${shrunk.length} ratchet-downs available`);
  process.exit(violations.length > 0 ? 1 : 0);
};

// impure — re-measure every frozen entry; the ratchet must record reality.
// Pure report, never mutates: drift fails loudly, correction stays behind
// the explicit --write-baseline.
const runVerifyBaseline = () => {
  const baseline = readBaseline();
  const drift = [];
  for (const [file, frozen] of Object.entries(baseline)) {
    const measured = measure(file);
    if (!measured) {
      drift.push(`${file}: frozen ${frozen} but file is GONE — run --write-baseline`);
      continue;
    }
    if (measured.lines !== frozen) drift.push(`${file}: frozen ${frozen} ≠ actual ${measured.lines}`);
  }
  for (const d of drift) console.log(d);
  console.log(`${Object.keys(baseline).length} frozen entries verified — ${drift.length} mismatches`);
  process.exit(drift.length > 0 ? 1 : 0);
};

// impure — PostToolUse mode: judge the one edited file, advise, never block
const runHook = async () => {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const filePath = JSON.parse(raw)?.tool_input?.file_path;
    if (!filePath) return;
    const rel = path.relative(repoRoot, path.resolve(filePath));
    if (rel.startsWith('..') || !isBound(rel)) return;
    const measured = measure(rel);
    if (!measured) return;
    const verdict = judgeFile(measured, readBaseline());
    if (isViolation(verdict.verdict) || verdict.verdict === 'shrunk') {
      console.log(`[size-law] ${describeVerdict(verdict)}`);
    }
  } catch {
    // A hook must never fail the edit it observes.
  }
};

const main = () => {
  const arg = process.argv[2];
  if (arg === '--hook') return runHook();
  if (arg === '--init') return runInit();
  if (arg === '--write-baseline') return runWriteBaseline();
  if (arg === '--verify-baseline') return runVerifyBaseline();
  if (arg === '--staged') return runScan(stagedFiles(), measureIndex, readIndexBaseline());
  return runScan();
};

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
