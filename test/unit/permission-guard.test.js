/**
 * The permission floor's verdicts, on real inputs (electron/permission-guard.cjs).
 * The live Electron proof is test/integration/electron-permission-guard.test.js;
 * this pins the cases a page cannot easily trigger there.
 */
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { deskPermissionVerdict, deskPermissionCheck, guestPermissionVerdict } = require('../../electron/permission-guard.cjs');

const DESK = 'http://127.0.0.1:3355';
const ask = (permission, extra = {}) => ({ permission, requestingUrl: `${DESK}/app`, deskOrigin: DESK, ...extra });

describe('permission floor', () => {
  test('the desk may capture its microphone, never a camera or the screen, and an unnamed capture is a no', () => {
    expect(deskPermissionVerdict(ask('media', { mediaTypes: ['audio'] }))).toBe(true);
    expect(deskPermissionVerdict(ask('media', { mediaTypes: ['audio', 'video'] }))).toBe(false);
    expect(deskPermissionVerdict(ask('media', { mediaTypes: ['video'] }))).toBe(false);
    expect(deskPermissionVerdict(ask('media'))).toBe(false);
    expect(deskPermissionVerdict(ask('display-capture'))).toBe(false);
  });

  test('the desk may write the clipboard and go fullscreen; everything else is refused', () => {
    expect(deskPermissionVerdict(ask('clipboard-sanitized-write'))).toBe(true);
    expect(deskPermissionVerdict(ask('fullscreen'))).toBe(true);
    for (const p of ['clipboard-read', 'geolocation', 'notifications', 'midiSysex', 'hid', 'serial', 'usb', 'openExternal', 'pointerLock']) {
      expect(deskPermissionVerdict(ask(p)), p).toBe(false);
    }
  });

  test('only the desk origin: another port, scheme or a lookalike host gets nothing', () => {
    for (const url of ['http://127.0.0.1:3356/', 'https://127.0.0.1:3355/', 'http://localhost:3355/', 'http://127.0.0.1:3355.evil.example/', 'file:///etc/passwd', 'not a url']) {
      expect(deskPermissionVerdict(ask('media', { requestingUrl: url, mediaTypes: ['audio'] })), url).toBe(false);
    }
  });

  test("the check lets the desk read its microphones' labels (the live voice picks by label), never a camera's", () => {
    expect(deskPermissionCheck(ask('media', { mediaTypes: ['audio'] }))).toBe(true);
    expect(deskPermissionCheck(ask('media'))).toBe(true);
    expect(deskPermissionCheck(ask('media', { mediaTypes: ['video'] }))).toBe(false);
    expect(deskPermissionCheck(ask('media', { requestingUrl: 'http://127.0.0.1:9/' }))).toBe(false);
  });

  test('the ComfyUI guest copies and goes fullscreen, and nothing else', () => {
    expect(guestPermissionVerdict({ permission: 'clipboard-sanitized-write' })).toBe(true);
    expect(guestPermissionVerdict({ permission: 'fullscreen' })).toBe(true);
    expect(guestPermissionVerdict({ permission: 'media' })).toBe(false);
    expect(guestPermissionVerdict({ permission: 'geolocation' })).toBe(false);
  });
});
