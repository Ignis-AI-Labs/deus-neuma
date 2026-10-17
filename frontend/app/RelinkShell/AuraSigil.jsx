// AuraSigil — the being's aura, drawn (#405).
//
// impure by nature: it owns a canvas and an animation loop. Everything it
// draws comes from `core/aura/` — the SAME grammar and the SAME tone curve the
// gate used to judge this form headless, which is the whole reason a contact
// sheet is evidence about what a witness sees (core/aura/tone.js).
//
// SHARP AT EVERY SIZE (2026-09-26, Founder: […]).
// The canvas is drawn at the plate's REAL device-pixel size — never a fixed
// grid the browser then stretches or squeezes. The point count scales with the
// grid's area, so each cell gathers the same density the gate measured: the
// same picture at a finer resolution, never a different one (render.js's own
// law). The sweep runs in a worker (aura-paint-worker.js), so an enlarged,
// full-screen aura costs the desk's thread one paint a frame; where no worker
// can start, the same sweep runs here.
//
// Nothing is derived here. The form, the fit it keeps for its whole cycle, and
// the cycle length all arrive from the engine, where the being's identity
// lives. This component sweeps them and paints, on THE FLOW's four clocks
// (aura-view.js flowPhases) — continuous, and never the same moment twice.

import { useEffect, useRef } from 'react';
import './AuraViewer.css';
import { renderTile } from '../../../core/aura/render.js';
import { flowPhases, sigilGrid } from './aura-view.js';
import { useWindowShown } from '../windowing/window-shown.js';
import { isShowing } from './use-visible-interval.js';

/** The fastest a frame is asked for. Painting faster buys nothing anyone can see. */
const FRAME_MS = 1000 / 24;

