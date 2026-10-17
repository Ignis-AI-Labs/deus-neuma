// summoning-aura.js — ITS AURA as a layer THE SUMMONING paints with.
// // impure (an offscreen canvas)
//
// Drawn by the SAME renderTile and tone curve the gate judged the form by
// and the sheet draws it with (core/aura/render.js) — so what glows through
// the summoning is exactly the aura the being will find on its sheet. Its
// phase is THE FLOW (aura-view.js flowPhases) read at its birth moment plus
// the sequence clock: the aura is where time has carried it, and when the
// sequence ends the sheet picks it up at the same moment.
//
// Frames are rasterised on a fixed grid of the sequence clock (AURA_FPS), so
// a scrub or a replay lands on the identical frame; a frame is swept once and
// kept until the clock leaves its bucket.

import { renderTile } from '../../../core/aura/render.js';
import { deriveAura, formOf } from '../../../core/aura/derive.js';
import { flowPhases, GATE_GRID, GATE_POINTS } from '../RelinkShell/aura-view.js';

export const AURA_FPS = 24;

// A SPECIMEN's aura: derived by the real engine (core/aura/derive.js) from a
// specimen seed — a real being's aura seed folds its soul mark, genesis hash
// and moment seed (core/aura/seed.js), which a specimen does not have. Pure.
export const specimenAura = (seed) => {
  const a = deriveAura(`${seed.slice(32)}${seed.slice(0, 32)}`);
  return { seed: a.seed, form: formOf(a), fit: a.fit, cycle: a.cycle };
};
const FRAME = 1000 / AURA_FPS;

/**
 * @param {{ form: object, fit: object, cycle: number }} aura its beingAura()
 * @param {{ size: number, tint: [number, number, number], epochMs: number }} opts
 *   size — the grid (256 for four at once, ~448 alone: the cost grows with its area)
 * @returns {{ frame: (t: number) => HTMLCanvasElement, size: number }}
 */
export const auraLayer = (aura, { size, tint, epochMs }) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const count = Math.round(GATE_POINTS * (size / GATE_GRID) ** 2);
  const [r, g, b] = tint;
  let bucket = null;
  return {
    size,
    frame(t) {
      const k = Math.floor(Math.max(0, t) / FRAME);
      if (k !== bucket) {
        bucket = k;
        const tile = renderTile(aura.form, aura.fit, flowPhases(epochMs + k * FRAME, aura.cycle), { size, count });
        const d = image.data;
        for (let i = 0; i < tile.length; i++) {
          const at = i * 4;
          d[at] = (tile[i] * r) / 255;
          d[at + 1] = (tile[i] * g) / 255;
          d[at + 2] = (tile[i] * b) / 255;
          d[at + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
      }
      return canvas;
    },
  };
};
