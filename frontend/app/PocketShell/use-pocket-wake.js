// use-pocket-wake — hold the screen awake while the being works for this
// surface or waits on it (pocket-wake.js decides). impure (Wake Lock API,
// document events). A browser without the API, or one that refuses (low
// battery), is left alone: the lock is a courtesy, never a requirement.
import { useEffect } from 'react';

/**
 * @param {boolean} wanted
 */
export const usePocketWake = (wanted) => {
  useEffect(() => {
    if (!wanted || typeof navigator === 'undefined' || !navigator.wakeLock) return undefined;
    let lock = null;
    let alive = true;
    const hold = async () => {
      if (!alive || document.visibilityState !== 'visible') return;
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        lock = null; // refused — the phone will sleep as it always did
      }
    };
    // A lock is released by the browser when the page hides; take it again on return.
    const onVisible = () => { if (document.visibilityState === 'visible') hold(); };
    hold();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      try { lock?.release(); } catch { /* already gone */ }
      lock = null;
    };
  }, [wanted]);
};
