import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createLookSettings, sanitizeTheme, sanitizePresetName, PRESET_CAP } from '../../backend/services/look-settings.js';

// Real tmp files, real disk — the factory is the production code path.

const THEME = { ground: '#0a0403', panel: '#160906', ink: '#fff3e9', trim: '#ff7a45' };

const make = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'look-settings-'));
  const file = path.join(dir, 'look.json');
  return { dir, file, store: createLookSettings({ path: file }) };
};

describe('look-settings.js', () => {
  test('an absent file reads as the stock dress — null theme, empty shelf', async () => {
    const { store } = make();
    expect(await store.read()).toEqual({ theme: null, presets: [] });
  });

  test('a set theme persists uppercased and is read back by a fresh instance', async () => {
    const { file, store } = make();
    const state = await store.setTheme(THEME);
    expect(state.theme).toEqual({ ground: '#0A0403', panel: '#160906', ink: '#FFF3E9', trim: '#FF7A45' });
    const reread = createLookSettings({ path: file });
    expect((await reread.read()).theme).toEqual(state.theme);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).theme.trim).toBe('#FF7A45');
  });

  test('setTheme(null) restores stock and survives re-read', async () => {
    const { store } = make();
    await store.setTheme(THEME);
    expect((await store.setTheme(null)).theme).toBeNull();
    expect((await store.read()).theme).toBeNull();
  });

  test('HEAD rides the store when present, stays absent when not, and refuses junk', async () => {
    const { store } = make();
    const withHead = await store.setTheme({ ...THEME, head: '#ffc9a3' });
    expect(withHead.theme.head).toBe('#FFC9A3');
    const without = await store.setTheme(THEME);
    expect(without.theme.head).toBeUndefined();
    await expect(store.setTheme({ ...THEME, head: 'gold' })).rejects.toMatchObject({ code: 'LOOK_INVALID_THEME' });
  });

  test('the registers ride the store like HEAD — optional, strict, releasable', async () => {
    const { store } = make();
    const claimed = await store.setTheme({ ...THEME, alert: '#d42a5b', warn: '#E0A34D', okay: '#3ecf8e' });
    expect(claimed.theme.alert).toBe('#D42A5B');
    expect(claimed.theme.okay).toBe('#3ECF8E');
    const released = await store.setTheme(THEME);
    expect(released.theme.alert).toBeUndefined();
    await expect(store.setTheme({ ...THEME, warn: 'amber' })).rejects.toMatchObject({ code: 'LOOK_INVALID_THEME' });
  });

  test('BODY, ITAL, EMPH, LINE ride the store like HEAD', async () => {
    const { store } = make();
    const claimed = await store.setTheme({
      ...THEME, body: '#e8d5c4', ital: '#c9a27a', emph: '#fff4e8', line: '#8a7a6a',
    });
    expect(claimed.theme.body).toBe('#E8D5C4');
    expect(claimed.theme.ital).toBe('#C9A27A');
    expect(claimed.theme.emph).toBe('#FFF4E8');
    expect(claimed.theme.line).toBe('#8A7A6A');
    const released = await store.setTheme(THEME);
    expect(released.theme.body).toBeUndefined();
    await expect(store.setTheme({ ...THEME, ital: 'gold' })).rejects.toMatchObject({ code: 'LOOK_INVALID_THEME' });
  });


  test('a malformed theme is refused with LOOK_INVALID_THEME', async () => {
    const { store } = make();
    for (const bad of [
      { ...THEME, trim: 'red' },
      { ...THEME, ink: '#FFF' },
      { ground: '#000000' },
      'void',
      42,
    ]) {
      await expect(store.setTheme(bad)).rejects.toMatchObject({ code: 'LOOK_INVALID_THEME' });
    }
  });

  test('presets round-trip: add lands on the shelf, remove clears it', async () => {
    const { store } = make();
    const added = await store.addPreset('  Dusk Study  ', THEME);
    expect(added.presets).toHaveLength(1);
    expect(added.presets[0].name).toBe('Dusk Study');
    expect(added.presets[0].theme.ground).toBe('#0A0403');
    const removed = await store.removePreset(added.presets[0].id);
    expect(removed.presets).toEqual([]);
  });

  test('a preset name sheds control characters; an empty result is refused', async () => {
    const bell = String.fromCharCode(7);
    expect(sanitizePresetName(`a${bell}b`)).toBe('ab');
    expect(sanitizePresetName(bell)).toBeNull();
    expect(sanitizePresetName('x'.repeat(80))).toHaveLength(40);
    const { store } = make();
    await expect(store.addPreset(bell, THEME)).rejects.toMatchObject({ code: 'LOOK_INVALID_NAME' });
    await expect(store.addPreset('ok', { bad: true })).rejects.toMatchObject({ code: 'LOOK_INVALID_THEME' });
  });

  test('the shelf caps at PRESET_CAP', async () => {
    const { store } = make();
    for (let i = 0; i < PRESET_CAP; i += 1) await store.addPreset(`dress ${i}`, THEME);
    await expect(store.addPreset('one too many', THEME)).rejects.toMatchObject({ code: 'LOOK_PRESET_CAP' });
  });

  test('removing an unknown preset is an honest refusal, not a silent no-op', async () => {
    const { store } = make();
    await expect(store.removePreset('ghost')).rejects.toMatchObject({ code: 'LOOK_UNKNOWN_PRESET' });
  });

  test('a corrupt or hand-mangled file reads as stock and drops junk presets', async () => {
    const { file, store } = make();
    fs.writeFileSync(file, '{not json');
    expect(await store.read()).toEqual({ theme: null, presets: [] });
    fs.writeFileSync(file, JSON.stringify({
      theme: { ground: 'black', panel: '#000000', ink: '#FFFFFF', trim: '#5FE9FF' },
      presets: [
        { id: 'ok', name: 'Kept', theme: THEME },
        { id: 42, name: 'bad id', theme: THEME },
        { id: 'no-theme', name: 'bad theme', theme: { trim: 'red' } },
        'garbage',
      ],
    }));
    const state = await store.read();
    expect(state.theme).toBeNull();
    expect(state.presets.map((p) => p.name)).toEqual(['Kept']);
  });

  test('sanitizeTheme normalizes case and refuses extra-typed values', () => {
    expect(sanitizeTheme(THEME)).toEqual({ ground: '#0A0403', panel: '#160906', ink: '#FFF3E9', trim: '#FF7A45' });
    expect(sanitizeTheme({ ...THEME, trim: null })).toBeNull();
    expect(sanitizeTheme(null)).toBeNull();
  });
});
