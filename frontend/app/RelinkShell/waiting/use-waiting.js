// use-waiting — the desk's one subscription to what waits on the operator
// (GET /api/v1/waiting). It lives at the desk, beside the notification tray,
// so it outlives any window: the tray's mark and section and every platform
// window's band read this one account, and can never disagree.
//
// Fresh within a few seconds of anything changing: a calm poll while the
// tray's bell is on screen (use-visible-interval.js), and at once when the desk's
// own portal says a card rose or settled or a notice arrived. A NEW decision
// arriving outside a chat sounds the arrival chime — only when the operator
// has sound on (sound-engine.js decides), since a chat card already sounds in
// its own stream.
//
// While the desk is out of sight the visible poll rests; a slow read keeps a
// new decision able to reach the operator as an OS notice (os-notice.js) —
// only while that road exists and DESKTOP ALERTS is on.
//
// impure — REST reads, portal listeners, sound.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getWaiting } from '../../../services/waiting-client.js';
import { playSound } from '../../../services/sound-engine.js';
import { useVisibleInterval } from '../use-visible-interval.js';
import { arrivals, arrivalSounds } from './waiting-view.js';
import { OS_NOTICE_EVENT, isOsNoticeOn, osNoticeAvailable } from '../../../services/os-notice.js';

/** The desk's account, shared with every window (null outside the desk). */
export const WaitingContext = createContext(null);

/** The desk's account from inside a window, or null. */
export const useWaitingAccount = () => useContext(WaitingContext);

const POLL_MS = 6000;
const HIDDEN_POLL_MS = 30_000;
// The desk portal's frames that mean […].
const CHANGE_FRAMES = Object.freeze([
  'tool:approval_request', 'tool:approval_resolved', 'operator:ask', 'operator:ask_resolved',
  'operator:plan', 'operator:plan_resolved', 'seal:self_offer', 'seal:self_resolved', 'notification:new',
]);

/**
 * impure — { account, error, refresh, watch }: `account` is null until the
 * first read; `watch` is the callback ref of the element whose being on
 * screen keeps the poll running; `refresh()` reads now (after an act).
 * @param {object|null} wsService - the desk's portal
 */
export const useWaiting = (wsService) => {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState(null);
  const seen = useRef(null);
  const last = useRef('');
  const busy = useRef(null);

  const read = useCallback(async () => {
    const next = await getWaiting();
    const key = JSON.stringify(next);
    if (key === last.current) return;
    last.current = key;
    const fresh = arrivals(seen.current, next.items);
    seen.current = new Set(next.items.map((i) => i.id));
    if (arrivalSounds(fresh)) playSound('noticeArrival');
    setAccount(next);
  }, []);

  // One read at a time; a request that lands mid-read runs once more after it.
  const refresh = useCallback(() => {
    if (busy.current) { busy.current.again = true; return busy.current.done; }
    const run = { again: false };
    run.done = (async () => {
      do {
        run.again = false;
        try { await read(); setError(null); } catch (e) { setError(e.message); }
      } while (run.again);
      busy.current = null;
    })();
    busy.current = run;
    return run.done;
  }, [read]);

  const watch = useVisibleInterval(refresh, POLL_MS);

  useEffect(() => {
    let timer = null;
    const sync = () => {
      clearInterval(timer);
      timer = document.hidden && isOsNoticeOn() && osNoticeAvailable() ? setInterval(refresh, HIDDEN_POLL_MS) : null;
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener(OS_NOTICE_EVENT, sync);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener(OS_NOTICE_EVENT, sync);
    };
  }, [refresh]);

  useEffect(() => {
    if (!wsService?.on) return undefined;
    let timer = null;
    const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 250); };
    for (const type of CHANGE_FRAMES) wsService.on(type, soon);
    return () => {
      clearTimeout(timer);
      for (const type of CHANGE_FRAMES) wsService.off(type, soon);
    };
  }, [wsService, refresh]);

  return useMemo(() => ({ account, error, refresh, watch }), [account, error, refresh, watch]);
};
