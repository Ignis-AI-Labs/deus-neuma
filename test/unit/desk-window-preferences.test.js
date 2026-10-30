// The desk window's own web preferences, read from the builder createWindow
// hands to BrowserWindow. Real function, real output; nothing in its path is
// replaced (the module loads outside Electron, the builder touches none of it).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { deskWebPreferences } = require('../../electron/desk-windows.cjs');
const { SLOT_ARG_PREFIX } = require('../../electron/desk-slots.cjs');

describe('a desk window opens locked down, never on Electron defaults', () => {
  it('isolates the page, grants no Node, keeps the sandbox and the same-origin policy', () => {
    expect(deskWebPreferences(1)).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
  });

  it('still loads the desk preload and names its slot for every desk', () => {
    for (const slot of [1, 2, 7]) {
      const prefs = deskWebPreferences(slot);
      expect(prefs.preload).toBe(path.resolve('electron/preload.cjs'));
      expect(prefs.additionalArguments).toEqual([`${SLOT_ARG_PREFIX}${slot}`]);
      expect(prefs.sandbox).toBe(true);
    }
  });
});
