/**
 * UX-002 (#215) — closing the window hides NEUMA, and until now nothing said so.
 *
 * The always-on design is correct: an approved post scheduled for 03:00 cannot
 * fire if closing a window kills the scheduler. What was missing is that hiding
 * is indistinguishable from quitting — and on Windows a new tray icon defaults
 * into the overflow flyout behind the `^` chevron, so the ONE exit affordance
 * sat where a first-run user has no reason to look.
 *
 * On 2026-07-30 an operator reported NEUMA closed twice, in good faith, while
 * it was serving HTTP on 47317 and holding a live filesystem tool surface.
 *
 * The menu builder is pure and is driven directly here (no Electron, same
 * doctrine as `hotkeys.test.js`). The Electron modules cannot be imported
 * outside an Electron runtime, so their half is asserted at source — the
 * defect there is the ABSENCE of a notice, which is a property of the text.
 * (SIZE-020: the close handler lives in desk-windows.cjs, the notice and the
 * tray in tray.cjs.)
 */
import fs from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { APP_HOTKEYS, buildAppMenuTemplate } = require('../../electron/hotkeys.cjs');

const actions = Object.fromEntries(APP_HOTKEYS.map((h) => [h.id, () => {}]));
const readDeskWindows = () => fs.readFile(path.join(process.cwd(), 'electron/desk-windows.cjs'), 'utf8');
const readTray = () => fs.readFile(path.join(process.cwd(), 'electron/tray.cjs'), 'utf8');

describe('the exit is reachable from a surface users already open', () => {
  it('the File menu carries a QUIT that says what it costs', () => {
    const file = buildAppMenuTemplate({ isMac: false, actions }).find((m) => m.label === 'File');
    const quit = file.submenu.find((i) => i.role === 'quit');
    expect(quit).toBeDefined();
    // Not a bare `role: 'quit'` — "Quit" beside a window that merely hides is
    // ambiguous, which is the whole bug.
    expect(quit.label).toMatch(/QUIT DEUS NEUMA/);
    expect(quit.label).toMatch(/beings/i);
  });

  it('macOS keeps `close` — its tray sits in the always-visible menu bar', () => {
    const file = buildAppMenuTemplate({ isMac: true, actions }).find((m) => m.label === 'File');
    expect(file.submenu.some((i) => i.role === 'close')).toBe(true);
    expect(file.submenu.some((i) => i.role === 'quit')).toBe(false);
  });
});

describe('the first close says where the app went', () => {
  it('the close handler announces, and still hides', async () => {
    const source = await readDeskWindows();
    // Anchor on the handler REGISTRATION, comma included — the notifications
    // doctrine comment quotes `win.on('close')` verbatim, and a bare anchor
    // silently slices the comment instead of the handler (it did at HEAD).
    const start = source.indexOf("win.on('close',");
    expect(start).toBeGreaterThan(-1);
    const handler = source.slice(start, source.indexOf('});', start));
    expect(handler).toContain('win.hide()');           // the always-on design is kept
    expect(handler).toContain('announceStillRunning'); // and it is no longer silent
  });

  it('the notice is once per install and persisted, not per session', async () => {
    const source = await readTray();
    expect(source).toMatch(/const trayNoticePath = .*getPath\('userData'\)/s);
    expect(source).toMatch(/const trayNoticeShown = /);
    expect(source).toMatch(/const markTrayNoticeShown = /);
    const fn = source.slice(source.indexOf('const announceStillRunning'));
    expect(fn.slice(0, 700)).toMatch(/if \(trayNoticeShown\(\)/);
  });

  it('it is marked BEFORE the balloon — a failed notice must not re-arm forever', async () => {
    const source = await readTray();
    const fn = source.slice(source.indexOf('const announceStillRunning'), source.indexOf('// The menu is REBUILT'));
    expect(fn.indexOf('markTrayNoticeShown()')).toBeLessThan(fn.indexOf('displayBalloon'));
  });

  it('nothing here can cost the close — every step is guarded', async () => {
    const source = await readTray();
    const region = source.slice(source.indexOf('const trayNoticePath'), source.indexOf('// The menu is REBUILT'));
    // existsSync, mkdir/write, and the balloon each sit under their own catch.
    expect((region.match(/catch/g) || []).length).toBeGreaterThanOrEqual(3);
    // displayBalloon is Windows/Linux only — guarded before it is called.
    expect(region).toMatch(/typeof tray\.displayBalloon === 'function'/);
  });

  it('the notice names the overflow chevron — where the icon actually hides', async () => {
    const source = await readTray();
    expect(source).toMatch(/\^ arrow by the clock/);
    expect(source).toMatch(/right-click it to QUIT/i);
  });

  it('the tray is reachable from the close handler (module scope, declared once)', async () => {
    const source = await readTray();
    expect((source.match(/^let tray = null;$/gm) || []).length).toBe(1);
  });
});
