import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { openBackendLog, logPaths, shouldRotate, MAX_BYTES } = require('../../electron/backend-log.cjs');
const { buildAppMenuTemplate } = require('../../electron/hotkeys.cjs');

/**
 * THE APP KEPT NO RECORD OF ITSELF (Design note, 2026-08-03.
 *
 * Four versions shipped for one community member while nobody could say what
 * his machine was doing:
 *
 *   […]
 *
 * The backend runs as a spawned child with `stdio: 'inherit'` — correct in dev,
 * where the operator has a terminal. In a packaged install launched from a
 * desktop icon or an AppImage there is no terminal, so every backend log line
 * went nowhere. Including the ones added THIS WEEK specifically to diagnose
 * this class of failure.
 *
 * Real directories, real files, real descriptors.
 */
describe('the packaged backend keeps a log', () => {
  let home;

  beforeEach(() => { home = mkdtempSync(path.join(os.tmpdir(), 'neuma-loghome-')); });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  test('a first run creates the lane and stamps it, so a pasted file says which run it is', () => {
    const opened = openBackendLog(home);
    expect(opened).not.toBeNull();
    closeSync(opened.fd);

    expect(existsSync(opened.path)).toBe(true);
    expect(opened.path).toBe(logPaths(home).current);
    const text = readFileSync(opened.path, 'utf8');
    expect(text).toMatch(/NEUMA backend log/);
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}T/);   // a real ISO stamp
  });

  test('THE RUN THAT FAILED SURVIVES: last run becomes .prev, not overwritten', () => {
    // The failure an operator reports is usually one launch old — they hit it,
    // quit, reopened, and only then went looking. Overwriting on start would
    // destroy the evidence at the exact moment they go to collect it.
    const first = openBackendLog(home);
    closeSync(first.fd);
    writeFileSync(first.path, 'THE RUN THAT BROKE\n');

    const second = openBackendLog(home);
    closeSync(second.fd);

    const { previous, current } = logPaths(home);
    expect(readFileSync(previous, 'utf8')).toMatch(/THE RUN THAT BROKE/);
    expect(readFileSync(current, 'utf8')).not.toMatch(/THE RUN THAT BROKE/);
  });

  test('the fd is real and writable — this is what stdio actually receives', () => {
    const opened = openBackendLog(home);
    const { writeSync } = require('node:fs');
    writeSync(opened.fd, 'a line the backend would have written\n');
    closeSync(opened.fd);
    expect(readFileSync(opened.path, 'utf8')).toMatch(/a line the backend would have written/);
  });

  test('an unwritable home returns null instead of throwing — the app still launches', () => {
    // A machine that cannot keep logs must still get an app. openBackendLog
    // returning null is what makes backend-spawn.cjs fall back to 'inherit'.
    const blocked = path.join(home, 'nope');
    mkdirSync(blocked);
    // A FILE where the .neuma directory needs to be: mkdirSync will fail.
    writeFileSync(path.join(blocked, '.neuma'), 'not a directory');
    expect(openBackendLog(blocked)).toBeNull();
  });

  test('the size cap is a decision, not a surprise truncation', () => {
    expect(shouldRotate(MAX_BYTES)).toBe(true);
    expect(shouldRotate(MAX_BYTES - 1)).toBe(false);
    expect(shouldRotate(NaN)).toBe(false);
    expect(shouldRotate(undefined)).toBe(false);
  });
});

describe('the operator can find the log without being told a path', () => {
  const actions = { 'desk.new': () => {}, 'desk.new-fresh': () => {} };

  test('a packaged run offers Help → Show diagnostic logs', () => {
    let clicked = false;
    const template = buildAppMenuTemplate({
      isMac: false, actions, onShowLogs: () => { clicked = true; },
    });
    const help = template.find((m) => m.label === 'Help');
    expect(help, 'a packaged app must expose its logs in the menu').toBeTruthy();
    const item = help.submenu.find((i) => /diagnostic logs/i.test(i.label));
    expect(item).toBeTruthy();
    item.click();
    expect(clicked).toBe(true);
  });

  test('a dev run shows NO Help entry — a menu item that opens nothing is worse than none', () => {
    const template = buildAppMenuTemplate({ isMac: false, actions });
    expect(template.find((m) => m.label === 'Help')).toBeUndefined();
  });

  test('the rest of the menu is untouched by the addition', () => {
    const template = buildAppMenuTemplate({ isMac: false, actions, onShowLogs: () => {} });
    expect(template.find((m) => m.label === 'File')).toBeTruthy();
    expect(template.some((m) => m.role === 'editMenu')).toBe(true);
    expect(template.some((m) => m.role === 'viewMenu')).toBe(true);
    expect(template.some((m) => m.role === 'windowMenu')).toBe(true);
  });
});
