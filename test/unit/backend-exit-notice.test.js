/**
 * A backend the system kills says so (audit desk-electron-bench, finding 13).
 * A child ended by a signal exits with code null — and the old exit handler
 * spoke only `if (code && …)`, so an OOM kill left the desk silent while every
 * being stopped answering. The (code, signal) pairs here come from REAL child
 * processes, ended for real (RULE 0); the notice is the pure module the exit
 * handler in backend-spawn.cjs asks.
 */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { backendExitNotice } = require('../../electron/backend-exit.cjs');

// impure — run a real child, end it as asked, and report how it exited.
const exitOf = (script, signal = null) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore' });
  child.once('error', reject);
  child.once('spawn', () => { if (signal) child.kill(signal); });
  child.once('exit', (code, sig) => resolve({ code, signal: sig }));
});

const IDLE = 'setInterval(() => {}, 1000)';

describe('backendExitNotice — the exit the operator is told about', () => {
  it('a SIGKILL (the OOM killer) exits with no code, and is named, with its likely cause', async () => {
    const { code, signal } = await exitOf(IDLE, 'SIGKILL');
    expect(code).toBeNull();
    expect(signal).toBe('SIGKILL');
    const notice = backendExitNotice(code, signal);
    expect(notice).toMatch(/stopped by the system \(SIGKILL\)/);
    expect(notice).toMatch(/ran out of memory/);
  });

  it('another signal is named without guessing a cause', async () => {
    const { code, signal } = await exitOf(IDLE, 'SIGTERM');
    expect(backendExitNotice(code, signal)).toBe('The local backend was stopped by the system (SIGTERM).');
  });

  it('a crash with an exit code reports the code', async () => {
    const { code, signal } = await exitOf('process.exit(3)');
    expect(backendExitNotice(code, signal)).toBe('The local backend stopped unexpectedly (exit 3).');
  });

  it('a clean exit is not a crash', async () => {
    const { code, signal } = await exitOf('process.exit(0)');
    expect(backendExitNotice(code, signal)).toBeNull();
  });
});
