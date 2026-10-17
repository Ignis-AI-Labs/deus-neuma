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

  test('VOID is the stock look itself — choosing it must clear the override', () => {
    const voidPreset = STOCK_PRESETS.find((p) => p.id === 'void');
    expect(isSameLook(voidPreset.theme, STOCK_LOOK)).toBe(true);
  });

  test('every dress reads: ink, trim, and claimed text voices clear the ground', () => {
    for (const { name, theme } of STOCK_PRESETS) {
      const ground = luminance(theme.ground);
      expect(Math.abs(luminance(theme.ink) - ground), `${name} ink vs ground`).toBeGreaterThan(0.5);
      expect(Math.abs(luminance(theme.trim) - ground), `${name} trim vs ground`).toBeGreaterThan(0.25);
      expect(Math.abs(luminance(theme.panel) - ground), `${name} panel vs ground`).toBeLessThan(0.1);
      if (theme.head) {
        expect(Math.abs(luminance(theme.head) - ground), `${name} head vs ground`).toBeGreaterThan(0.3);
      }
      for (const voice of ['body', 'ital', 'emph']) {
        if (theme[voice]) {
          expect(Math.abs(luminance(theme[voice]) - ground), `${name} ${voice} vs ground`).toBeGreaterThan(0.3);
        }
      }
      if (theme.line) {
        expect(Math.abs(luminance(theme.line) - ground), `${name} line vs ground`).toBeGreaterThan(0.2);
      }
      for (const reg of ['alert', 'warn', 'okay']) {
        if (theme[reg]) {
          expect(Math.abs(luminance(theme[reg]) - ground), `${name} ${reg} vs ground`).toBeGreaterThan(0.25);
        }
      }
    }
  });

  test('every dress but stock VOID declares its full voice', () => {
    const voices = ['head', 'body', 'ital', 'emph', 'line', 'alert', 'warn', 'okay'];
    for (const p of STOCK_PRESETS) {
      if (p.id === 'void') {
        for (const voice of voices) expect(p.theme[voice], `${p.name} ${voice}`).toBeUndefined();
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
