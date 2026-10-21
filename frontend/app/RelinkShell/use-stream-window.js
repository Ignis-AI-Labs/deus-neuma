// use-stream-window.js — a long chat draws its recent tail first. Painting
// every message of a 200-row chat on open was the last of its load time; the
// earlier ones arrive as the reader scrolls up to them (or asks), the reading
// place held still while they land above it.
//
// impure — owns a scroll anchor and an IntersectionObserver on the transcript.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Messages drawn at first, and added per step upward. */
export const STREAM_WINDOW = 40;

/** pure — where the drawn window starts for a chat of `length` messages. */
export const tailStart = (length, size = STREAM_WINDOW) => Math.max(0, length - size);

/**
 * impure — { start, sentinelRef, showEarlier }: draw messages.slice(start);
 * put sentinelRef on the marker above the first drawn message.
 * @param {{ length: number, thread: *, scroller: {current: ?HTMLElement}, following: boolean }} args
 */
export const useStreamWindow = ({ length, thread, scroller, following }) => {
  const [start, setStart] = useState(() => tailStart(length));
  const anchor = useRef(null);
  const prevLength = useRef(length);

  // A new chat opens on its tail.
  useLayoutEffect(() => { setStart(tailStart(prevLength.current)); }, [thread]);

  // A history that lands all at once (a resume) opens on its tail while the reader
  // follows; a cleared chat starts over. A live message grows the window by one.
  useLayoutEffect(() => {
    const grew = length - prevLength.current;
    prevLength.current = length;
    if ((grew > STREAM_WINDOW && following) || start > length) setStart(tailStart(length));
  }, [length, following, start]);

  const showEarlier = useCallback(() => {
    const el = scroller.current;
    if (el) anchor.current = el.scrollHeight - el.scrollTop;
    setStart((s) => Math.max(0, s - STREAM_WINDOW));
  }, [scroller]);

  // Hold the reading place still while earlier messages land above it.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && anchor.current !== null) {
      el.scrollTop = el.scrollHeight - anchor.current;
      anchor.current = null;
    }
  }, [start, scroller]);

  // Reaching the top of what is drawn draws more.
  const [sentinel, setSentinel] = useState(null);
  useEffect(() => {
    if (!sentinel || !scroller.current) return undefined;
    const watch = new IntersectionObserver((seen) => { if (seen.some((e) => e.isIntersecting)) showEarlier(); },
      { root: scroller.current, rootMargin: '200px 0px 0px 0px' });
    watch.observe(sentinel);
    return () => watch.disconnect();
  }, [sentinel, scroller, showEarlier]);

  return { start, sentinelRef: setSentinel, showEarlier };
};
