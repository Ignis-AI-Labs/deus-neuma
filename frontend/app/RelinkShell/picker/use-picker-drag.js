// use-picker-drag — the portaled FolderPicker is a real movable dialog: grab
// its head and put it anywhere on screen (witness law: the picker must never
// be stuck where it spawned). Inline hosts pass `enabled=false` — the picker
// fills their window by design.

import { useEffect, useRef, useState } from 'react';

/**
 * impure — pointer plumbing for the drag. Listeners live only for the
 * gesture: they detach on pointerup/cancel, or on UNMOUNT mid-drag via the
 * cleanup ref — a drag can never outlive the picker.
 * @param {boolean} enabled
 * @returns {{ pos: {x: number, y: number, h: number}|null, panelRef: object, startDrag: (e: PointerEvent) => void }}
 */
export const usePickerDrag = (enabled) => {
  // null = CSS-centered; {x, y, h} once grabbed — pinned in viewport
  // coordinates from the first move, so the panel never jumps at drag start.
  const [pos, setPos] = useState(null);
  const panelRef = useRef(null);
  const dragCleanupRef = useRef(null); // the in-flight gesture's teardown, if any

  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  const startDrag = (e) => {
    if (!enabled || e.button !== 0 || !panelRef.current || e.target.closest('button, input')) return;
    e.preventDefault();
    dragCleanupRef.current?.(); // a prior in-flight gesture (multi-touch) dies before this one binds
    const rect = panelRef.current.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    setPos({ x: rect.left, y: rect.top, h: rect.height });
    const onMove = (ev) => {
      setPos({
        x: Math.min(Math.max(ev.clientX - dx, 0), window.innerWidth - rect.width),
        y: Math.min(Math.max(ev.clientY - dy, 0), window.innerHeight - rect.height),
        h: rect.height,
      });
    };
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      dragCleanupRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    dragCleanupRef.current = onEnd;
  };

  return { pos, panelRef, startDrag };
};
