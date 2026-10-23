// use-platform-pulse.js — the queue and the platforms' flight tests, read for
// the console headers (PlatformHeader.jsx) and the house board, every 30 s
// while seen (use-visible-interval.js), and again on demand after an act.
//
// impure — reads the platform.

import { useCallback, useState } from 'react';
import { getFlightTests, getPostQueue } from '../../services/social-channels-client.js';
import { useVisibleInterval } from './use-visible-interval.js';

/**
 * impure — { queue, tests, now, refresh, watch }: queue null until read; put
 * `watch` on the element whose visibility gates the poll.
 */
export const usePlatformPulse = () => {
  const [queue, setQueue] = useState(null);
  const [tests, setTests] = useState({});
  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(async () => {
    setNow(Date.now());
    const [staged, flight] = await Promise.all([
      getPostQueue().catch(() => null),
      getFlightTests().catch(() => null),
    ]);
    if (staged?.queue) setQueue(staged.queue);
    if (flight?.tests) setTests(flight.tests);
  }, []);
  const watch = useVisibleInterval(refresh, 30_000);
  return { queue, tests, now, refresh, watch };
};
