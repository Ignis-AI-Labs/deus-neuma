/**
 * Wake with this computer (ruling, 2026-10-18): the House Clock's residency
 * switch — its words, when the first charter approval switches it on (said
 * beside APPROVE before the press, never silent), what a switch that failed
 * says, the header and the charter as rendered, and the login entry
 * relaunching THIS app, never bare Electron — an AppImage's own file, never
 * the temporary mount it runs from, kept current when an update renames it
 * (the real entry on a temp home's real disk).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { residencySwitch, wakesOnApproval, residencyOutcome, RESIDENCY_LINE, APPROVE_WAKES_NOTE } from '../../frontend/app/RelinkShell/house-clock/residency-view.js';
import { HouseClockBody } from '../../frontend/app/RelinkShell/house-clock/HouseClockBody.jsx';
import { normalizeCharter } from '../../backend/services/house-clock/charter-shape.js';

const { launchCommand, desktopEntry, setResident, isResident, refreshResidency, execProgram } = createRequire(import.meta.url)('../../electron/residency.cjs');

const pending = normalizeCharter({ goal: 'Ship one digest a week.', seats: [{ laneId: 'optio', dailyCap: 4 }] });
const body = (props) => renderToStaticMarkup(createElement(HouseClockBody, {
  charter: pending, readiness: { ground: '/house', optio: 'optio' }, tab: 'charter', history: [], asks: [], names: {}, onTab: () => {}, ...props,
}));

describe('the switch, in words', () => {
  it('names its state; a browser (no desk app) shows none', () => {
    expect(residencySwitch({ available: true, on: true })).toMatchObject({ label: 'WAKE WITH THIS COMPUTER: ON', on: true });
    expect(residencySwitch({ available: true, on: false })).toMatchObject({ label: 'WAKE WITH THIS COMPUTER: OFF', on: false });
    expect(residencySwitch({ available: false, on: null })).toBeNull();
    expect(residencySwitch({ available: true, on: null })).toBeNull(); // not read yet: nothing claimed
  });
  it('the first approval switches it on — only on a desk app, only if off, only once', () => {
    expect(wakesOnApproval({ available: true, on: false, offered: false })).toBe(true);
    expect(wakesOnApproval({ available: true, on: true, offered: false })).toBe(false);
    expect(wakesOnApproval({ available: true, on: false, offered: true })).toBe(false);
    expect(wakesOnApproval({ available: false, on: null, offered: false })).toBe(false);
  });
});

describe('a switch that failed is said, and the first approval\'s switch is not spent', () => {
  it('a refused write names its reason; a change the computer did not take says what stands; one that took says nothing', () => {
    const failed = residencyOutcome(true, { failure: 'EACCES: permission denied, open \'/home/op/.config/autostart/neuma.desktop\'' });
    expect(failed).toEqual({ on: undefined, took: false, error: expect.stringContaining('Could not set Deus Neuma to start with this computer: EACCES') });
    expect(residencyOutcome(true, { on: false })).toEqual({ on: false, took: false, error: 'This computer did not take the change: Deus Neuma will not start when you log in.' });
    expect(residencyOutcome(false, { on: true }).error).toContain('Deus Neuma still starts when you log in');
    expect(residencyOutcome(true, { on: true })).toEqual({ on: true, took: true, error: null });
  });
  it('the head shows the failure', () => {
    const { error } = residencyOutcome(true, { failure: 'EACCES' });
    expect(body({ residency: { available: true, on: false }, error })).toContain('Could not set Deus Neuma to start with this computer: EACCES.');
  });
});

describe('as the operator sees it', () => {
  it('the header shows the switch and that the house wakes only while Deus Neuma runs', () => {
    const html = body({ residency: { available: true, on: false } });
    expect(html).toContain('WAKE WITH THIS COMPUTER: OFF');
    expect(html).toContain(RESIDENCY_LINE);
    expect(body({ residency: { available: false, on: null } })).not.toContain('WAKE WITH THIS COMPUTER');
  });
  it('beside APPROVE, the note says approving starts Deus Neuma with the computer — before the press', () => {
    expect(body({ residency: { available: true, on: false, approveNote: APPROVE_WAKES_NOTE } })).toContain(APPROVE_WAKES_NOTE);
    expect(body({ residency: { available: true, on: true, approveNote: null } })).not.toContain(APPROVE_WAKES_NOTE);
  });
});

describe('the login entry relaunches this app', () => {
  it('a packaged build is its own binary, quoted where the Desktop Entry spec needs it; a development launch carries the app folder', () => {
    const linux = { platform: 'linux' };
    expect(launchCommand({ execPath: '/opt/neuma/deus-neuma', defaultApp: false, appPath: '/opt/x', ...linux })).toBe('/opt/neuma/deus-neuma --ozone-platform=x11');
    expect(launchCommand({ execPath: '/opt/Deus Neuma/deus-neuma', defaultApp: false, appPath: '/opt/x', ...linux }))
      .toBe('"/opt/Deus Neuma/deus-neuma" --ozone-platform=x11');
    expect(execProgram(desktopEntry('"/opt/Deus Neuma/deus-neuma" --ozone-platform=x11'))).toBe('/opt/Deus Neuma/deus-neuma');
    expect(launchCommand({ execPath: '/repo/node_modules/electron/dist/electron', defaultApp: true, appPath: '/repo', ...linux }))
      .toBe('/repo/node_modules/electron/dist/electron /repo --ozone-platform=x11');
    expect(desktopEntry('/repo/node_modules/electron/dist/electron /repo')).toContain('Exec=/repo/node_modules/electron/dist/electron /repo\n');
  });

  it('on Linux the entry keeps the desk on X11 (Electron 44 cannot choose it after launch); no other OS gets the flag', () => {
    const packaged = { execPath: '/opt/neuma/deus-neuma', defaultApp: false, appPath: '/opt/x' };
    expect(launchCommand({ ...packaged, appImage: '/home/op/Deus-Neuma.AppImage', platform: 'linux' }))
      .toBe('/home/op/Deus-Neuma.AppImage --ozone-platform=x11');
    expect(launchCommand({ ...packaged, platform: 'darwin' })).toBe('/opt/neuma/deus-neuma');
    expect(launchCommand({ ...packaged, platform: 'win32' })).toBe('/opt/neuma/deus-neuma');
  });
});

describe.runIf(process.platform === 'linux')('the Linux login entry, on a real disk', () => {
  let home, saved;
  const entryFile = () => path.join(home, '.config', 'autostart', 'neuma.desktop');
  const appImage = (name) => {
    const file = path.join(home, 'My Apps', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
    return file;
  };
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'residency-home-'));
    saved = { HOME: process.env.HOME, APPIMAGE: process.env.APPIMAGE };
    process.env.HOME = home;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('an AppImage\'s entry starts its own file, quoted; an update renames it, and the entry follows', () => {
    process.env.APPIMAGE = appImage('Deus-Neuma-0.1.18.AppImage');
    expect(setResident(true)).toBe(true);
    expect(fs.readFileSync(entryFile(), 'utf8')).toContain(`Exec="${process.env.APPIMAGE}" --ozone-platform=x11\n`);
    // the updater moves the file to its new versioned name and deletes the old one
    const next = appImage('Deus-Neuma-0.1.19.AppImage');
    fs.unlinkSync(process.env.APPIMAGE);
    expect(isResident()).toBe(false); // the entry starts nothing now: the switch does not claim ON
    expect(refreshResidency({ appImage: next })).toBe(true);
    expect(execProgram(fs.readFileSync(entryFile(), 'utf8'))).toBe(next);
    expect(isResident()).toBe(true);
    process.env.APPIMAGE = next;
    expect(refreshResidency()).toBe(false); // current already: nothing rewritten
  });

  it('an entry an earlier build wrote at the temporary mount is repointed; one the operator wrote is never touched', () => {
    process.env.APPIMAGE = appImage('Deus-Neuma-0.1.18.AppImage');
    fs.mkdirSync(path.dirname(entryFile()), { recursive: true });
    fs.writeFileSync(entryFile(), desktopEntry('/tmp/.mount_NEUMA-a1B2c3/neuma').replace('X-Neuma-Managed=true\n', ''));
    expect(isResident()).toBe(false);
    expect(refreshResidency()).toBe(true);
    expect(execProgram(fs.readFileSync(entryFile(), 'utf8'))).toBe(process.env.APPIMAGE);
    const theirs = '[Desktop Entry]\nType=Application\nName=NEUMA\nExec=/home/op/bin/start-neuma\n';
    fs.writeFileSync(entryFile(), theirs);
    expect(refreshResidency()).toBe(false);
    setResident(true);
    expect(fs.readFileSync(entryFile(), 'utf8')).toBe(theirs);
  });

  it('an entry an Electron 33 build wrote without the display flag gains it at the next launch', () => {
    process.env.APPIMAGE = appImage('Deus-Neuma-0.1.30.AppImage');
    fs.mkdirSync(path.dirname(entryFile()), { recursive: true });
    fs.writeFileSync(entryFile(), desktopEntry(`"${process.env.APPIMAGE}"`));
    expect(refreshResidency()).toBe(true);
    expect(fs.readFileSync(entryFile(), 'utf8')).toContain(`Exec="${process.env.APPIMAGE}" --ozone-platform=x11\n`);
    expect(isResident()).toBe(true);
  });
});
