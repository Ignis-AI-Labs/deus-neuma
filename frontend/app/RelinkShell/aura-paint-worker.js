// aura-paint-worker.js — the aura's painter, off the main thread (2026-09-26).
//
// A sharp aura is drawn at the plate's real device-pixel size, and a large
// one (the enlarged viewer, full screen) costs tens of milliseconds a frame —
// time the desk's own thread must never spend. So the sweep runs here, with
// the SAME renderTile the gate judged the form by (core/aura/render.js), and
// only a finished RGBA frame crosses back (transferred, never copied).
//
// Protocol: `init` {form, fit, size, count, tint}; then each `frame` {t, id}
// is answered by {id, pixels, ms} — one frame at a time, asked for by the
// page, so a slow frame paces the loop instead of queueing behind it.

import { renderTile } from '../../../core/aura/render.js';

let job = null;

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    job = { form: data.form, fit: data.fit, size: data.size, count: data.count, tint: data.tint };
    return;
  }
  if (data.type !== 'frame' || !job) return;
  const started = performance.now();
  const tile = renderTile(job.form, job.fit, data.t, { size: job.size, count: job.count });
  const [r, g, b] = job.tint;
  const pixels = new Uint8ClampedArray(tile.length * 4);
  for (let i = 0; i < tile.length; i++) {
    const tone = tile[i];
    const at = i * 4;
    pixels[at] = (tone * r) / 255;
    pixels[at + 1] = (tone * g) / 255;
    pixels[at + 2] = (tone * b) / 255;
    pixels[at + 3] = 255;
  }
  self.postMessage({ id: data.id, pixels, ms: performance.now() - started }, [pixels.buffer]);
};
