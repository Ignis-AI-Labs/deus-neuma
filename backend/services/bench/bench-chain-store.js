/**
 * bench-chain-store — A MATCHED SET OUTLIVES A DESK RELAUNCH (ruling, 2026-10-20).
 *
 * The chain lived in this process only. On 2026-10-20 another session
 * relaunched the house desk twice mid-arm: the arm ran on, but the new desk had
 * no record of the set, so its remaining arms would never launch. The chain is
 * now written to disk at every step, its arms run in their own session and
 * write their own journal, and a booting desk adopts a running set: it watches
 * the live arm by pid, reads its outcome from the sealed receipt (the exit code
 * died with the old desk), and launches the arms still to come.
 */

import { readFileSync } from 'node:fs';
import { open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('Bench');

/** pure — where a plane's chain record lives: beside its launch journals. */
export const chainStatePath = (logDir) => join(dirname(logDir), 'matched-chain.json');

/** impure — write the chain record atomically; a failed write is logged, never thrown. */
export const persistChain = async (path, record) => {
  try {
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(record, null, 2));
    await rename(tmp, path);
  } catch (err) {
    log.warn('matched chain record not written', { path, error: err.message });
  }
};

/** impure — the persisted chain record, or null. */
export const readPersistedChain = async (path) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
};

/** impure — is this pid still a live benchmark arm (never a recycled pid running something else)? */
export const pidIsArm = (pid) => {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); } catch { return false; }
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').includes('bench.mjs');
  } catch {
    return false;
  }
};

/** impure — resolve once the adopted arm has exited. */
export const waitForArmExit = async (pid, everyMs = 2000) => {
  while (pidIsArm(pid)) await new Promise((resolve) => { setTimeout(resolve, everyMs).unref?.(); });
};

/**
 * pure — an adopted arm's outcome, read from its sealed run: this comparison,
 * this arm, started no earlier than the chain launched it (an earlier stopped
 * attempt never stands in). No receipt reads as a failed arm, said plainly.
 */
export const sealedOutcome = (runs, { comparisonId, arm, armStartedAt }) => {
  const since = Date.parse(armStartedAt ?? '') || 0;
  const run = runs.find((r) => r.comparisonId === comparisonId && r.arm === arm
    && (Date.parse(r.startedAt ?? '') || 0) >= since - 60000);
  return {
    exitCode: null,
    signal: null,
    ok: run?.status === 'succeeded',
    adopted: true,
    ...(run ? { status: run.status } : { error: 'the arm ended while the desk was down and sealed no receipt' }),
  };
};

/** The harness's own words when a test run on the machine refuses an arm (benchmark-runner.js assertTestProcessesClear). */
export const TESTS_REFUSAL = 'test process is already running; benchmark refused';

/**
 * impure — did the harness refuse this arm only because a test run stood on
 * the machine? Read from the tail of the arm's own journal. A refusal is no
 * result: the set waits for a clear machine and runs the arm again.
 */
export const refusedForTests = async (logFile) => {
  if (!logFile) return false;
  let handle;
  try {
    handle = await open(logFile, 'r');
    const { size } = await handle.stat();
    const length = Math.min(size, 16384);
    const { buffer } = await handle.read(Buffer.alloc(length), 0, length, size - length);
    return buffer.toString('utf8').includes(TESTS_REFUSAL);
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
};
