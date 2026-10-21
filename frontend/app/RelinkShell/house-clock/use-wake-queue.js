// use-wake-queue — the house's wake queue for the member cards' lights: read
// only while the cards can be seen (use-visible-interval.js, the gate every
// desk poll rides, as the HOUSE CLOCK window's own poll does), at the clock
// window's pace. The route answers only for the calling wallet's own house.
// A read that fails clears the reading: a light must never show a state the
// house is no longer known to be in.
//
// impure — fetch, timers, React state.

import { useState } from 'react';
import { getWakeQueue } from '../../../services/house-clock-client.js';
import { useVisibleInterval } from '../use-visible-interval.js';

const POLL_MS = 4000;

/**
 * @returns {{queue: ?Object, watch: (node: Element|null) => void}} watch — put
 *   on the element whose visibility gates the poll
 */
export const useWakeQueue = () => {
  const [queue, setQueue] = useState(null);
  const watch = useVisibleInterval(() => {
    getWakeQueue().then(setQueue, () => setQueue(null));
  }, POLL_MS);
  return { queue, watch };
};
