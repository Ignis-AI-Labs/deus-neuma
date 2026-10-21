/**
 * The diagnostic log is reachable from the tray (audit desk-electron-bench,
 * finding 12). On Windows and Linux the desk draws no menu bar, so the Help
 * menu's "Show diagnostic logs…" had no visible row to open it from; the tray
 * is the one surface that is always there. Pure template, real inputs, no
 * Electron (RULE 0).
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { trayMenuTemplate } = require('../../electron/tray-menu.cjs');

const open = () => 'open';
const quit = () => 'quit';
const showLogs = () => 'logs';

describe('the tray menu', () => {
  it('a packaged app lists SHOW DIAGNOSTIC LOGS, wired to the reveal', () => {
    const items = trayMenuTemplate({ open, showLogs, updateItems: [], quit });
    const logs = items.find((i) => i.label === 'SHOW DIAGNOSTIC LOGS');
    expect(logs).toBeDefined();
    expect(logs.click).toBe(showLogs);
  });

  it('a dev run, which keeps no log file, lists no log item', () => {
    const items = trayMenuTemplate({ open, showLogs: null, updateItems: [], quit });
    expect(items.some((i) => /LOG/.test(i.label || ''))).toBe(false);
  });

  it('OPEN leads, update items sit above QUIT, and QUIT is last', () => {
    const update = { label: 'RESTART TO UPDATE', click: () => {} };
    const labels = trayMenuTemplate({ open, showLogs, updateItems: [update], quit }).map((i) => i.label || i.type);
    expect(labels).toEqual(['OPEN DEUS NEUMA', 'SHOW DIAGNOSTIC LOGS', 'separator', 'RESTART TO UPDATE', 'QUIT DEUS NEUMA']);
  });
});
