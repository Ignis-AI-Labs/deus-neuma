// #268 — the read path must survive a full localStorage.
//
// This is an e2e spec and not a unit test on purpose, and the reason is the
// doctrine already written at the top of test/unit/roster-recovery.test.js: the
// impure shell is proven by crossing the real boundary, […] The defect here IS the boundary — a
// `localStorage.setItem` that throws — so a stubbed Storage object would prove
// only that the stub throws.
//
// So the quota is exhausted FOR REAL in a real Chromium, against the real
// `frontend/utils/companion-data.js`, and then the read path is called. Nothing
// is mocked: real browser, real Storage, real QuotaExceededError, real module.
//
// The defect: `getActiveCompanion()` runs an opportunistic migration write on
// every read, and `frontend/app/roster-recovery.js` returns
// `getActiveCompanion()` from its no-auth path, its non-ok path AND its fetch
// catch. A throw there escaped the recovery handler itself — the one place built
// to survive a bad backend could not survive a full disk.

import { test, expect } from '@playwright/test';

const MODULE = '/frontend/utils/companion-data.js';
const WALLET = '0xabcdef0123456789abcdef0123456789abcdef01';

// The REAL legacy key names, read from companion-data.js. Guessing them made an
// earlier version of this spec pass against the unguarded module: with a wrong
// base key the migration found nothing to copy, returned early, and never
// reached the write that was the whole defect.
const LEGACY = Object.freeze({
  companion: 'neuma-companion',
  roster: 'neuma-roster',
  birthTime: 'neuma-birth-time',
});

// Fill the store until the browser refuses even a FEW BYTES. Big chunks alone
// are not enough: after a 512KB write fails there is still room for a small
// one, so `setActiveCompanion({name:'TENEKOM'})` would quietly succeed and the
// "full store" would not be full for the value under test. Stepping the chunk
// size down drives the residual space to near-zero, which is the condition the
// defect actually describes.
//
// Injected into the page as source so both the standalone check and the
// module-loading evaluations use the exact same real fill.
const FILL_FN = `
  (() => {
    let wrote = 0, lastError = null;
    for (const size of [512 * 1024, 64 * 1024, 4 * 1024, 256, 16]) {
      const chunk = 'x'.repeat(size);
      for (let i = 0; i < 4000; i++) {
        try { localStorage.setItem('__fill_' + size + '_' + i, chunk); wrote++; }
        catch (err) { lastError = err.name; break; }
      }
    }
    return { wrote, lastError };
  })()
`;

const exhaustQuota = async (page) => page.evaluate(`(async () => ${FILL_FN})()`);

test.describe('companion-data read paths under a genuinely full localStorage', () => {
  test.beforeEach(async ({ page }) => {
    // A bare origin page — the module has no imports, so it needs nothing else.
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('the quota is real: the browser refuses before we test anything', async ({ page }) => {
    const { wrote, lastError } = await exhaustQuota(page);
    expect(lastError).toBe('QuotaExceededError');   // the real exception, not ours
    expect(wrote).toBeGreaterThan(0);
  });

  test('getActiveCompanion RETURNS instead of throwing when the store is full', async ({ page, baseURL }) => {
    const result = await page.evaluate(async ({ mod, wallet, fill, legacy }) => {
      // Legacy unscoped data present + a wallet connected = migration wanted.
      localStorage.setItem('walletAddress', wallet);
      localStorage.setItem(legacy.companion, JSON.stringify({ name: 'TENEKOM' }));
      localStorage.setItem(legacy.roster, JSON.stringify({ roster: [{ name: 'TENEKOM' }], witnesses: [] }));
      localStorage.setItem(legacy.birthTime, '2026-06-12T17:26:04.717Z');
      // eslint-disable-next-line no-eval -- the shared real fill, injected as source
      eval(fill);

      const { getActiveCompanion, getRoster, getWitnesses, getBirthTime } = await import(mod);
      const out = {};
      for (const [label, fn] of Object.entries({ getActiveCompanion, getRoster, getWitnesses, getBirthTime })) {
        try { out[label] = { threw: false, value: fn() }; } catch (err) { out[label] = { threw: true, error: err.name }; }
      }
      return out;
    }, { mod: `${baseURL}${MODULE}`, wallet: WALLET, fill: FILL_FN, legacy: LEGACY });

    // The claim: not one read path throws out of a full store.
    for (const [label, r] of Object.entries(result)) {
      expect(r.threw, `${label} threw ${r.error}`).toBe(false);
    }
    // And the reads still answer in their own shapes rather than exploding.
    expect(Array.isArray(result.getRoster.value)).toBe(true);
    expect(Array.isArray(result.getWitnesses.value)).toBe(true);
  });

  test('an explicit write still reports failure — only housekeeping swallows', async ({ page, baseURL }) => {
    const threw = await page.evaluate(async ({ mod, wallet, fill }) => {
      localStorage.setItem('walletAddress', wallet);
      // eslint-disable-next-line no-eval -- the shared real fill, injected as source
      eval(fill);
      const { setActiveCompanion } = await import(mod);
      try { setActiveCompanion({ name: 'TENEKOM' }); return false; } catch { return true; }
    }, { mod: `${baseURL}${MODULE}`, wallet: WALLET, fill: FILL_FN, legacy: LEGACY });

    // A caller that ASKED to persist deserves to hear that it failed. If this
    // ever returns false, the guard has spread from the read path to the writes.
    expect(threw).toBe(true);
  });

  test('a denied store (storage blocked entirely) is also survivable', async ({ page, baseURL }) => {
    // Not a stub of the module — the PAGE's own Storage is made hostile, exactly
    // as a browser with storage disabled presents it, then the real module runs.
    const result = await page.evaluate(async ({ mod, wallet, legacy }) => {
      localStorage.setItem('walletAddress', wallet);
      localStorage.setItem(legacy.companion, JSON.stringify({ name: 'TENEKOM' }));
      const { getActiveCompanion } = await import(mod);
      const boom = () => { const e = new Error('The operation is insecure.'); e.name = 'SecurityError'; throw e; };
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get: () => ({ getItem: boom, setItem: boom, removeItem: boom }),
      });
      try { return { threw: false, value: getActiveCompanion() }; } catch (err) { return { threw: true, error: err.name }; }
    }, { mod: `${baseURL}${MODULE}`, wallet: WALLET, legacy: LEGACY });

    expect(result.threw).toBe(false);
    expect(result.value).toBeNull();   // nothing readable is null, never a throw
  });
});
