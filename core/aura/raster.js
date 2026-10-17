/**
 * THE AURA — rasterisation without a canvas.
 *
 * The gate has to MEASURE a form, and it runs in a sweep of tens of thousands
 * of candidates where no browser exists. So the cloud is accumulated into a
 * plain density grid: one float per cell, exactly the quantity a low-alpha
 * additive stroke would build up on screen. The desk's canvas and this grid
 * are the same picture at different resolutions — which is what lets a headless
 * verdict speak for what a witness will actually see.
 *
 * Pure Math, no Node imports.
 */

import { auraPoint } from './form.js';

/**
 * Accumulate one phase of a form into a density grid. Pure.
 *
 * `fit` comes from `cycleFit` over the WHOLE cycle, never this phase alone —
 * so a form that lunges out of frame at one phase is measured as doing so
 * rather than being quietly rescaled to look composed.
 *
 * @param {object} form
 * @param {{cx:number, cy:number, scale:number}} fit
 * @param {number} t - phase
 * @param {{count:number, size:number, margin?:number}} opts
 * @returns {{grid:Float32Array, size:number, inside:number, count:number}}
 */
export const rasterize = (form, fit, t, { count, size, margin = 0.06 }) => {
  const grid = new Float32Array(size * size);
  const du = form.p.sweep / count;
  const span = size * (1 - margin * 2);
  const origin = size * margin;
  let inside = 0;
  let finite = 0;

  for (let i = 0; i < count; i++) {
    const [px, py] = auraPoint(form, i * du, t);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    finite++;
    const cx = (origin + ((px - fit.cx) * fit.scale + 0.5) * span) | 0;
    const cy = (origin + ((py - fit.cy) * fit.scale + 0.5) * span) | 0;
    if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
    grid[cy * size + cx] += 1;
    inside++;
  }
  /* `finite` and `inside` are kept apart on purpose: a point lost to NaN is a
     broken form, a point clipped by the quantile fit is a deliberate crop. */
  return { grid, size, finite, inside, count };
};
