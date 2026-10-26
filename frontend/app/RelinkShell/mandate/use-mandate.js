// use-mandate — ONE subscription to the house's MANDATE, shared by every
// surface that shows it (the notification tray's MANDATE row, the MARKETING window, the
// House Clock): a calm poll while any of them is mounted, and an act's answer
// lands in all of them at once, so a WITHDRAW pressed in one place reads
// withdrawn everywhere — the bell's mandate mark included: every act reads
// the desk's WAITING ON YOU account again (it carries the active mandate).
//
// impure — REST reads, a module-level subscription.

import { useCallback, useEffect, useState } from 'react';
import { getMandate } from '../../../services/mandate-client.js';
import { useWaitingAccount } from '../waiting/use-waiting.js';

const POLL_MS = 10_000;
const listeners = new Set();
let shared = { view: null, error: null };
let timer = null;

const publish = (next) => {
  shared = next;
  for (const fn of listeners) fn(shared);
};

// impure — one read for every surface.
const read = async () => {
  try {
    publish({ view: await getMandate(), error: null });
  } catch (err) {
    publish({ ...shared, error: err.message });
  }
};

/**
 * impure — { view, error, refresh, act }: `act(fn)` runs one mandate act and
 * lands its fresh view in every surface; it rethrows the act's error.
 */
export const useMandate = () => {
  const [state, setState] = useState(shared);
  const refreshWaiting = useWaitingAccount()?.refresh;
  useEffect(() => {
    listeners.add(setState);
    if (listeners.size === 1) {
      read();
      timer = setInterval(read, POLL_MS);
    }
    return () => {
      listeners.delete(setState);
      if (!listeners.size) { clearInterval(timer); timer = null; }
    };
  }, []);
  const act = useCallback(async (fn) => {
    const out = await fn();
    if (out?.view) publish({ view: out.view, error: null });
    else await read();
    refreshWaiting?.();
    return out;
  }, [refreshWaiting]);
  return { ...state, refresh: read, act };
};
