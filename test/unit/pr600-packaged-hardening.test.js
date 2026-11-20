import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildAppMenuTemplate, APP_HOTKEYS } = require('../../electron/hotkeys.cjs');
const { deskWebPreferences } = require('../../electron/desk-windows.cjs');

const actions = Object.fromEntries(APP_HOTKEYS.map(({ id }) => [id, () => {}]));

describe('packaged desk hardening', () => {
  test('the packaged menu has ordinary view controls but no DevTools role or accelerator', () => {
    const packaged = buildAppMenuTemplate({ isMac: false, isPackaged: true, actions });
    const serialized = JSON.stringify(packaged);
    expect(serialized).not.toContain('toggledevtools');
    expect(serialized).not.toContain('viewMenu');
    expect(serialized).toContain('reload');
    expect(serialized).toContain('togglefullscreen');

    const development = buildAppMenuTemplate({ isMac: false, isPackaged: false, actions });
    expect(JSON.stringify(development)).toContain('viewMenu');
  });

  test('real desk web preferences disable DevTools only for packaged mode', () => {
    expect(deskWebPreferences(1, true)).toMatchObject({ devTools: false, sandbox: true, nodeIntegration: false });
    expect(deskWebPreferences(1, false)).toMatchObject({ devTools: true, sandbox: true, nodeIntegration: false });
  });
});
