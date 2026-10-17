// use-box-size — a live box's size, shared by the gallery room (Viewer.jsx)
// and the desk-level Lightbox. Extracted verbatim from Viewer.jsx
// (2026-09-01) when the Lightbox took up the same lens: the zoom model in
// viewer-zoom.js needs a measured frame, and two measurers would drift.

import { useEffect, useState } from 'react';

// A live box's size. A pane resize fires no window `resize` event, so the only
// thing that can tell the stage it has grown is the observer.
export const useBoxSize = (ref, key) => {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    const read = (w, h) => setSize((cur) => (cur.w === w && cur.h === h ? cur : { w, h }));
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect;
      read(r ? r.width : el.clientWidth, r ? r.height : el.clientHeight);
    });
    ro.observe(el);
    const box = el.getBoundingClientRect();
    read(box.width, box.height);
    return () => ro.disconnect();
  }, [ref, key]);
  return size;
};
