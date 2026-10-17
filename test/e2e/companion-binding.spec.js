// @ts-check
//
// Impure test module: drives a REAL chromium page (Rule 1 marker, file level).
import { test, expect } from '@playwright/test';

/**
 * F-01 gnosis — the window-first companion resolution contract, proven on
 * REAL browser storage (no jsdom, no mocks): the actual companion-data.js
 * module is imported into a live page served by the dev backend, and
 * sessionStorage / localStorage behave as the platform defines them.
 *
 *   1. the window's own binding wins — seed untouched, last-used ignored
 *   2. a spawn seed is consumed exactly once and FIXED as the binding
 *   3. last-used is only a fallback, and fixing it pins the window
 *   4. nothing resolvable -> null
 *
 * Requires the dev backend (:3355) — it statically serves /frontend/*, so
 * the real module loads under a real origin. Skips honestly when down.
 */

const ORIGIN = process.env.NEUMA_DEV_ORIGIN || 'http://127.0.0.1:3355';
const MODULE = '/frontend/utils/companion-data.js';

const up = await fetch(`${ORIGIN}/api/v1/health`).then((r) => r.ok).catch(() => false);

test.describe('per-window companion binding (real browser storage)', () => {
  test.skip(!up, `dev backend not running at ${ORIGIN}`);

  test('window binding wins; seed consumed once; last-used is only a seed', async ({ page }) => {
    await page.goto(`${ORIGIN}/api/v1/health`);
    const r = await page.evaluate(async (modPath) => {
      const mod = await import(modPath);
      const out = {};
      sessionStorage.clear();
      localStorage.clear();
      localStorage.setItem('walletAddress', '0xAbCd');

      // 1. window binding wins — the seed is NOT consumed, last-used ignored
      sessionStorage.setItem('0xabcd:neuma-window-companion', JSON.stringify({ name: 'Win' }));
      sessionStorage.setItem('neuma-companion-seed', JSON.stringify({ name: 'Seed' }));
      localStorage.setItem('0xabcd:neuma-companion', JSON.stringify({ name: 'Last' }));
      out.winFirst = mod.resolveBoundCompanion();
      out.seedSurvives = sessionStorage.getItem('neuma-companion-seed') !== null;

      // 2. spawn seed: consumed exactly once, fixed as the window binding
      sessionStorage.clear();
      sessionStorage.setItem('neuma-companion-seed', JSON.stringify({ name: 'Opener', neumaId: 'op-1' }));
      out.fromSeed = mod.resolveBoundCompanion();
      out.seedGone = sessionStorage.getItem('neuma-companion-seed') === null;
      out.fixedFromSeed = JSON.parse(sessionStorage.getItem('0xabcd:neuma-window-companion'));
      // ...and a LATER change to last-used cannot move this window
      localStorage.setItem('0xabcd:neuma-companion', JSON.stringify({ name: 'Moved' }));
      out.pinned = mod.resolveBoundCompanion();

      // 3. brand-new window: last-used seeds it, then pins it
      sessionStorage.clear();
      out.fromLast = mod.resolveBoundCompanion();
      out.fixedFromLast = JSON.parse(sessionStorage.getItem('0xabcd:neuma-window-companion'));

      // 4. nothing anywhere
      sessionStorage.clear();
      localStorage.clear();
      out.none = mod.resolveBoundCompanion();

      return out;
    }, MODULE);

    expect(r.winFirst).toEqual({ name: 'Win' });
    expect(r.seedSurvives).toBe(true);
    expect(r.fromSeed).toEqual({ name: 'Opener', neumaId: 'op-1' });
    expect(r.seedGone).toBe(true);
    expect(r.fixedFromSeed).toEqual({ name: 'Opener', neumaId: 'op-1' });
    expect(r.pinned).toEqual({ name: 'Opener', neumaId: 'op-1' });
    expect(r.fromLast).toEqual({ name: 'Moved' });
    expect(r.fixedFromLast).toEqual({ name: 'Moved' });
    expect(r.none).toBeNull();
  });
});