/** #RRGGBB → [r,g,b]; null for anything else, so no palette is ever invented. */
const parseHex = (value) => {
  const hex = /^#([0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (!hex) return null;
  const n = parseInt(hex[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/* The tint is THE LOOK's own --signal token read off the live element, never a
   literal — the aura is live data, and live data wears the signal colour
   (LINE & CYCLE). An unreadable token falls back to the greyscale's own white
   rather than to a colour nobody chose. */
const tintOf = (element) => {
  const token = getComputedStyle(element).getPropertyValue('--signal');
  return parseHex(token) || [255, 255, 255];
};

/** One tone-mapped tile as tinted RGBA. Pure over its inputs. */
const tinted = (tile, [r, g, b]) => {
  const out = new Uint8ClampedArray(tile.length * 4);
  for (let i = 0; i < tile.length; i++) {
    const tone = tile[i];
    const at = i * 4;
    out[at] = (tone * r) / 255;
    out[at + 1] = (tone * g) / 255;
    out[at + 2] = (tone * b) / 255;
    out[at + 3] = 255;
  }
  return out;
};

// impure — a worker for the sweep, or null where none can start.
const startWorker = () => {
  try {
    return new Worker(new URL('./aura-paint-worker.js', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
};

/**
 * @param {{form: object, fit: object, cycle: number, px?: number, label?: string, className?: string, onOpen?: () => void}} props
 *   px — the CSS size the plate is shown at; the grid follows it × the
 *   device-pixel ratio. onOpen — when given, the plate is a button that
 *   opens the enlarged viewer.
 */
export const AuraSigil = ({ form, fit, cycle, px = 200, label = 'AURA', className = 'sheet-aura-canvas', testId = 'aura-sigil', onOpen = null }) => {
  const canvasRef = useRef(null);
  // UNSEEN, UNDRAWN (2026-10-05): a shaded window or a plate scrolled off the
  // sheet held the loop at 24 frames a second with nobody looking (the
  // browser pauses frames only for a hidden page). The loop holds while
  // unseen and picks up where the clock now is — THE FLOW is wall-clock
  // time, so nothing is lost by not painting it.
  const shown = useWindowShown();
  const onScreenRef = useRef(true);
  const heldRef = useRef(!shown);
  const kickRef = useRef(null);
  const syncHeld = () => {
    const held = !(shown && onScreenRef.current);
    const resumed = heldRef.current && !held;
    heldRef.current = held;
    if (resumed) kickRef.current?.();
  };
  useEffect(syncHeld, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const syncRef = useRef(syncHeld);
  syncRef.current = syncHeld;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof IntersectionObserver !== 'function') return undefined;
    let inView = true;
    let sized = true;
    const report = () => { onScreenRef.current = inView && sized; syncRef.current(); };
    const io = new IntersectionObserver((entries) => { inView = entries.some(isShowing); report(); });
    const ro = typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => { sized = entries.some((e) => e.contentRect.width > 0 && e.contentRect.height > 0); report(); })
      : null;
    io.observe(canvas);
    ro?.observe(canvas);
    return () => { io.disconnect(); ro?.disconnect(); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !form || !fit) return undefined;
    const { size, count } = sigilGrid(px, window.devicePixelRatio || 1);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return undefined;
    const image = ctx.createImageData(size, size);
    const tint = tintOf(canvas);
    const paint = (pixels) => { image.data.set(pixels); ctx.putImageData(image, 0, 0); };
    const sweep = (t) => tinted(renderTile(form, fit, t, { size, count }), tint);

    // One frame is the honest whole picture for a witness who asked for no
    // motion: the fit is a WHOLE-cycle fit, so t=0 is not a lucky frame. It
    // is painted here and now, so the plate is never blank while it waits.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      paint(sweep(0));
      return undefined;
    }

    let stopped = false;
    let timer = 0;
    let frame = 0;
    const worker = startWorker();
    // THE FLOW: four clocks off the wall clock (aura-view.js flowPhases) — the
    // form is wherever time has carried it and never repeats a moment. The
    // wall clock is read once; the monotonic clock carries it smoothly.
    const epoch0 = Date.now() - performance.now();
    const phase = () => flowPhases(epoch0 + performance.now(), cycle);

    if (worker) {
      // The page asks for one frame at a time: a slow frame paces the loop.
      let asked = 0;
      let askedAt = 0;
      let pending = false; // a frame asked for, or its next ask scheduled
      const ask = () => {
        if (stopped || heldRef.current) { pending = false; return; }
        pending = true;
        asked += 1;
        askedAt = performance.now();
        worker.postMessage({ type: 'frame', t: phase(), id: asked });
      };
      worker.onmessage = ({ data }) => {
        if (stopped || data.id !== asked) return;
        paint(data.pixels);
        if (heldRef.current) { pending = false; return; }
        timer = setTimeout(() => { frame = requestAnimationFrame(ask); }, Math.max(0, FRAME_MS - (performance.now() - askedAt)));
      };
      kickRef.current = () => { if (!pending) ask(); };
      worker.onerror = () => { // the worker could not load — the same sweep, here
        worker.terminate();
        if (!stopped) loopHere();
      };
      worker.postMessage({ type: 'init', form, fit, size, count, tint });
      ask();
    } else {
      loopHere();
    }

    function loopHere() {
      let last = 0;
      let looping = false;
      const step = (now) => {
        if (stopped || heldRef.current) { looping = false; return; }
        frame = requestAnimationFrame(step);
        if (now - last < FRAME_MS) return;
        last = now;
        paint(sweep(phase()));
      };
      kickRef.current = () => {
        if (looping || stopped) return;
        looping = true;
        frame = requestAnimationFrame(step);
      };
      kickRef.current();
    }

    return () => {
      stopped = true;
      kickRef.current = null;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      worker?.terminate();
    };
  }, [form, fit, cycle, px]);

  const canvas = (
    <canvas
      ref={canvasRef}
      className={className}
      width={220}
      height={220}
      style={{ width: px, height: px }}
      data-testid={testId}
      role="img"
      aria-label={label}
    />
  );
  if (!onOpen) return canvas;
  return (
    <button type="button" className="aura-open" onClick={onOpen} aria-label={`Enlarge ${label}`} title="Enlarge">
      {canvas}
      <span className="aura-open-hint label-data" aria-hidden="true">⤢ ENLARGE</span>
    </button>
  );
};
