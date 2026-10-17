/**
 * bench-machine — IS THE MACHINE CLEAR? The operator (2026-09-25): […]
 *
 * The harness refuses a run while any vitest/playwright process lives
 * (benchmarks/runtime/benchmark-runner.js assertTestProcessesClear, verified
 * 2026-09-25) — but only AFTER the arm spawned, so the desk used to learn it
 * as a bare "1 FAILED". This module runs the harness's OWN probe, the same
 * pgrep pattern byte for byte, so the desk's verdict and the harness's can
 * never disagree: /status carries it, and the launch plane refuses a long
 * verb up front while the machine is not clear.
 */

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { harnessRoot } from './bench-paths.js';

const execFileAsync = promisify(execFile);

// The harness's pattern, verbatim: executable/script tokens only, never
// incidental cache paths like PLAYWRIGHT_BROWSERS_PATH=…/ms-playwright.
export const TEST_PROCESS_PATTERN = '(^|[ /])(vitest|playwright)([ /.]|$)';

// The test door (the NEUMA_BENCH_* isolation idiom): the plane's own suites
// run INSIDE vitest, so the real pattern would always see them. They point
// the probe at a real marker process instead — the busy and clear verdicts
// are still judged by a real pgrep over the real process table.
const testProcessPattern = () => process.env.NEUMA_BENCH_TEST_PROCESS_PATTERN || TEST_PROCESS_PATTERN;

const COMMAND_CAP = 160;

/**
 * pure — `pgrep -af` stdout → [{pid, command}], commands capped so a shell
 * wrapper's whole eval line never floods the desk.
 * @param {string} stdout
 */
export const parseTestProcesses = (stdout) =>
  String(stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const space = line.indexOf(' ');
    const pid = Number(space === -1 ? line : line.slice(0, space));
    const command = space === -1 ? '' : line.slice(space + 1);
    return {
      pid,
      command: command.length > COMMAND_CAP ? `${command.slice(0, COMMAND_CAP - 1)}…` : command,
    };
  });

/**
 * The machine's verdict: clear, or the test processes standing on it.
 * pgrep exits 1 when nothing matches — that is the CLEAR answer, not an
 * error. Any other failure reads as unknown (clear: null), never as clear.
 * @returns {Promise<{clear: ?boolean, processes: Array<{pid: number, command: string}>, error?: string}>}
 */
// impure (reads the process table)
export const probeMachineClear = async () => {
  // ONE VERDICT: the harness's own runner test (benchmarks runtime/test-processes.js —
  // /proc cmdlines, argv[0] a runner executable AND a runner script among its args),
  // so the desk and the runner can never disagree. The test door keeps the pattern probe.
  if (!process.env.NEUMA_BENCH_TEST_PROCESS_PATTERN) {
    try {
      const { liveTestRunners } = await import(pathToFileURL(join(harnessRoot(), 'runtime/test-processes.js')).href);
      const found = await liveTestRunners();
      const processes = parseTestProcesses(found.join('\n'));
      return { clear: processes.length === 0, processes };
    } catch { /* a harness without that module: the desk's own probe below */ }
  }
  try {
    const { stdout } = await execFileAsync('pgrep', ['-af', testProcessPattern()], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const matched = parseTestProcesses(stdout);
    // A RUNNER, never a shell whose text merely names one: a command line like
    // `pgrep -af 'vitest|playwright'; node proof.mjs` matched the pattern and held
    // a launch on itself (2026-10-15). The process's own executable decides.
    const runners = await runnerPids(matched.map((p) => p.pid));
    const processes = matched.filter((p) => runners.has(p.pid));
    return { clear: processes.length === 0, processes };
  } catch (error) {
    if (error.code === 1) return { clear: true, processes: [] };
    return { clear: null, processes: [], error: error.message };
  }
};

// Executables that RUN tests — the harness's own list (runtime/test-processes.js).
export const RUNNER_EXECUTABLES = Object.freeze(['node', 'nodejs', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'vitest', 'playwright']);

// impure — which of these pids are runner executables, by argv[0] (as the harness
// reads it: /proc/<pid>/cmdline — comm can say MainThread); unreadable fails closed
const runnerPids = async (pids) => {
  const { readFile } = await import('node:fs/promises');
  const runners = new Set();
  await Promise.all(pids.map(async (pid) => {
    try {
      const argv0 = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0')[0].split(' ')[0];
      if (RUNNER_EXECUTABLES.includes(argv0.split('/').pop())) runners.add(pid);
    } catch (error) {
      if (error.code !== 'ENOENT') runners.add(pid); // vanished: gone; unreadable: a runner (fail closed)
    }
  }));
  return runners;
};
