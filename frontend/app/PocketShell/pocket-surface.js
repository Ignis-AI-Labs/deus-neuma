// pocket-surface — which shell this viewport gets.
//
// The desk is floating windows and a dock; a phone gets the pocket shell,
// one pane at a time. The choice is the viewport's and the pointer's, made
// once at boot and again whenever they change (a rotated tablet, a window
// dragged narrow), never by user agent sniffing.
import { useEffect, useState } from 'react';

export const POCKET_MAX_WIDTH = 720;
export const POCKET_QUERY = `(max-width: ${POCKET_MAX_WIDTH}px), (pointer: coarse)`;

/**
 * Pure: narrow, or driven by a finger, is a pocket surface.
 * @param {{ width: number, coarsePointer: boolean }} input
 * @returns {boolean}
 */
export const isPocketSurface = ({ width, coarsePointer }) =>
  width <= POCKET_MAX_WIDTH || coarsePointer === true;

const matchesNow = () =>
  (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(POCKET_QUERY).matches
    : false);

/**
 * Live answer to […], re-evaluated when the media
 * query flips. impure (window).
 * @returns {boolean}
 */
export const usePocketSurface = () => {
  const [pocket, setPocket] = useState(matchesNow);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(POCKET_QUERY);
    const onChange = (event) => setPocket(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return pocket;
};
