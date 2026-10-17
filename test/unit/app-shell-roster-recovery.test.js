/**
 * CQ-031 (#197) — the phase machine must never hang on a failed roster recovery.
 *
 * `AppShell` called `recoverRoster()` at three sites with no rejection handling.
 * Two of them are `await`ed inside the phase callbacks (`onGatewayComplete`,
 * `onBootDone`), so a throw meant `setPhase(...)` was never reached: the
 * operator sat on the surface they were leaving, with nothing anywhere saying
 * why. `recoverRoster` guards its own fetch, but the storage/merge half can
 * still throw — a quota error, a corrupt cached entry.
 *
 * A SOURCE assertion, deliberately. This file's sibling
 * (`roster-recovery.test.js`) states the convention: the pure decision is
 * tested directly and […] The guard here lives inside a React
 * component with no jsdom in this repo, and the defect is the ABSENCE of a
 * handler — a property of the text. What matters is that no call site quietly
 * loses it again.
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, test, expect } from 'vitest';

const SHELL = 'frontend/app/AppShell.jsx';
const read = () => fs.readFile(path.join(process.cwd(), SHELL), 'utf8');

describe('every roster recovery in AppShell settles both ways (#197)', () => {
  test('a guarded wrapper exists and catches', async () => {
    const source = await read();
    expect(source).toMatch(/const recoverRosterSafely = /);
    const body = source.slice(source.indexOf('const recoverRosterSafely'));
    expect(body.slice(0, 500)).toMatch(/catch\s*\(/);
  });

  test('the ONLY bare recoverRoster() call is the one inside the wrapper', async () => {
    const source = await read();
    const calls = [...source.matchAll(/(?<!Safely)\brecoverRoster\(\)/g)];
    // One call: `return await recoverRoster();` inside recoverRosterSafely.
    expect(calls).toHaveLength(1);
    const at = source.lastIndexOf('const recoverRosterSafely', calls[0].index);
    expect(at, 'the surviving bare call must be the wrapper’s own').toBeGreaterThan(-1);
    expect(calls[0].index - at).toBeLessThan(400);
  });

  test('every call site routes through the wrapper, each naming where it ran', async () => {
    const source = await read();
    const sites = [...source.matchAll(/recoverRosterSafely\('([a-z]+)'\)/g)].map((m) => m[1]);
    // 'remote': the native road's device-cookie trade (46c717dea) recovers too;
    // 'full': every entry into the full platform — sign-in, ENTER AS, back
    // from the harness door (the harness state reads no house)
    expect(sites.sort()).toEqual(['boot', 'full', 'mount', 'remote']);
  });

  test('sign-in enters through enterMode, which recovers the house before the full platform', async () => {
    const source = await read();
    const gateway = source.slice(source.indexOf('const onGatewayComplete ='));
    expect(gateway.slice(0, gateway.indexOf('}, ['))).toContain('setPhase(await enterMode(readEntryMode()))');
    const enter = source.slice(source.indexOf('const enterMode ='));
    const body = enter.slice(0, enter.indexOf('}, ['));
    expect(body).toMatch(/if \(mode === 'full'\)[\s\S]*await recoverRosterSafely\('full'\)[\s\S]*await enterAs\(mode\)/);
    // the socket speaks for one state — crossing re-links it (WebSocketService.relinkFor)
    expect(body).toContain('wsService.relinkFor?.(mode)');
  });

  test('the boot phase callback still reaches setPhase — the hang is what this fixes', async () => {
    const source = await read();
    for (const [cb, phase] of [['onBootDone', 'initialPhase']]) {
      const start = source.indexOf(`const ${cb} =`);
      expect(start, `${cb} must exist`).toBeGreaterThan(-1);
      const body = source.slice(start, source.indexOf('}, [', start));
      expect(body, `${cb} must await the GUARDED recovery`).toMatch(/await recoverRosterSafely\(/);
      expect(body, `${cb} must still set the phase`).toContain(`setPhase(${phase}()`);
    }
  });

  test('the failure is logged, not swallowed (Rule 3)', async () => {
    const source = await read();
    const body = source.slice(source.indexOf('const recoverRosterSafely'));
    expect(body.slice(0, 600)).toMatch(/console\.warn/);
    expect(body.slice(0, 600)).toMatch(/roster recovery failed/i);
  });
});
