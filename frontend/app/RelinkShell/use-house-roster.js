import { useCallback, useEffect, useRef, useState } from 'react';
import { recoverRoster } from '../roster-recovery.js';
import { getRoster } from '../../utils/companion-data.js';

/** Recover the house without presenting a failed read as an empty roster. */
// impure — authenticated HTTP, browser cache, events and request lifetime.
export const useHouseRoster = () => {
  const [result, setResult] = useState(() => ({ roster: getRoster(), house: null, loading: true, error: null }));
  const pending = useRef(null);
  const refresh = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setResult((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const recovered = await recoverRoster({ strict: true, signal: controller.signal });
      if (controller.signal.aborted) return;
      setResult({ roster: getRoster(), house: recovered.house, loading: false, error: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      setResult((previous) => ({ ...previous, loading: false, error: error.message || 'House could not be read.' }));
    }
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener('birth:complete', refresh);
    return () => {
      pending.current?.abort();
      window.removeEventListener('birth:complete', refresh);
    };
  }, [refresh]);
  return { ...result, refresh };
};
