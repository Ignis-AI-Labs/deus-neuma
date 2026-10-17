// use-session-clock.js — the desk's session age, as React state (#185).
//
// impure hook: the clock arms when the link becomes ACTIVE (link.cls 'live')
// and resets ONLY on sever — a substrate dip (offline/checking) is a degraded
// session, not a new one, so the count survives it. True elapsed time from a
// 1s interval (the one sanctioned loop); under prefers-reduced-motion there
// is no ticking interval — each render reads the wall-time elapsed once.

import { useEffect, useRef, useState } from 'react';

// impure — the witness's motion preference, read once at mount (ArrivalVeil idiom)
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {string} linkCls - deriveLinkStatus().cls ('live' | 'shared' | 'offline' | 'checking' | 'severed')
 * @returns {number} elapsed session seconds
 */
export const useSessionClock = (linkCls) => {
  const [reduced] = useState(reducedMotion);
  // Wall time the link became ACTIVE; null while no session is being measured.
  const startRef = useRef(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    // Sever ends the session — the clock's only reset.
    if (linkCls === 'severed') {
      startRef.current = null;
      setElapsed(0);
      return undefined;
    }
    if (linkCls !== 'live') return undefined;
    if (startRef.current == null) {
      startRef.current = Date.now();
      setElapsed(0);
    }
    if (reduced) return undefined; // wall time is read at render — no interval
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [linkCls, reduced]);

  // Reduced motion: the elapsed as of this render, computed once — no ticking.
  if (reduced && startRef.current != null) {
    return Math.floor((Date.now() - startRef.current) / 1000); // impure wall-time read
  }
  return elapsed;
};
