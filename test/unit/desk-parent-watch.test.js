/**
 * DESK PARENT WATCH — the backend must not outlive the desk that spawned it.
 *
 * The regression this exists for, observed live on 2026-07-31: making the
 * backend its own process-group leader (#211, so quitting takes the MCP server
 * with it) meant the terminal's Ctrl-C no longer reached it. Electron died, the
 * backend kept running, port 47317 stayed held, and the next launch failed with
 * EADDRINUSE — reading as a port conflict rather than the truth, which is that
 * the last one never died (#215).
 *
 * Real timers, real intervals, no mocks: the clock and the parent pid are
 * injected as plain functions, so every assertion here is about behaviour
 * rather than about a spy having been called.
 */
import { describe, it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  isOrphaned, deskPidFrom, watchDeskParent, DESK_PID_ENV,
} from '../../backend/services/desk-parent-watch.js';

const settle = (ms) => new Promise((r) => { setTimeout(r, ms); });

describe('isOrphaned — FALSE is the safe answer', () => {
  it('says yes only when the parent genuinely changed', () => {
    expect(isOrphaned(4242, 1)).toBe(true);      // reparented to init
    expect(isOrphaned(4242, 1964)).toBe(true);   // reparented to systemd --user
    expect(isOrphaned(4242, 4242)).toBe(false);  // still ours
  });

  it('NEVER fires on an unreadable parentage — exiting wrongly kills a live desk', () => {
    // The cost of a false positive is a backend that stands down under a desk
    // that is still using it, taking that desk's beings with it. The cost of a
    // false negative is one stranded process. So every uncertainty is `false`.
    for (const bad of [null, undefined, NaN, 0, 1, -5, '4242', 1.5, {}]) {
      expect(isOrphaned(bad, 999), `deskPid=${String(bad)}`).toBe(false);
    }
    for (const bad of [null, undefined, NaN, 0, -1, '1', 1.5]) {
      expect(isOrphaned(4242, bad), `ppid=${String(bad)}`).toBe(false);
    }
  });

  it('a desk pid of 1 is not a desk — that is init, and we are already orphaned', () => {
    expect(isOrphaned(1, 1)).toBe(false);
  });
});

describe('deskPidFrom — was this backend spawned by a desk at all?', () => {
  it('reads the pid the desk stamped', () => {
    expect(deskPidFrom({ [DESK_PID_ENV]: '4242' })).toBe(4242);
  });

  it('a backend NOT spawned by a desk has no parent to outlive', () => {
    // `npm run dev:backend`, the test lane, CI — all of these must never watch.
    for (const env of [{}, null, undefined, { [DESK_PID_ENV]: '' }, { [DESK_PID_ENV]: 'abc' },
      { [DESK_PID_ENV]: '0' }, { [DESK_PID_ENV]: '1' }, { [DESK_PID_ENV]: '-3' }]) {
      expect(deskPidFrom(env), JSON.stringify(env)).toBeNull();
    }
  });
});

describe('watchDeskParent — the watch itself, on a real clock', () => {
  it('DOES NOT WATCH when no desk spawned this backend', () => {
    const stop = watchDeskParent({ onOrphaned: () => {}, env: {}, intervalMs: 5 });
    expect(stop).toBeNull();
  });

  it('stands down when the desk goes away', async () => {
    let ppid = 4242;
    const seen = [];
    const stop = watchDeskParent({
      onOrphaned: (pid) => seen.push(pid),
      env: { [DESK_PID_ENV]: '4242' },
      ppid: () => ppid,
      intervalMs: 5,
    });
    expect(stop).toBeTypeOf('function');

    await settle(30);
    expect(seen, 'must not fire while the desk is alive').toEqual([]);

    ppid = 1; // the desk died; the kernel reparented us
    await vi.waitFor(() => expect(seen).toEqual([4242]), { timeout: 1000 });
    stop();
  });

  it('STANDS DOWN ONCE, however long the shutdown takes', async () => {
    // A drain can outlast several intervals. Firing again mid-shutdown would
    // re-enter the exit path on a server already closing.
    let ppid = 4242;
    let fired = 0;
    const stop = watchDeskParent({
      onOrphaned: () => { fired += 1; },
      env: { [DESK_PID_ENV]: '4242' },
      ppid: () => ppid,
      intervalMs: 5,
    });
    ppid = 1;
    await vi.waitFor(() => expect(fired).toBe(1), { timeout: 1000 });
    await settle(40); // several more intervals would have passed
    expect(fired).toBe(1);
    stop();
  });

  it('a stopped watch never fires again', async () => {
    let ppid = 4242;
    let fired = 0;
    const stop = watchDeskParent({
      onOrphaned: () => { fired += 1; },
      env: { [DESK_PID_ENV]: '4242' },
      ppid: () => ppid,
      intervalMs: 5,
    });
    stop();
    ppid = 1;
    await settle(40);
    expect(fired).toBe(0);
  });

  it('refuses to watch without somewhere to report to', () => {
    expect(watchDeskParent({ env: { [DESK_PID_ENV]: '4242' } })).toBeNull();
  });

  it('THE WATCH NEVER HOLDS THE PROCESS OPEN — it watches an exit, it must not prevent one', async () => {
    // Proven by RUNNING it: a real node process that starts the watch and does
    // nothing else must exit immediately. An interval that was not unref'd
    // keeps the event loop alive, and this would hang for the full minute.
    // Asserting on the handle would prove nothing — only the exit does.
    const mod = pathToFileURL(new URL('../../backend/services/desk-parent-watch.js', import.meta.url).pathname).href;
    const source = `
      import { watchDeskParent } from ${JSON.stringify(mod)};
      watchDeskParent({
        onOrphaned: () => {},
        env: { NEUMA_DESK_PID: '4242' },
        ppid: () => 4242,
        intervalMs: 60000,
      });
    `;
    const started = process.hrtime.bigint();
    await new Promise((resolve, reject) => {
      const child = execFile(process.execPath, ['--input-type=module', '-e', source],
        { timeout: 15_000 }, (err) => (err ? reject(err) : resolve()));
      child.on('error', reject);
    });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(elapsedMs, 'the watch kept the process alive').toBeLessThan(10_000);
  }, 20_000);
});
