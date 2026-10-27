// bounded-exec — an external command that always answers within its bound.
//
// WHY: `exec(cmd, { timeout })` runs through a shell, and on Windows its timeout
// kills only `cmd.exe`: a hung `nvidia-smi` or PowerShell beneath it lives on,
// orphaned, every time the first-run flight check reads the machine.
//
// Here the program is spawned directly (no shell), its whole process tree is
// killed at the deadline, and the promise settles AT the deadline whatever the
// pipes do. Every outcome is an answer, never a throw.
//
// impure (child processes).

import { spawn } from 'node:child_process';

const WIN = process.platform === 'win32';

// impure — kill a child and everything it started. Never throws.
const killTree = (child) => {
  try {
    if (WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL'); // the child leads its own process group
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
};

/**
 * Run a program with arguments; settle by the deadline no matter what. impure.
 * @param {string} file - the program (found on PATH), never a shell line
 * @param {string[]} args
 * @param {{timeoutMs: number, maxBytes?: number}} options
 * @returns {Promise<{ok: boolean, code: number|null, stdout: string, stderr: string, timedOut: boolean}>}
 */
export const boundedExec = (file, args, { timeoutMs, maxBytes = 1024 * 1024 }) => new Promise((resolve) => {
  let stdout = '';
  let stderr = '';
  let settled = false;
  let child;
  const settle = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(Object.freeze({ stdout, stderr, ...result }));
  };
  const timer = setTimeout(() => {
    if (child) {
      killTree(child);
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
    settle({ ok: false, code: null, timedOut: true });
  }, timeoutMs);
  try {
    child = spawn(file, args, { windowsHide: true, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    settle({ ok: false, code: null, timedOut: false });
    return;
  }
  child.stdout.on('data', (d) => { if (stdout.length < maxBytes) stdout += d; });
  child.stderr.on('data', (d) => { if (stderr.length < maxBytes) stderr += d; });
  child.on('error', () => settle({ ok: false, code: null, timedOut: false }));
  child.on('close', (code) => settle({ ok: code === 0, code, timedOut: false }));
});

/**
 * A promise, or the fallback once the deadline passes (the work is left to finish on its own). impure (timer).
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {T} fallback
 * @returns {Promise<T>}
 */
export const withDeadline = (promise, ms, fallback) => {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([Promise.resolve(promise).catch(() => fallback), deadline]).finally(() => clearTimeout(timer));
};
