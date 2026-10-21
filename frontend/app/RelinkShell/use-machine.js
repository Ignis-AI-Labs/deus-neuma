// use-machine.js — the machine's thermal and tuning readings for the SUBSTRATE
// HUD, polled every 5 s while the window is seen (use-visible-interval.js).
//
// impure — reads the platform through machine-client.js.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMachine } from './machine-client.js';
import { useVisibleInterval } from './use-visible-interval.js';

const MACHINE_POLL_MS = 5000;

/**
 * impure — `[machine, watchRef]`: machine is undefined while the first read is
 * in flight and null when the platform did not answer; put watchRef on the
 * element whose visibility gates the poll.
 */
export const useMachine = () => {
  const [machine, setMachine] = useState(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const refresh = useCallback(async () => {
    const m = await loadMachine();
    if (alive.current) setMachine(m);
  }, []);
  const watch = useVisibleInterval(refresh, MACHINE_POLL_MS);
  return [machine, watch];
};
