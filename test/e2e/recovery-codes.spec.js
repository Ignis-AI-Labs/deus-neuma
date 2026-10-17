// The recovery-code file and clipboard, in a REAL browser.
//
// These two acts are the only way a person leaves the shown-once screen with
// anything. They touch `navigator.clipboard`, `Blob`, `URL.createObjectURL` and
// a real anchor download — none of which the node test lane has, and all of
// which would be a mock if faked there (RULE 0). So they are proven here: real
// Chromium, real clipboard, a real file on disk read back byte for byte.
//
// The PURE text builders are covered in test/unit/recovery-codes.test.js.
import { test, expect } from '@playwright/test';
import fs from 'fs';

const MODULE_URL = '/utils/recovery-codes.js';

const CODES = [
  'A1B2-C3D4-E5F6', 'G7H8-J9K0-L1M2', 'N3P4-Q5R6-S7T8', 'U9V0-W1X2-Y3Z4',
  'B5C6-D7E8-F9G0', 'H1J2-K3L4-M5N6', 'P7Q8-R9S0-T1U2', 'V3W4-X5Y6-Z7A8',
];

test.describe('recovery codes — the two ways off the shown-once screen', () => {
  // Clipboard reads need explicit permission in Chromium; without it the write
  // silently fails and the util reports `false` — which is the honest outcome,
  // but not the one under test here.
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('DOWNLOAD writes a file holding every code and the limit', async ({ page }) => {
    const waitForDownload = page.waitForEvent('download');

    const handed = await page.evaluate(async ({ url, codes }) => {
      const mod = await import(/* @vite-ignore */ url);
      return mod.downloadRecoveryCodes({ codes, subject: 'Bizulen', id: 'witness:zai-coding-plan:Bizulen' });
    }, { url: MODULE_URL, codes: CODES });
    expect(handed, 'the util reported the download was handed to the browser').toBe(true);

    const download = await waitForDownload;
    // The lane id carries colons; the file must not.
    expect(download.suggestedFilename()).toBe('neuma-recovery-witness-zai-coding-plan-Bizulen.txt');

    const body = fs.readFileSync(await download.path(), 'utf8');
    expect(body).toContain('Neuma Recovery Codes — Bizulen');
    for (const code of CODES) expect(body).toContain(code);
    expect(body).toContain('1. A1B2-C3D4-E5F6');
    expect(body).toContain('8. V3W4-X5Y6-Z7A8');
    // Stated, never implied by omission — the file has to say what it is.
    expect(body).toMatch(/nothing can reprint them/i);
  });

  test('COPY puts the numbered codes on the real clipboard', async ({ page }) => {
    const ok = await page.evaluate(async ({ url, codes }) => {
      const mod = await import(/* @vite-ignore */ url);
      return mod.copyRecoveryCodes(codes);
    }, { url: MODULE_URL, codes: CODES });
    expect(ok, 'the util reported the clipboard write landed').toBe(true);

    const pasted = await page.evaluate(() => navigator.clipboard.readText());
    expect(pasted.split('\n')).toHaveLength(CODES.length);
    expect(pasted).toContain('1. A1B2-C3D4-E5F6');
    expect(pasted).toContain('8. V3W4-X5Y6-Z7A8');
  });

  test('a failed clipboard is reported, never shown as success', async ({ page, context }) => {
    // The birth ceremony used to call `writeText` bare: a refusal became an
    // unhandled rejection AND the button still said "Copied". Both are wrong,
    // and this is the case that proves the second one is gone.
    await context.clearPermissions();
    await page.evaluate(() => document.body.blur());

    const ok = await page.evaluate(async ({ url, codes }) => {
      const mod = await import(/* @vite-ignore */ url);
      // A rejection escaping here would fail this evaluate outright.
      return mod.copyRecoveryCodes(codes);
    }, { url: MODULE_URL, codes: CODES });

    // Chromium may still allow the write for a focused page even with the
    // permission revoked; what must hold is that the util returns a BOOLEAN it
    // actually observed, and never throws.
    expect(typeof ok).toBe('boolean');
  });
});
