// The hotkey legend must be honest: every renderer entry well-formed, the
// DESK group built from the REAL app-menu registry (electron/hotkeys.cjs —
// imported here as the drift sentinel: a row added there must render in the
// legend without anyone remembering to copy it), and the section itself
// proven through a real react-dom render — no mocks.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RENDERER_HOTKEYS,
  acceleratorKeys,
  appHotkeyEntries,
  legendGroups,
} from '../../frontend/services/hotkey-legend.js';
import { HotkeysSection } from '../../frontend/app/RelinkShell/HotkeysSection.jsx';
import { APP_HOTKEYS } from '../../electron/hotkeys.cjs';
// The engine initializes before render, exactly as main.jsx boots it — the
// section's heading/note come from the catalogs now (guarded for node:
// no document/window writes fire here).
import '../../frontend/i18n/index.js';

describe('RENDERER_HOTKEYS registry', () => {
  it('every group and entry is well-formed', () => {
    expect(RENDERER_HOTKEYS.length).toBeGreaterThan(0);
    for (const g of RENDERER_HOTKEYS) {
      expect(typeof g.group).toBe('string');
      expect(g.group.length).toBeGreaterThan(0);
      expect(g.entries.length).toBeGreaterThan(0);
      for (const e of g.entries) {
        expect(Array.isArray(e.keys)).toBe(true);
        expect(e.keys.length).toBeGreaterThan(0);
        for (const k of e.keys) expect(typeof k).toBe('string');
        expect(typeof e.does).toBe('string');
        expect(e.does.length).toBeGreaterThan(0);
      }
    }
  });

  it('no duplicate combo+hint within a group — one binding, one row', () => {
    for (const g of RENDERER_HOTKEYS) {
      const seen = g.entries.map((e) => `${e.keys.join('+')}|${e.hint || ''}`);
      expect(new Set(seen).size).toBe(seen.length);
    }
  });
});

describe('acceleratorKeys', () => {
  it('resolves CmdOrCtrl per platform', () => {
    expect(acceleratorKeys('CmdOrCtrl+Alt+N', 'darwin')).toEqual(['CMD', 'ALT', 'N']);
    expect(acceleratorKeys('CmdOrCtrl+Alt+N', 'linux')).toEqual(['CTRL', 'ALT', 'N']);
    expect(acceleratorKeys('CmdOrCtrl+Alt+Shift+N', 'win32')).toEqual(['CTRL', 'ALT', 'SHIFT', 'N']);
  });

  it('passes unknown tokens through uppercased — never censors a bound key', () => {
    expect(acceleratorKeys('Ctrl+PageDown', 'linux')).toEqual(['CTRL', 'PAGEDOWN']);
  });
});

describe('appHotkeyEntries — against the real app-menu registry', () => {
  it('every row of electron/hotkeys.cjs renders as a legend entry', () => {
    const entries = appHotkeyEntries(APP_HOTKEYS, 'linux');
    expect(entries.length).toBe(APP_HOTKEYS.length);
    for (const e of entries) {
      expect(e.keys.length).toBeGreaterThan(0);
      expect(e.does.length).toBeGreaterThan(0);
    }
  });

  it('drops malformed rows rather than rendering half-truths', () => {
    expect(appHotkeyEntries([{ id: 'x' }, null], 'linux')).toEqual([]);
    expect(appHotkeyEntries(undefined, 'linux')).toEqual([]);
  });
});

describe('legendGroups', () => {
  it('a browser tab gets renderer groups only — no DESK claims', () => {
    const groups = legendGroups(null, null);
    expect(groups.map((g) => g.group)).not.toContain('DESK');
    expect(groups.length).toBe(RENDERER_HOTKEYS.length);
  });

  it('a browser tab drops desktop-only keys (the browser keeps Ctrl+Shift+N); the shell shows them', () => {
    const newStream = (groups) => groups.flatMap((g) => g.entries).filter((e) => e.does === 'Open a new stream window.');
    expect(newStream(legendGroups(null, null))).toEqual([]);
    expect(newStream(legendGroups(APP_HOTKEYS, 'linux'))).toHaveLength(1);
  });

  it('inside the shell, DESK leads with the registry rows', () => {
    const groups = legendGroups(APP_HOTKEYS, 'linux');
    expect(groups[0].group).toBe('DESK');
    expect(groups[0].entries.length).toBe(APP_HOTKEYS.length);
    expect(groups[0].entries[0].keys).toEqual(['CTRL', 'ALT', 'N']);
  });
});

describe('HotkeysSection — real render', () => {
  it('renders the heading and every browser-honest renderer entry as key chips', () => {
    const html = renderToStaticMarkup(createElement(HotkeysSection));
    expect(html).toContain('HOTKEYS');
    for (const g of RENDERER_HOTKEYS) {
      expect(html).toContain(g.group.replace(/&/g, '&amp;'));
      for (const e of g.entries.filter((x) => !x.desktopOnly)) {
        for (const k of e.keys) expect(html).toContain(`>${k}</kbd>`);
        expect(html).toContain(e.does.replace(/'/g, '&#x27;'));
      }
    }
  });

  it('does not claim desk accelerators outside the desktop shell', () => {
    const html = renderToStaticMarkup(createElement(HotkeysSection));
    for (const row of APP_HOTKEYS) expect(html).not.toContain(row.description.replace(/'/g, '&#x27;'));
    expect(html).not.toContain('>ALT</kbd>');
    expect(html).not.toContain('DESK');
    expect(html).not.toContain('Open a new stream window.');
  });
});
