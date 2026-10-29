// use-hover-intent.js — a hover that opens only when it is meant (impure hook).
//
// DELIBERATE GESTURES (Design note, 2026-10-05: windows snapped, tabs tore out, […]): sweeping the pointer along the taskbar must never pop lists open
// in its wake, and the list must not vanish in the 10px gap the pointer crosses
// to reach it. So: the pointer has to REST on a button for HOVER_OPEN_MS before
// its list opens, and leaving the button or the list starts a HOVER_CLOSE_MS
// grace that re-entering either cancels. Keyboard focus is already deliberate
// and opens at once (`show`). Ledger: docs/work/dock-stream-cycle.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** The rest a pointer owes a button before its list opens. */
export const HOVER_OPEN_MS = 320;
/** The grace a list keeps after the pointer leaves it or its button. */
export const HOVER_CLOSE_MS = 240;

/**
 * @returns {{open: {id: string, place: object}|null, enter: Function,
 *   leave: Function, keep: Function, show: Function, hide: Function}}
 */
export const useHoverIntent = () => {
  const [open, setOpen] = useState(null);
  const openRef = useRef(null);
  openRef.current = open;
  const timer = useRef(null);
  const clear = useCallback(() => { window.clearTimeout(timer.current); timer.current = null; }, []);
  const later = useCallback((fn, ms) => { clear(); timer.current = window.setTimeout(fn, ms); }, [clear]);
  useEffect(() => clear, [clear]);

  return useMemo(() => ({
    open,
    // The pointer arrived on a button: its own open list holds; any other
    // opens once the pointer has rested.
    enter: (id, place) => {
      if (openRef.current?.id === id) { clear(); return; }
      later(() => setOpen({ id, place }), HOVER_OPEN_MS);
    },
    // The pointer left: a list that never opened never will; an open one
    // closes after the grace.
    leave: () => {
      if (openRef.current === null) { clear(); return; }
      later(() => setOpen(null), HOVER_CLOSE_MS);
    },
    keep: clear,
    show: (id, place) => { clear(); setOpen({ id, place }); },
    hide: () => { clear(); setOpen(null); },
  }), [open, clear, later]);
};
