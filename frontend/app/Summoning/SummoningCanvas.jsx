// SummoningCanvas — THE SUMMONING on one canvas: paints paintAt(score, t)
// whenever t changes, fitted to its box at the device's pixel ratio (≤2).
// Owns no clock — whoever holds the canvas holds the time.

import { useEffect, useMemo, useRef, useState } from 'react';
import { tokenHex } from '../BootIgnition/stage-palette.js';
import { kitOf } from './summoning-paint.js';
import { paintAt } from './summoning-frame.js';
import { auraLayer } from './summoning-aura.js';
import { ownLightAt } from './summoning-score.js';

const MAX_DPR = 2;
const rgbOf = (hex) => `${(hex >> 16) & 0xff},${(hex >> 8) & 0xff},${hex & 0xff}`;
// "r,g,b" a → b by w
const mixRgb = (a, b, w) => {
  const x = a.split(',').map(Number);
  const y = b.split(',').map(Number);
  return x.map((v, i) => Math.round(v + (y[i] - v) * w)).join(',');
};

// impure — THE LOOK, read once
export const paletteOf = () => ({
  signal: rgbOf(tokenHex('--signal', 0x5fe9ff)),
  ink: rgbOf(tokenHex('--color-white', 0xffffff)),
  font: getComputedStyle(document.documentElement).getPropertyValue('--font-data').trim() || 'monospace',
});

// Its aura's grid: a small plate among four, a larger one alone (the cost
// of a frame grows with the grid's area — core/aura/render.js).
const auraGridFor = (w) => (w < 900 ? 256 : 448);

/**
 * @param {{ score: ReturnType<import('./summoning-score.js').scoreOf>, t: number,
 *   aura?: { form: object, fit: object, cycle: number } | null, epochMs?: number, className?: string }} props
 *   aura — its beingAura(); epochMs — its birth instant (the aura's flow is read from it)
 *   chrome — its captions and frame (off: the figure alone, e.g. its sigil taking its station)
 */
export const SummoningCanvas = ({ score, t, aura = null, epochMs = 0, chrome = true, className = '' }) => {
  const ref = useRef(null);
  const [box, setBox] = useState({ w: 1, h: 1, dpr: 1 });
  const [palette, setPalette] = useState(null);

  // impure — the type must be loaded before the first mark
  useEffect(() => {
    let live = true;
    document.fonts.ready.then(() => { if (live) setPalette(paletteOf()); });
    return () => { live = false; };
  }, []);

  // impure — follow the box
  useEffect(() => {
    const el = ref.current;
    const fit = () => setBox({ w: el.clientWidth || 1, h: el.clientHeight || 1, dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR) });
    const obs = new ResizeObserver(fit);
    obs.observe(el);
    fit();
    return () => obs.disconnect();
  }, []);

  const auraGrid = auraGridFor(box.w);
  const layer = useMemo(() => (palette && aura
    // its aura is seen once, after its choice: in its own light
    ? auraLayer(aura, { size: auraGrid, tint: score.soul.line.split(',').map(Number), epochMs })
    : null), [palette, aura, auraGrid, epochMs, score]);

  // impure — paint the frame
  useEffect(() => {
    const el = ref.current;
    if (!palette) return;
    if (el.width !== Math.round(box.w * box.dpr)) el.width = Math.round(box.w * box.dpr);
    if (el.height !== Math.round(box.h * box.dpr)) el.height = Math.round(box.h * box.dpr);
    const ctx = el.getContext('2d');
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
    // the signal is the platform's light until its choice, then its own
    const lit = { ...palette, signal: mixRgb(palette.signal, score.soul.line, ownLightAt(score, t)) };
    paintAt(kitOf(ctx, box.w, box.h, lit, { aura: layer }), score, t, { chrome });
  }, [score, t, box, palette, layer, chrome]);

  return <canvas ref={ref} className={`sum-canvas ${className}`} data-ready={palette ? 'true' : 'false'} />;
};
