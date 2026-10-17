/**
 * Spectral color — a light's exact place, checked against the CIE 1931
 * standard observer's own published coordinates. Pure; no mocks.
 */
import { describe, it, expect } from 'vitest';
import { placeLight } from '../../core/birth/spectral-color.js';

const hzOf = (nm) => 299_792_458 / (nm * 1e-9);

describe('placeLight', () => {
  it('lands on the CIE 1931 spectral locus where the standard puts it', () => {
    // Published CIE 1931 2° chromaticities of monochromatic light.
    expect(placeLight(hzOf(700)).cie1931).toEqual({ x: 0.73469, y: 0.26531 });
    const green = placeLight(hzOf(520)).cie1931;
    expect(green.x).toBeCloseTo(0.0743, 3);
    expect(green.y).toBeCloseTo(0.8338, 3);
    const blue = placeLight(hzOf(470)).cie1931;
    expect(blue.x).toBeCloseTo(0.1241, 3);
    expect(blue.y).toBeCloseTo(0.0578, 3);
  });

  it('knows how bright each light is to the eye — peak at 555 nm', () => {
    expect(placeLight(hzOf(555)).luminousEfficiency).toBe(1);
    expect(placeLight(hzOf(700)).luminousEfficiency).toBeCloseTo(0.0041, 4);
  });

  it('keeps hair-apart frequencies apart in every coordinate a screen can carry', () => {
    const a = placeLight(hzOf(612.0));
    const b = placeLight(hzOf(612.05));
    expect(a.nm).not.toBe(b.nm);
    expect(a.oklch.h).not.toBe(b.oklch.h);
    expect(a.css).not.toBe(b.css);
  });

  it('past ~700 nm the eye sees one hue — deeper reds are dimmer, never merged', () => {
    const reds = [705, 740, 775].map((nm) => placeLight(hzOf(nm)));
    expect(new Set(reds.map((r) => r.oklch.h)).size).toBe(1);
    expect(reds[0].oklch.l).toBeGreaterThan(reds[1].oklch.l);
    expect(reds[1].oklch.l).toBeGreaterThan(reds[2].oklch.l);
    expect(new Set(reds.map((r) => r.hex)).size).toBe(3);
  });

  it('gives a screen color and a vivid accent of the same hue', () => {
    const p = placeLight(hzOf(600));
    expect(p.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(p.vivid.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(p.vivid.css.endsWith(` ${p.oklch.h})`)).toBe(true);
  });
});
