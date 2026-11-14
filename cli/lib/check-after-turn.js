// THE CHECK AFTER A TURN — the operator names one command (their linter, their
// tests), and after any turn in which the being changed files the harness runs
// it. A pass is one line. A failure goes straight back to the being as its
// next turn, so it fixes what it broke before the operator has to look.
//
// Three things are deliberate:
//   1. THE COMMAND IS THE OPERATOR'S, AND ONLY THE OPERATOR SETS IT — by the
//      --check flag or by typing /check. It is never read from a file in the
//      project: a file the being can write must not be able to name a command
//      that runs.
//   2. IT RUNS AS THE OPERATOR, OUTSIDE THE BEING'S SANDBOX — the same as the
//      operator typing it. It runs whatever the project's files say, including
//      what the being just wrote. That is why it is off until asked for, and
//      why turning it on says so.
//   3. THE LOOP IS BOUNDED. At most CHECK_FIX_ROUNDS fix turns; it stops early
//      when a turn changes nothing (the being has given up or disagrees) or
//      when the operator interrupts.
//
// impure (child processes, fs stat, real turns through `runTurn`).

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const run = promisify(execFile);

/** Fix turns the being gets for one failing check before the harness hands it back. */
export const CHECK_FIX_ROUNDS = 3;
/** A check that has not answered by now is stopped and reported as failed. */
export const CHECK_TIMEOUT_MS = 10 * 60 * 1000;
/** The being is shown the END of the output: that is where a runner prints what failed. */
export const CHECK_OUTPUT_TAIL_CHARS = 12_000;

const WIN = process.platform === 'win32';

/**
 * Read the words after `/check`. Pure.
 * @param {string} argText
 * @returns {{ kind: 'show' } | { kind: 'off' } | { kind: 'set', command: string }}
 */
export const parseCheckArg = (argText) => {
  const text = String(argText || '').trim();
  if (!text) return { kind: 'show' };
  if (text === 'off') return { kind: 'off' };
  return { kind: 'set', command: text };
};

/**
 * A fingerprint of the work standing in the ground: every changed, new or
 * removed file git knows of, with its size and modification time. Two equal
 * fingerprints mean the turn between them changed nothing. Null where there is
 * no repository — then the caller cannot tell and runs the check every turn.
 * impure — operator's git (read-only), fs stat.
 * @param {string} ground
 * @returns {Promise<string|null>}
 */
export const workFingerprint = async (ground) => {
  let root;
  let listed;
  try {
    root = (await run('git', ['rev-parse', '--show-toplevel'], { cwd: ground })).stdout.trim();
    // The platform's own undo records are not the being's work.
    listed = (await run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', ':(exclude).neuma'],
      { cwd: root, maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch {
    return null;
  }
  const hash = createHash('sha256').update(listed);
  const entries = listed.split('\0').filter(Boolean);
  for (const entry of entries) {
    // "XY path" — a rename's second name arrives as its own bare entry; a stat
    // that misses (a deleted file, that bare name) simply adds nothing.
    const file = path.join(root, entry.slice(3));
    const st = await fs.stat(file).catch(() => null);
    if (st) hash.update(`${entry}:${st.size}:${st.mtimeMs}\n`);
  }
  return hash.digest('hex');
};

// impure — stop the check and everything it started. Never throws.
const killTree = (child) => {
  try {
    if (WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
};

/**
 * Run the operator's check in the ground. Every outcome is an answer, never a throw.
 * impure — a shell line, as the operator.
 * @param {string} command
 * @param {string} ground
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ passed: boolean, code: number|null, timedOut: boolean, output: string }>}
 */
export const runCheck = (command, ground, { timeoutMs = CHECK_TIMEOUT_MS } = {}) => new Promise((resolve) => {
  let output = '';
  let settled = false;
  const settle = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve({ ...result, output: output.slice(-CHECK_OUTPUT_TAIL_CHARS) });
  };
  let child;
  const timer = setTimeout(() => {
    if (child) killTree(child);
    settle({ passed: false, code: null, timedOut: true });
  }, timeoutMs);
  try {
    child = spawn(command, { shell: true, cwd: ground, detached: !WIN, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    output = error.message;
    settle({ passed: false, code: null, timedOut: false });
    return;
  }
  // Only the tail is kept, so a runner that prints megabytes costs no memory.
  const keep = (chunk) => { output = (output + chunk).slice(-CHECK_OUTPUT_TAIL_CHARS * 2); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('error', (error) => { output += error.message; settle({ passed: false, code: null, timedOut: false }); });
  child.on('close', (code) => settle({ passed: code === 0, code, timedOut: false }));
});

/**
 * The turn a failed check opens. Pure.
 * @param {string} command
 * @param {{ code: number|null, timedOut: boolean, output: string }} result
 * @returns {string}
 */
export const checkFailedPrompt = (command, result) => [
  result.timedOut
    ? `CHECK DID NOT FINISH — \`${command}\` was stopped after running too long, right after your changes.`
    : `CHECK FAILED — \`${command}\` exited ${result.code ?? 'without a code'} right after your changes.`,
  '',
  'This is the operator\'s own check, run on the real files. Read the output, find what your change '
  + 'broke, and fix it. If the failure is NOT from your change — it was already broken, or the check '
  + 'itself is wrong — say so plainly and change nothing: do not edit a test or a rule just to make it pass.',
  '',
  'The end of the output:',
  '```',
  result.output.trim() || '(the check printed nothing)',
  '```',
].join('\n');

/**
 * One turn, then the check, then fix turns while it fails.
 * impure — real turns, real check runs.
 * @param {object} opts
 * @param {string} opts.thought - the operator's turn
 * @param {string|null} opts.command - null/empty: just the turn
 * @param {string} opts.ground
 * @param {(thought: string) => Promise<void>} opts.runTurn
 * @param {(line: string) => void} opts.say - a line for the operator's terminal
 * @param {() => boolean} [opts.interrupted] - true when the operator stopped the last turn
 * @param {number} [opts.rounds]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ checks: number, outcome: 'off'|'unchanged'|'passed'|'failing'|'interrupted' }>}
 */
export const turnWithCheck = async ({
  thought, command, ground, runTurn, say, interrupted = () => false, rounds = CHECK_FIX_ROUNDS, timeoutMs,
}) => {
  if (!command) {
    await runTurn(thought);
    return { checks: 0, outcome: 'off' };
  }
  let next = thought;
  let checks = 0;
  for (let fixes = 0; ; fixes += 1) {
    const before = await workFingerprint(ground);
    await runTurn(next);
    if (interrupted()) return { checks, outcome: 'interrupted' };
    const after = await workFingerprint(ground);
    if (before !== null && before === after) {
      if (fixes > 0) say(`  ✗ check still failing and that turn changed nothing — over to you (${command})`);
      return { checks, outcome: fixes > 0 ? 'failing' : 'unchanged' };
    }
    say(`  · check: ${command}`);
    const result = await runCheck(command, ground, { timeoutMs });
    checks += 1;
    if (result.passed) {
      say('  ✓ check passed');
      return { checks, outcome: 'passed' };
    }
    const why = result.timedOut ? 'did not finish' : `failed (exit ${result.code ?? '?'})`;
    if (fixes >= rounds) {
      say(`  ✗ check ${why} — still failing after ${rounds} fix turn(s); over to you`);
      return { checks, outcome: 'failing' };
    }
    say(`  ✗ check ${why} — handing the output back (fix turn ${fixes + 1} of ${rounds})`);
    next = checkFailedPrompt(command, result);
  }
};
