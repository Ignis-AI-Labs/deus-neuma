// use-text-zoom.js — opt-in Ctrl+scroll text zoom for ONE surface.
//
// A surface that wants zoomable text calls useTextZoom('surface-key') and
// spreads { ref, style } onto its scroll container; its CSS multiplies the
// font sizes it wants scaled by var(--text-zoom, 1). Deliberately NOT
// app-wide: the desk chrome keeps its density, and each surface that opts
// in gets its own remembered zoom (per-surface localStorage key). Clamped
// so the max stays sane and the min stays legible; Ctrl+0 over the surface
// resets. Ctrl+scroll is browser muscle memory — no menu to find.

import { useEffect, useRef, useState } from 'react';

const PREF_PREFIX = 'neuma.textzoom.';

/** Next zoom for one wheel notch — pure, clamped, 2-decimal stable. */
export const nextZoom = (current, deltaY, { min, max, step }) => {
  const stepped = current + (deltaY < 0 ? step : -step);
  return Math.round(Math.min(max, Math.max(min, stepped)) * 100) / 100;
};

const readPref = (key, min, max) => {
  try {
    const v = Number(localStorage.getItem(PREF_PREFIX + key));
    if (Number.isFinite(v) && v >= min && v <= max) return v;
  } catch { /* private mode */ }
  return 1;
};

/**
 * @param {string} surfaceKey - persistence key; one remembered zoom per surface
 * @param {{min?: number, max?: number, step?: number}} [bounds]
 * @returns {{ref: Object, zoom: number, style: Object}}
 */
export const useTextZoom = (surfaceKey, { min = 0.75, max = 1.6, step = 0.05 } = {}) => {
  const ref = useRef(null);
  const [zoom, setZoom] = useState(() => readPref(surfaceKey, min, max));

  useEffect(() => {
    try { localStorage.setItem(PREF_PREFIX + surfaceKey, String(zoom)); } catch { /* private mode */ }
  }, [surfaceKey, zoom]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // Native listener, passive:false — React's synthetic wheel is passive and
    // could not preventDefault (which pinch-zooms the whole page instead).
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => nextZoom(z, e.deltaY, { min, max, step }));
    };
    // Ctrl+0 resets — only while the pointer is over this surface, so two
    // zoomable surfaces never fight over the shortcut.
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '0' && el.matches(':hover')) {
        e.preventDefault();
        setZoom(1);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [min, max, step]);

  return { ref, zoom, style: { '--text-zoom': zoom } };
};
