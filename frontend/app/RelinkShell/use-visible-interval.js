// use-visible-interval — poll only while someone can see the result.
//
// A desk window that is minimized (window-shade), scrolled away, or behind a
// hidden desk stays MOUNTED, and its setInterval kept firing: the SUBSTRATE
// lens alone spent 40 requests a minute (each two nvidia-smi spawns and three
// model-server probes) with nobody looking (live 2026-09-25). This runs the
// poll only while the desk is visible, the enclosing window is not shaded
// (window-shown.js) AND the watched element is on screen, and runs it once
// right away when it comes back into view, so returning to a window never
// shows a stale reading. Every desk poll rides this gate (2026-10-05).

import { useEffect, useRef, useState } from 'react';
import { useWindowShown } from '../windowing/window-shown.js';

/**
 * The pure gate. `setTimer`/`clearTimer` are injected so tests drive it
 * without a DOM or real timers. `page`/`screen`/`shown` are the signals as
 * they stand at creation (default true), so a gate born hidden never runs.
 * @param {{run: () => void, ms: number, setTimer: Function, clearTimer: Function, page?: boolean, screen?: boolean, shown?: boolean}} deps
 * @returns {{setPageVisible: (v: boolean) => void, setOnScreen: (v: boolean) => void, setWindowShown: (v: boolean) => void, stop: () => void, running: () => boolean}}
 */
export const createVisibleInterval = ({ run, ms, setTimer, clearTimer, page: page0 = true, screen: screen0 = true, shown: shown0 = true }) => {
  let page = Boolean(page0);
  let screen = Boolean(screen0);
  let shown = Boolean(shown0);
  let timer = null;
  let stopped = false;
  const sync = () => {
    const want = !stopped && page && screen && shown;
    if (want && timer === null) {
      run(); // back in view: fresh at once, never a stale frame
      timer = setTimer(run, ms);
    } else if (!want && timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };
  sync();
  return {
    setPageVisible: (v) => { page = Boolean(v); sync(); },
    setOnScreen: (v) => { screen = Boolean(v); sync(); },
    setWindowShown: (v) => { shown = Boolean(v); sync(); },
    stop: () => { stopped = true; sync(); },
    running: () => timer !== null,
  };
};

/**
 * Pure — does this IntersectionObserver entry show any pixels at all?
 * @param {{isIntersecting: boolean, intersectionRect: {width: number, height: number}}} entry
 * @returns {boolean}
 */
export const isShowing = (entry) => Boolean(entry?.isIntersecting)
  && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0;

/**
 * impure — React hook over the gate: document visibility + an
 * IntersectionObserver on the element the returned CALLBACK REF lands on (a
 * collapsed window-shade clips its body to nothing, which reads as off
 * screen). A callback ref, not a ref object, because a body that swaps its
 * root between loading/empty/loaded states must be followed to the new node.
 * Until a node attaches, the page and the window-shade gate.
 * @param {() => void} callback latest callback is always used
 * @param {number} ms
 * @param {{enabled?: boolean, key?: unknown}} [opts] enabled — false holds the
 *   poll entirely (a run that is not in flight); key — a change restarts it
 *   with an immediate run (a new path to watch)
 * @returns {(node: Element|null) => void} put on the watched element as `ref`
 */
export const useVisibleInterval = (callback, ms, { enabled = true, key = null } = {}) => {
  const latest = useRef(callback);
  latest.current = callback;
  const [node, setNode] = useState(null);
  const gateRef = useRef(null);
  const shown = useWindowShown();
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const screenRef = useRef(true); // the watched node's last report outlives a restart
  useEffect(() => {
    if (!enabled) return undefined;
    const gate = createVisibleInterval({
      run: () => latest.current(),
      ms,
      setTimer: (fn, every) => setInterval(fn, every),
      clearTimer: (id) => clearInterval(id),
      page: !document.hidden,
      screen: screenRef.current,
      shown: shownRef.current,
    });
    gateRef.current = gate;
    const onVisibility = () => gate.setPageVisible(!document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      gate.stop();
      gateRef.current = null;
    };
  }, [ms, enabled, key]);
  useEffect(() => { gateRef.current?.setWindowShown(shown); }, [shown]);
  useEffect(() => {
    if (!node) return undefined;
    // Two signals, both needed. A window-shade squeezes the body to ZERO height
    // while it still touches the viewport edge, so an IntersectionObserver
    // alone never fires (no threshold is crossed) — the SIZE says it closed.
    // Scrolled away / clipped off says the intersection.
    let inView = true;
    let sized = true;
    const report = () => {
      screenRef.current = inView && sized;
      gateRef.current?.setOnScreen(screenRef.current);
    };
    const io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => { inView = entries.some(isShowing); report(); })
      : null;
    const ro = typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => {
        sized = entries.some((e) => e.contentRect.width > 0 && e.contentRect.height > 0);
        report();
      })
      : null;
    io?.observe(node);
    ro?.observe(node);
    return () => { io?.disconnect(); ro?.disconnect(); };
  }, [node]);
  return setNode;
};
