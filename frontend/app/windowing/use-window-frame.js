// use-window-frame.js — a floating window's geometry, as React state.
//
// impure hook: pointer-driven drag and resize, edge/corner snapping with a
// live preview, maximize/restore, and per-wallet persistence. All the math
// is delegated to the pure geometry.js / snap-zones.js helpers; this hook
// only wires pointers and state to them.
//
// An in-flight interaction registers window-level listeners and stores its
// teardown in a ref, so pointercancel (touch/pen/OS gesture) and an unmount
// mid-drag both detach cleanly — the gesture never gets "stuck" to the
// cursor and no listener outlives the window.

import { useCallback, useEffect, useRef, useState } from 'react';
import { clampRect, moveRect, resizeRect, maxRect, defaultRect, insetBounds } from './geometry.js';
import { hitZone, rectForZone, splitZone, splitRects, hintKey, SNAP_DWELL_MS } from './snap-zones.js';
import { registerFrame, unregisterFrame, topFrameAt } from './frame-registry.js';
import { loadGeometry, saveGeometry } from './window-storage.js';

// The snap area leaves the status strip (top) and the dock (bottom) clear,
// with a small margin on the sides.
const INSET = Object.freeze({ top: 52, right: 12, bottom: 68, left: 12 });

// --- The desk's window region (D6 geometry accommodation) ---
// The Explorer panel makes the desk a flex row; windows live in the row's
// second child. When the host registers that element here, drag/snap bounds
// derive from ITS viewport box (getBoundingClientRect — the same coordinate
// space pointer events and persisted window x/y already live in), so windows
// can never overlap the panel. Unregistered hosts (tests, plain surfaces)
// keep the viewport-derived bounds unchanged.
// impure — module-level element registry, same spirit as window-storage.
let regionEl = null;
export const setDeskRegion = (el) => { regionEl = el || null; };

