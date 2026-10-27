// use-machine.js — the machine's thermal and tuning readings for the SUBSTRATE
// HUD, polled every 5 s while the window is seen (use-visible-interval.js),
// with the sense memory (machine-sense.js) carried across the polls so a
// floating board input is known by its jumps.
//
// impure — reads the platform through machine-client.js.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMachine } from './machine-client.js';
import { useVisibleInterval } from './use-visible-interval.js';
import { NO_SENSE, trackSense } from './machine-sense.js';

const MACHINE_POLL_MS = 5000;

/**
 * impure — `[machine, watchRef, sense]`: machine is undefined while the first
 * read is in flight and null when the platform did not answer; put watchRef on
 * the element whose visibility gates the poll; sense is the sense memory.
 */
export const useMachine = () => {
  const [machine, setMachine] = useState(undefined);
  const [sense, setSense] = useState(NO_SENSE);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const refresh = useCallback(async () => {
    const m = await loadMachine();
    if (!alive.current) return;
    setMachine(m);
    if (m?.readings) setSense((prev) => trackSense(prev, m.readings));
  }, []);
  const watch = useVisibleInterval(refresh, MACHINE_POLL_MS);
  return [machine, watch, sense];
};
