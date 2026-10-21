// use-self-check.js — the STATE tab's self-check state: the kept runs, the run
// in flight (polled while one runs, never otherwise), and the owner's RUN.
// impure (fetch + timers).

import { useCallback, useEffect, useState } from 'react';
import { loadSelfCheck, startSelfCheck } from './stats-client.js';
import { useSettled } from './use-settled.js';

const POLL_MS = 5000;

/**
 * @param {string|null} neumaId
 * @returns {{check: Object|null|undefined, starting: boolean, startError: string|null, start: () => Promise<void>}}
 *   check — undefined while loading, null when unreadable
 */
export const useSelfCheck = (neumaId) => {
  const [check, setCheck] = useState(undefined);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);
  const [tick, setTick] = useState(0);

  useSettled((settled) => {
    if (!neumaId) { setCheck(null); return; }
    loadSelfCheck(neumaId).then((body) => { if (!settled()) setCheck(body); });
  }, [neumaId, tick]);

  const inFlight = Boolean(check?.running || check?.busyElsewhere);
  useEffect(() => {
    if (!inFlight) return undefined;
    const timer = setTimeout(() => setTick((t) => t + 1), POLL_MS);
    return () => clearTimeout(timer);
  }, [inFlight, check]);

  const start = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    const result = await startSelfCheck(neumaId);
    setStarting(false);
    if (!result.ok) setStartError(result.error);
    setTick((t) => t + 1);
  }, [neumaId]);

  return { check, starting, startError, start };
};
