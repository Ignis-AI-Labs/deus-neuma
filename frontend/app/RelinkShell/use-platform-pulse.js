// use-platform-pulse.js — the queue and the platforms' flight tests, read for
// the console headers (PlatformHeader.jsx) and the house board, every 30 s
// while seen (use-visible-interval.js), and again on demand after an act.
//
// impure — reads the platform.

import { useCallback, useRef, useState } from 'react';
import { getFlightTests, getPostQueue } from '../../services/social-channels-client.js';
import { useVisibleInterval } from './use-visible-interval.js';

/**
 * impure — { queue, tests, now, refresh, watch }: queue null until read; put
 * `watch` on the element whose visibility gates the poll. `calm` (use-calm-
 * gate.js) holds the POLL's news while the person works the window; a
 * `refresh()` after their own act lands at once.
 * @param {{calm?: {offer: Function, now: Function}}} [opts]
 */
export const usePlatformPulse = ({ calm = null } = {}) => {
  const [queue, setQueue] = useState(null);
  const [tests, setTests] = useState({});
  const [now, setNow] = useState(() => Date.now());
  const loaded = useRef(false);
  const read = useCallback(async ({ background = false } = {}) => {
    setNow(Date.now());
    const [staged, flight] = await Promise.all([
      getPostQueue().catch(() => null),
      getFlightTests().catch(() => null),
    ]);
    const apply = () => {
      if (staged?.queue) { setQueue(staged.queue); loaded.current = true; }
      if (flight?.tests) setTests(flight.tests);
    };
    // The first read always lands: there is nothing on screen to keep still.
    if (!calm || !loaded.current) apply();
    else if (background) calm.offer('pulse', apply);
    else calm.now('pulse', apply);
  }, [calm]);
  const refresh = useCallback(() => read(), [read]);
  const watch = useVisibleInterval(() => read({ background: true }), 30_000);
  return { queue, tests, now, refresh, watch };
};
