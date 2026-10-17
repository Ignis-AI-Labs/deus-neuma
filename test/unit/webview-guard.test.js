/**
 * THE COMFY VIEWPORT — the embedded guest's privilege floor.
 *
 * The real `clampWebviewPreferences` against real inputs; no mock anywhere
 * (RULE 0). This is the function `will-attach-webview` applies in the MAIN
 * process, which is the only side whose word about a guest's sandboxing counts
 * — the renderer declares the <webview> tag and could declare it wrong.
 */
import { describe, test, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { clampWebviewPreferences } = require('../../electron/webview-guard.cjs');

const proposed = (extra = {}) => ({ preload: '/evil/preload.js', nodeIntegration: true, sandbox: false, ...extra });

describe('clampWebviewPreferences — the privilege floor', () => {
  test('strips the preload KEY, not merely its value', () => {
    const prefs = proposed();
    clampWebviewPreferences(prefs, { src: 'http://127.0.0.1:8190/' });
    // Electron reads the key's presence on some versions, so `preload: null`
    // would still count as a declared preload.
    expect('preload' in prefs).toBe(false);
    expect('preloadURL' in prefs).toBe(false);
  });

  test('forces the sandbox on regardless of what the renderer asked for', () => {
    const prefs = proposed();
    clampWebviewPreferences(prefs, { src: 'http://127.0.0.1:8190/' });
    expect(prefs).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });
  });

  test('allows the loopback engine', () => {
    for (const src of ['http://127.0.0.1:8190/', 'http://localhost:8190/', 'http://[::1]:8190/']) {
      expect(clampWebviewPreferences(proposed(), { src }).allow).toBe(true);
    }
  });

  test('refuses a remote origin — an embedded guest is never off-machine', () => {
    const verdict = clampWebviewPreferences(proposed(), { src: 'http://evil.example.com/' });
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toMatch(/loopback/);
  });

  test('refuses a non-http scheme — file:// would read the operator’s disk', () => {
    expect(clampWebviewPreferences(proposed(), { src: 'file:///etc/passwd' }).allow).toBe(false);
    expect(clampWebviewPreferences(proposed(), { src: 'data:text/html,<b>x' }).allow).toBe(false);
  });

  test('refuses a malformed or absent src rather than throwing into main', () => {
    expect(clampWebviewPreferences(proposed(), { src: 'not a url' }).allow).toBe(false);
    expect(clampWebviewPreferences(proposed(), {}).allow).toBe(false);
    expect(clampWebviewPreferences(proposed(), undefined).allow).toBe(false);
  });

  test('still clamps the preferences on a REFUSED attach', () => {
    // Defence in depth: if a later refactor ever ignores the verdict, the guest
    // it wrongly attaches is at least not privileged.
    const prefs = proposed();
    const verdict = clampWebviewPreferences(prefs, { src: 'http://evil.example.com/' });
    expect(verdict.allow).toBe(false);
    expect(prefs.sandbox).toBe(true);
    expect('preload' in prefs).toBe(false);
  });
});
