/**
 * THE AURA — density into pixels, for every surface that draws one.
 *
 * `tone.js` states the law this file exists to keep: three surfaces draw these
 * forms — the headless contact sheet, the gallery, and the desk — and if any
 * one of them invented its own accumulation or its own curve, the proof sheet
 * would stop being evidence about what a witness actually sees.
 *
 * So there is exactly ONE accumulator (`raster.js`, the same one the gate
 * measures a candidate with) and exactly one curve (`tone.js`). This file is
 * only the join: accumulate, then map. A tile drawn here and a verdict spoken
 * by the gate are the same picture at different resolutions.
 *
 * Pure Math, no Node imports — so the desk can draw what the engine derived.
 */

import { rasterize } from './raster.js';
import { toneMap, EXPOSURE } from './tone.js';

/** Frame left around a drawn tile. Wider than the gate's crop: a tile is looked at. */
export const TILE_MARGIN = 0.08;

/**
 * Draw one phase of a form into a greyscale tile. Pure.
 *
 * `fit` must come from `cycleFit` over the WHOLE cycle, never this phase alone
 * — a per-frame fit rescales the form every frame, which reads as breathing
 * and hides what the form is actually doing.
 *
 * @param {object} form - `{ carrier, coupling, output, p }`
 * @param {{cx:number, cy:number, scale:number}} fit - from `cycleFit`
 * @param {number} t - phase within AURA_CYCLE
 * @param {{size:number, count:number, margin?:number, exposure?:number}} opts
 * @returns {Uint8Array} `size * size` luminance bytes, 0…255
 */
export const renderTile = (form, fit, t, opts) => {
  const { size, count, margin = TILE_MARGIN, exposure = EXPOSURE } = opts;
  const { grid } = rasterize(form, fit, t, { count, size, margin });
  const pixels = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i++) pixels[i] = toneMap(grid[i], exposure);
  return pixels;
};
