// bounded-exec — an external command always answers within its bound. No mocks (RULE 0):
// real child processes, including one whose own child holds the output pipe open: it answers at
// the deadline and the whole tree is gone, never an orphan left running.
import process from 'node:process';
import { setTimeout as pause } from 'node:timers/promises';
import { describe, test, expect } from 'vitest';
import { boundedExec, withDeadline } from '../../backend/services/bounded-exec.js';

const node = process.execPath;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('boundedExec', () => {
  test('a command that finishes answers with its output', async () => {
    const r = await boundedExec(node, ['-e', 'process.stdout.write("hello")'], { timeoutMs: 10000 });
    expect(r).toMatchObject({ ok: true, code: 0, stdout: 'hello', timedOut: false });
  });

  test('a command that fails answers ok:false with its code', async () => {
    const r = await boundedExec(node, ['-e', 'process.exit(3)'], { timeoutMs: 10000 });
    expect(r).toMatchObject({ ok: false, code: 3, timedOut: false });
  });

  test('a program that does not exist answers, never throws', async () => {
    const r = await boundedExec('no-such-program-anywhere-7f3a', [], { timeoutMs: 2000 });
    expect(r).toMatchObject({ ok: false, timedOut: false });
  });

  test('a hung command whose own child holds the pipe answers at the deadline, and both are killed', async () => {
    const script = [
      "const { spawn } = require('child_process');",
      "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });",
      "process.stdout.write(String(g.pid) + '\\n');",
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const started = Date.now();
    const r = await boundedExec(node, ['-e', script], { timeoutMs: 700 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.timedOut).toBe(true);
    const grandchild = Number(r.stdout.trim());
    expect(grandchild).toBeGreaterThan(0);
    await pause(300);
    expect(alive(grandchild)).toBe(false);
  });
});

describe('withDeadline', () => {
  test('the value when it arrives in time, the fallback when it does not or fails', async () => {
    expect(await withDeadline(Promise.resolve(7), 1000, 0)).toBe(7);
    expect(await withDeadline(new Promise(() => {}), 50, 'late')).toBe('late');
    expect(await withDeadline(Promise.reject(new Error('x')), 1000, 'failed')).toBe('failed');
  });
});
