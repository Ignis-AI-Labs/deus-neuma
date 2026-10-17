import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { sanitizeLookTheme, readLookTheme } = require('../../electron/wallet/look-theme.cjs');

// Real tmp files, real disk — the reader is MAIN's own path to the look
// store; the requesting renderer never hands the trusted window a theme.

const THEME = { ground: '#2E2E2D', panel: '#C5303F', ink: '#FFFFFF', trim: '#B31414' };

describe('electron/wallet/look-theme.cjs', () => {
  test('sanitize accepts exactly the four knobs and uppercases', () => {
    expect(sanitizeLookTheme({ ground: '#0a0403', panel: '#160906', ink: '#fff3e9', trim: '#ff7a45' }))
      .toEqual({ ground: '#0A0403', panel: '#160906', ink: '#FFF3E9', trim: '#FF7A45' });
  });

  test('HEAD is optional in the trusted reader — strict when present, refused when junk', () => {
    expect(sanitizeLookTheme({ ...THEME, head: '#ffc9a3' })).toEqual({ ...THEME, head: '#FFC9A3' });
    expect(sanitizeLookTheme(THEME).head).toBeUndefined();
    expect(sanitizeLookTheme({ ...THEME, head: 'gold' })).toBeNull();
  });

  test('the registers pass the trusted reader — though the window never applies ALERT', () => {
    const out = sanitizeLookTheme({ ...THEME, alert: '#d42a5b', okay: '#3ecf8e' });
    expect(out.alert).toBe('#D42A5B');
    expect(out.okay).toBe('#3ECF8E');
    expect(sanitizeLookTheme({ ...THEME, warn: 42 })).toBeNull();
  });

  test('BODY, ITAL, EMPH, LINE pass the trusted reader', () => {
    const out = sanitizeLookTheme({ ...THEME, body: '#e8d5c4', ital: '#c9a27a', line: '#8a7a6a' });
    expect(out.body).toBe('#E8D5C4');
    expect(out.ital).toBe('#C9A27A');
    expect(out.line).toBe('#8A7A6A');
    expect(sanitizeLookTheme({ ...THEME, emph: 'bold' })).toBeNull();
  });


  test('sanitize refuses malformed shapes — anything less than four strict hexes is null', () => {
    for (const bad of [
      null, 'void', 42,
      { ...THEME, trim: 'red' },
      { ...THEME, ink: '#FFF' },
      { ...THEME, ground: undefined },
      { ground: '#000000' },
      { ...THEME, trim: '#B31414; background: url(x)' },
    ]) {
      expect(sanitizeLookTheme(bad)).toBeNull();
    }
  });

  test('readLookTheme reads a real store file and sanitizes it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'look-theme-'));
    const file = path.join(dir, 'look.json');
    fs.writeFileSync(file, JSON.stringify({ theme: THEME, presets: [] }));
    expect(readLookTheme(file)).toEqual(THEME);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('an absent, corrupt, or stock (null-theme) store reads as null — the window opens regardless', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'look-theme-'));
    const file = path.join(dir, 'look.json');
    expect(readLookTheme(path.join(dir, 'missing.json'))).toBeNull();
    fs.writeFileSync(file, '{not json');
    expect(readLookTheme(file)).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ theme: null, presets: [] }));
    expect(readLookTheme(file)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
