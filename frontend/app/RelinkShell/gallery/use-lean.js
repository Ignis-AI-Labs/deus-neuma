// use-lean — how a hung work is leaned into, shared by the gallery room
// (Viewer.jsx) and the desk-level Lightbox. Extracted 2026-09-01 when the
// Lightbox took up the lens: two copies of the lean state machine would
// drift, and a future fix to clamping or pointer capture would land in one
// room and silently not the other — the same argument that moved useBoxSize
// out of Viewer a moment earlier.
//
// What lives here is everything the two rooms share: the view and natural
// size state, the geometry ref the wheel reads, the fresh hang on a new
// work, the resize re-clamp, the non-passive wheel listener, the pan-by-drag
// pointer handlers, the double-click lean-in, and the 0/+/- zoom keys.
// What stays in each room is genuinely its own: Escape and walking in the
// gallery, Escape and the backdrop leave in the Lightbox, and where each
// takes focus.

import { useEffect, useRef, useState } from 'react';
import { useBoxSize } from './use-box-size.js';
import {
  FIT, ZERO_BOX, clampView, sameView, zoomAbout, panBy, leanIn, wheelFactor, ORIGIN,
} from './viewer-zoom.js';

/**
 * The lean state machine for one hung work. impure (DOM listeners, refs).
 *
 * @param {import('react').RefObject} stageRef - the wall the work hangs on
 * @param {import('react').RefObject} artRef - the work itself (its layout
 *   box is the hang the lean multiplies)
 * @param {string|number} key - identity of the work; a change rehangs fresh
 * @param {{wheel?: boolean}} opts - `wheel: false` suspends the lean-in
 *   listener (the room's videos: nothing to lean into)
 * @returns {{
 *   view, setView, natural, setNatural, zoomed, base,
 *   zoomKey: (e: KeyboardEvent) => boolean,
 *   stageProps: Record<string, Function>,
 * }}
 */
export const useLean = (stageRef, artRef, key, { wheel = true } = {}) => {
  const dragRef = useRef(null);
  const geomRef = useRef({ base: ZERO_BOX, natural: ZERO_BOX, frame: ZERO_BOX });

  const [view, setView] = useState(FIT);
  const [natural, setNatural] = useState(ZERO_BOX);

  const frame = useBoxSize(stageRef, key);
  const base = useBoxSize(artRef, key);

  // Effect order matters: the geometry ref is refreshed BEFORE anything reads
  // it, so a wheel or a re-clamp never measures the previous work.
  useEffect(() => { geomRef.current = { base, natural, frame }; });

  // A new work hangs fresh — carrying the last one's lean over would drop the
  // operator into the middle of an image they have not seen whole yet.
  useEffect(() => { setView(FIT); setNatural(ZERO_BOX); }, [key]);

  // The frame changed, so the hang changed: pull the lean back inside the
  // work's edges rather than leaving a strip of empty wall. Returning the SAME
  // view object when nothing moved lets React bail out instead of looping.
  useEffect(() => {
    setView((v) => { const next = clampView(v, geomRef.current); return sameView(v, next) ? v : next; });
  }, [base.w, base.h, frame.w, frame.h, natural.w, natural.h]);

  // React registers `wheel` at the root as PASSIVE, so an onWheel prop cannot
  // preventDefault — the work would zoom AND the surface behind would scroll.
  // The listener has to be ours, and explicitly non-passive.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !wheel) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cursor = { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
      setView((v) => zoomAbout(v, wheelFactor(e.deltaY, e.deltaMode), cursor, geomRef.current));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheel, key, stageRef]);

  // The 0/+/- lens keys. Returns whether the key was consumed — the loupe
  // uses it to claim the key outright (a modal owes consumed keys to no
  // ancestor); the room ignores it, as it always did.
  const zoomKey = (e) => {
    if (e.key === '0') { e.preventDefault(); setView(FIT); return true; }
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setView((v) => zoomAbout(v, 1.3, ORIGIN, geomRef.current));
      return true;
    }
    if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      setView((v) => zoomAbout(v, 1 / 1.3, ORIGIN, geomRef.current));
      return true;
    }
    return false;
  };

  const zoomed = view.zoom > 1;

  const onPointerDown = (e) => {
    if (!zoomed || e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const from = dragRef.current;
    if (!from) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setView((v) => panBy(v, e.clientX - from.x, e.clientY - from.y, geomRef.current));
  };
  const onPointerUp = (e) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    // A CANCELLED pointer's capture is already gone, and releasing a capture
    // that no longer stands throws NotFoundError — so ASK first. The
    // predicate answers exactly the condition the release needs.
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Spread onto the stage element; the double-click is the lean-in to the
  // work's own pixels, and back out to the hang.
  const stageProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onDoubleClick: () => setView((v) => (v.zoom > 1 ? FIT : zoomAbout(v, leanIn(geomRef.current), ORIGIN, geomRef.current))),
  };

  return { view, setView, natural, setNatural, zoomed, base, zoomKey, stageProps };
};
