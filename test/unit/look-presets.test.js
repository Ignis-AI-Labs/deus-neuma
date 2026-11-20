import { describe, test, expect } from 'vitest';
import { STOCK_PRESETS } from '../../frontend/utils/look-presets.js';
import { isValidLook, isSameLook, STOCK_LOOK } from '../../frontend/utils/look-derive.js';

// Pure data + pure functions — the shelf's own law, drift-proofed:
// every stock dress must be structurally valid, uniquely named, and
// READABLE (ink and trim must clear the ground by real luminance).

// WCAG relative luminance of a #RRGGBB hex. Pure.
const luminance = (hex) => {
  const lin = (i) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(0) + 0.7152 * lin(1) + 0.0722 * lin(2);
};

describe('look-presets.js', () => {
  test('every stock dress is a valid look', () => {
    for (const p of STOCK_PRESETS) {
      expect(isValidLook(p.theme), `${p.name} theme malformed`).toBe(true);
      expect(typeof p.id).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  test('ids and names are unique across the shelf', () => {
    const ids = STOCK_PRESETS.map((p) => p.id);
    const names = STOCK_PRESETS.map((p) => p.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  test('CYBERDECK is the stock look itself — choosing it must clear the override', () => {
    const deck = STOCK_PRESETS.find((p) => p.id === 'cyberdeck');
    expect(isSameLook(deck.theme, STOCK_LOOK)).toBe(true);
    expect(STOCK_PRESETS[0]).toBe(deck);
    expect(isSameLook(STOCK_PRESETS.find((p) => p.id === 'stone').theme, STOCK_LOOK)).toBe(false);
  });

  test('VOID keeps the original black-and-cyan dress whole, as a choice', () => {
    const voidPreset = STOCK_PRESETS.find((p) => p.id === 'void');
    expect(voidPreset.theme).toMatchObject({ ground: '#000000', panel: '#000000', ink: '#FFFFFF', trim: '#5FE9FF' });
    expect(isSameLook(voidPreset.theme, STOCK_LOOK)).toBe(false);
  });

  // Readable is CONTRAST (the lighter over the darker, as the eye takes it), not a gap in raw luminance: a gap rule
  // could not tell a mid-tone paper under black ink (perfectly readable) from a failure.
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  test('every dress reads: ink, trim, and claimed text voices clear the ground', () => {
    const need = { ink: 7, body: 7, emph: 7, ital: 4.5, head: 4.5, trim: 4.5, line: 3, alert: 4, warn: 4, okay: 4 };
    for (const { name, theme } of STOCK_PRESETS) {
      for (const [voice, least] of Object.entries(need)) {
        if (theme[voice]) expect(contrast(theme[voice], theme.ground), `${name} ${voice} on its ground`).toBeGreaterThanOrEqual(least);
      }
      // a panel is barely raised from the ground, never a second surface
      expect(Math.abs(luminance(theme.panel) - luminance(theme.ground)), `${name} panel vs ground`).toBeLessThan(0.1);
    }
  });

  test('every dress but stock CYBERDECK declares its full voice; the stock claims only its heading', () => {
    const voices = ['head', 'body', 'ital', 'emph', 'line', 'alert', 'warn', 'okay'];
    for (const p of STOCK_PRESETS) {
      if (p.id === 'cyberdeck') {
        expect(p.theme.head).toMatch(/^#[0-9A-F]{6}$/);
        for (const voice of voices.slice(1)) expect(p.theme[voice], `${p.name} ${voice}`).toBeUndefined();
      } else {
        for (const voice of voices) {
          expect(p.theme[voice], `${p.name} ${voice}`).toMatch(/^#[0-9A-F]{6}$/);
        }
      }
    }
  });


  test('within a dress the trim and the registers stay mutually distinct — a denial never wears the accent', () => {
    for (const { name, theme } of STOCK_PRESETS) {
      const voices = ['trim', 'alert', 'warn', 'okay'].map((k) => theme[k]).filter(Boolean);
      expect(new Set(voices).size, `${name} voices collide`).toBe(voices.length);
    }
  });
});

// The shelf's middle (Design note, 2026-11-16: […]).
describe('the soft dresses — dark without the pit, light without the glare', () => {
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const of = (tone) => STOCK_PRESETS.filter((p) => p.tone === tone);

  test('every dress has one of the four kinds, and each kind has dresses', async () => {
    const { PRESET_TONES } = await import('../../frontend/utils/look-presets.js');
    expect(PRESET_TONES).toEqual(['soft-dark', 'soft-light', 'deep-dark', 'bright-light']);
    for (const p of STOCK_PRESETS) expect(PRESET_TONES, p.name).toContain(p.tone);
    expect(PRESET_TONES.map((t) => of(t).length)).toEqual([7, 5, 14, 3]);
  });

  test('a soft dark is never a void: its ground is lifted off black and its ink is off white', () => {
    for (const { name, theme } of of('soft-dark').filter((p) => !['cyberdeck', 'stone'].includes(p.id))) {
      expect(luminance(theme.ground), `${name} ground`).toBeGreaterThan(0.015);
      expect(luminance(theme.ink), `${name} ink`).toBeLessThan(0.8);
      // comfortable to read for hours: well clear of the 7:1 that long text needs, well under black-on-white's 21:1
      expect(contrast(theme.body, theme.ground), `${name} body`).toBeGreaterThan(9);
      expect(contrast(theme.ink, theme.ground), `${name} ink`).toBeLessThan(13);
    }
  });

  test('a soft light is a MID tone, never a dimmed white: about half the light of a bright dress, and still readable', () => {
    // perceived lightness, 0 black to 100 white
    const lightness = (hex) => 116 * Math.cbrt(luminance(hex)) - 16;
    for (const { name, theme } of of('soft-light')) {
      expect(lightness(theme.ground), `${name} paper`).toBeLessThan(72);
      expect(lightness(theme.ground), `${name} paper`).toBeGreaterThan(60);
      expect(luminance(theme.ground), `${name} light put out`).toBeLessThan(0.55 * Math.min(...of('bright-light').map((p) => luminance(p.theme.ground))));
      expect(contrast(theme.body, theme.ground), `${name} body`).toBeGreaterThanOrEqual(7);
      expect(contrast(theme.trim, theme.ground), `${name} trim`).toBeGreaterThanOrEqual(4.5);
    }
    // the bright lights stay what they were: brighter than every soft one
    expect(Math.min(...of('bright-light').map((p) => luminance(p.theme.ground)))).toBeGreaterThan(Math.max(...of('soft-light').map((p) => luminance(p.theme.ground))));
  });
});