const regionBox = () => {
  if (regionEl) {
    const r = regionEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
};

// THE BAR'S EDGE (the taskbar, docs/work/os-taskbar-launcher.md). At the
// bottom the bar keeps INSET.bottom clear; on the left or top the desk row is
// PADDED by the bar instead (Taskbar.css — so window coordinates never shift),
// and the bottom needs only the side margin.
// impure — module-level, same spirit as setDeskRegion.
let barEdge = 'bottom';
export const setBarEdge = (edge) => {
  if (edge === barEdge) return;
  barEdge = edge;
  window.dispatchEvent(new Event('resize')); // every frame re-fits to the new bounds
};

const getBounds = () => insetBounds(regionBox(), barEdge === 'bottom' ? INSET : { ...INSET, bottom: INSET.right });

export const useWindowFrame = (storageKey, { z = 0, targetable = true } = {}) => {
  const [bounds, setBounds] = useState(getBounds);
  const [rect, setRect] = useState(() => {
    const b = getBounds();
    const saved = loadGeometry(storageKey);
    return saved ? clampRect(saved, b) : defaultRect(b);
  });
  const [maxed, setMaxed] = useState(() => !!loadGeometry(storageKey)?.maxed);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null);

  const restoreRef = useRef(rect); // floating rect to return to from snap/max
  const snapZoneRef = useRef(null); // active snapped zone id, or null when floating
  const teardownRef = useRef(null); // tears down the in-flight pointer interaction

  const persist = useCallback(
    (floatRect, isMax) => saveGeometry(storageKey, { ...floatRect, maxed: isMax }),
    [storageKey],
  );

  // Re-fit whenever the available space changes: a snapped window refills its
  // zone, a floating one clamps, and the restore point is kept on-screen.
  // Three doors into one refit: the mount pass (the first render may have
  // used the viewport fallback before the region registered), the region's
  // own reflow (panel expand/collapse — ResizeObserver), and the viewport
  // resize. Persisted x/y stays valid across panel states because every
  // re-fit clamps on the way in — a window saved beside a collapsed panel
  // simply clamps rightward the moment the panel widens.
  useEffect(() => {
    const refit = () => {
      const b = getBounds();
      setBounds(b);
      restoreRef.current = clampRect(restoreRef.current, b);
      setRect((r) => (snapZoneRef.current ? rectForZone(snapZoneRef.current, b) : clampRect(r, b)));
    };
    refit();
    window.addEventListener('resize', refit);
    const ro = typeof ResizeObserver !== 'undefined' && regionEl ? new ResizeObserver(refit) : null;
    if (ro) ro.observe(regionEl);
    return () => {
      window.removeEventListener('resize', refit);
      if (ro) ro.disconnect();
    };
  }, []);

  // Detach any in-flight interaction if the window unmounts mid-drag.
  useEffect(() => () => teardownRef.current?.(), []);

  // A sibling's drag divided this window's space: the kept half becomes the
  // new floating truth — snap/max released, the half IS the window now.
  const applySplit = useCallback((half) => {
    snapZoneRef.current = null;
    setMaxed(false);
    restoreRef.current = half;
    setRect(half);
    persist(half, false);
  }, [persist]);

  // Keep this frame's registry entry current (rect as shown, stacking z,
  // targetability) so a sibling's drag can offer to divide it; the entry
  // leaves with the window.
  useEffect(() => {
    registerFrame(storageKey, { rect: maxed ? maxRect(bounds) : rect, z, targetable, applySplit });
    return () => unregisterFrame(storageKey);
  }, [storageKey, rect, maxed, bounds, z, targetable, applySplit]);

  const startDrag = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const b = getBounds();
    const startX = e.clientX;
    const startY = e.clientY;

    // Dragging a maximized/snapped window restores its floating size under
    // the cursor first (OS un-snap), then drags from there.
    let base = rect;
    if (maxed || snapZoneRef.current) {
      const f = restoreRef.current;
      base = clampRect({ x: e.clientX - f.w / 2, y: e.clientY - 16, w: f.w, h: f.h }, b);
      setMaxed(false);
      snapZoneRef.current = null;
      setRect(base);
    }

    let zone = null;
    let split = null; // { side, target } — a sibling window's half, when hinted
    // THE HELD SNAP (snap-zones.js SNAP_DWELL_MS): a hint arms only after the
    // pointer has stayed on it; until then nothing previews and nothing applies.
    let hint = { key: null, armed: false, timer: null };
    const previewOf = () => (zone
      ? rectForZone(zone, b)
      : split ? splitRects(split.side, split.target.rect).taken : null);
    const arm = () => { hint.armed = true; setPreview(previewOf()); };

    const teardown = () => {
      window.clearTimeout(hint.timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      teardownRef.current = null;
      setDragging(false);
      setPreview(null);
    };
    const onMove = (ev) => {
      setRect(moveRect(base, ev.clientX - startX, ev.clientY - startY, b));
      const p = { x: ev.clientX, y: ev.clientY };
      // The desk's own edges/corners keep their aero meaning; inside the
      // canvas, hovering a SIBLING window's side offers to divide its
      // space in half (the editor-group idiom).
      zone = hitZone(p, b);
      split = null;
      // A SPLIT IS ASKED FOR WITH SHIFT (Design note, 2026-10-05: still […] — with windows covering the desk, a pause anywhere sat on
      // some sibling's seam). Without Shift, carrying a window over others is
      // only ever a move.
      if (!zone && ev.shiftKey) {
        const target = topFrameAt(p, storageKey);
        const side = target ? splitZone(p, target.rect) : null;
        if (side) split = { side, target };
      }
      const key = hintKey(zone, split);
      if (key !== hint.key) {
        window.clearTimeout(hint.timer);
        hint = { key, armed: false, timer: key ? window.setTimeout(arm, SNAP_DWELL_MS) : null };
        setPreview(null);
      } else if (hint.armed) {
        setPreview(previewOf());
      }
    };
    const onUp = () => {
      teardown();
      // An unarmed hint is travel, not a decision: the window stays where it was let go.
      if (!hint.armed) { zone = null; split = null; }
      if (zone === 'max') {
        restoreRef.current = base;
        snapZoneRef.current = null;
        setMaxed(true);
        persist(base, true);
      } else if (zone) {
        restoreRef.current = base;
        snapZoneRef.current = zone;
        const target = rectForZone(zone, b);
        setRect(target);
        persist(target, false);
      } else if (split) {
        // The divide: this window takes the hinted half of the sibling's
        // space, the sibling keeps the other — committed on both sides.
        const { taken, kept } = splitRects(split.side, split.target.rect);
        restoreRef.current = base;
        snapZoneRef.current = null;
        setRect(taken);
        persist(taken, false);
        split.target.applySplit(kept);
      } else {
        snapZoneRef.current = null;
        setRect((r) => { restoreRef.current = r; persist(r, false); return r; });
      }
    };
    // Interrupted (touch/pen/system gesture): keep where it is, no snap.
    const onCancel = () => {
      teardown();
      snapZoneRef.current = null;
      setRect((r) => { restoreRef.current = r; persist(r, false); return r; });
    };

    setDragging(true);
    teardownRef.current = teardown;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [rect, maxed, persist, storageKey]);

  const startResize = useCallback((edge) => (e) => {
    if (maxed || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const b = getBounds();
    const base = rect;
    const startX = e.clientX;
    const startY = e.clientY;
    snapZoneRef.current = null; // resizing frees a snapped window

    const teardown = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      teardownRef.current = null;
    };
    const onMove = (ev) =>
      setRect(resizeRect(base, edge, ev.clientX - startX, ev.clientY - startY, b));
    const onEnd = () => {
      teardown();
      setRect((r) => { restoreRef.current = r; persist(r, false); return r; });
    };

    teardownRef.current = teardown;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }, [rect, maxed, persist]);

  const toggleMax = useCallback(() => {
    setMaxed((m) => {
      const next = !m;
      if (next) {
        // Keep the pre-snap floating rect as the restore target.
        if (!snapZoneRef.current) restoreRef.current = rect;
        snapZoneRef.current = null;
        persist(restoreRef.current, true);
      } else {
        const restored = clampRect(restoreRef.current, getBounds());
        setRect(restored);
        persist(restored, false);
      }
      return next;
    });
  }, [rect, persist]);

  return {
    rect: maxed ? maxRect(bounds) : rect,
    maxed,
    dragging,
    bounds,
    preview,
    startDrag,
    startResize,
    toggleMax,
  };
};
