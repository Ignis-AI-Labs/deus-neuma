// Hotkey registry + app-menu builder (I-02b) — pure data and pure builders,
// no Electron, no mocks (GNOSIS-compatible).
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { APP_HOTKEYS, buildAppMenuTemplate } = require('../../electron/hotkeys.cjs');

const actions = Object.fromEntries(APP_HOTKEYS.map((h) => [h.id, () => {}]));

describe('APP_HOTKEYS registry', () => {
  it('declares the two New Window flavors with distinct accelerators', () => {
    const byId = Object.fromEntries(APP_HOTKEYS.map((h) => [h.id, h]));
    expect(byId['desk.new'].accelerator).toBe('CmdOrCtrl+Alt+N');
    expect(byId['desk.new-fresh'].accelerator).toBe('CmdOrCtrl+Alt+Shift+N');
    const accels = APP_HOTKEYS.map((h) => h.accelerator);
    expect(new Set(accels).size).toBe(accels.length);
  });

  it('is frozen — bindings change by editing the table, not by mutation', () => {
    expect(Object.isFrozen(APP_HOTKEYS)).toBe(true);
    expect(Object.isFrozen(APP_HOTKEYS[0])).toBe(true);
  });
});

describe('buildAppMenuTemplate', () => {
  it('renders every registry binding as a menu item with its accelerator', () => {
    const template = buildAppMenuTemplate({ isMac: false, actions });
    const file = template.find((m) => m.label === 'File');
    for (const hk of APP_HOTKEYS) {
      const entry = file.submenu.find((i) => i.id === hk.id);
      expect(entry).toBeDefined();
      expect(entry.accelerator).toBe(hk.accelerator);
      expect(entry.label).toBe(hk.label);
      expect(typeof entry.click).toBe('function');
    }
  });

  it('keeps the standard role menus (edit ops, reload, devtools, window)', () => {
    const template = buildAppMenuTemplate({ isMac: false, actions });
    const roles = template.map((m) => m.role).filter(Boolean);
    expect(roles).toEqual(expect.arrayContaining(['editMenu', 'viewMenu', 'windowMenu']));
  });

  it('adds the app menu on macOS only, and closes vs quits per platform', () => {
    const mac = buildAppMenuTemplate({ isMac: true, actions });
    const linux = buildAppMenuTemplate({ isMac: false, actions });
    expect(mac[0].role).toBe('appMenu');
    expect(linux[0].label).toBe('File');
    const last = (t) => t.find((m) => m.label === 'File').submenu.at(-1).role;
    expect(last(mac)).toBe('close');
    expect(last(linux)).toBe('quit');
  });

  it('throws LOUDLY on a binding with no action — a dead key is a lie', () => {
    expect(() => buildAppMenuTemplate({ isMac: false, actions: {} }))
      .toThrow(/no action/);
  });
});
