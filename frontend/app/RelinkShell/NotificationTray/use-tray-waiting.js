// use-tray-waiting — WAITING ON YOU as the notification tray holds it (Founder,
// 2026-10-24: […]).
//
// The account is the desk's one subscription (use-waiting.js); this is how
// the tray shows it:
//   • `shown` — the account the bell's mark and the section read. Calm
//     (calm-gate.js): while the pointer is on the tray, or focus inside it, a
//     new account waits and lands the moment they leave, so rows never move
//     under the pointer.
//   • `toasts` — what just ARRIVED, risen once in the tray's toast lane, the
//     same cue a new notification gets. Not calm-gated: an arrival is never
//     held back. A decision already on screen in the window in front (a chat
//     card rising in the chat being typed in) needs no toast. The arrival
//     sound is use-waiting's — once per read, under the sound setting.
//   • an OS notice — the same arrival, ONCE, when the desk is out of sight
//     (hidden, minimised, another app in front) and DESKTOP ALERTS is on
//     (waiting-notice.js decides, os-notice.js raises; its click lands on the
//     card through the waiting-jump path).
//
// impure — timers, reads the DOM for the window in front, the OS notice.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCalmGate } from '../use-calm-gate.js';
import { useWaitingAccount } from '../waiting/use-waiting.js';
import { arrivals, cardSelector, indicatorLine, nextToasts } from '../waiting/waiting-view.js';
import { waitingNotices } from '../waiting/waiting-notice.js';
import { requestWaitingJump } from '../waiting/waiting-jump.js';
import { deskOnScreen, isOsNoticeOn, raiseOsNotice } from '../../../services/os-notice.js';

const TICK_MS = 30_000;

// impure — is this item's card already on screen in the focused window?
const inFront = (item) => {
  const selector = cardSelector(item);
  const el = selector ? document.querySelector(selector) : null;
  return Boolean(el?.closest('.fwin.is-focused')) && document.hasFocus();
};

/**
 * impure — { waiting, shown, line, now, error, toasts, arriving, dropToast, handlers }
 * @param {{toastMs: number, graceMs: number}} timing - the tray's own toast clock
 */
export const useTrayWaiting = ({ toastMs, graceMs }) => {
  const waiting = useWaitingAccount();
  const account = waiting?.account ?? null;
  const calm = useCalmGate();
  const [shown, setShown] = useState(account);
  const [now, setNow] = useState(() => Date.now());
  const [toasts, setToasts] = useState([]);
  const [arriving, setArriving] = useState(() => new Set());
  const seen = useRef(null);
  const notified = useRef(new Set());
  const timers = useRef(new Set());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    const owned = timers.current;
    return () => { clearInterval(id); for (const t of owned) clearTimeout(t); };
  }, []);

  const later = useCallback((fn, ms) => {
    const t = setTimeout(() => { timers.current.delete(t); fn(); }, ms);
    timers.current.add(t);
  }, []);

  useEffect(() => {
    if (!account) return;
    calm.offer('account', () => { setShown(account); setNow(Date.now()); });
    const fresh = arrivals(seen.current, account.items).filter((item) => !inFront(item));
    seen.current = new Set(account.items.map((i) => i.id));
    setToasts((prev) => nextToasts(prev, fresh, account.items));
    if (!fresh.length) return;
    const notices = waitingNotices({ fresh, notified: notified.current, deskOnScreen: deskOnScreen(), enabled: isOsNoticeOn() });
    for (const { item, notice } of notices) {
      notified.current.add(notice.id);
      raiseOsNotice(notice, () => requestWaitingJump(item));
    }
    const ids = fresh.map((f) => f.id);
    setArriving((prev) => new Set([...prev, ...ids]));
    later(() => setArriving((prev) => new Set([...prev].filter((id) => !ids.includes(id)))), graceMs);
    later(() => setToasts((prev) => prev.filter((t) => !ids.includes(t.id))), toastMs);
  }, [account, calm, later, graceMs, toastMs]);

  const dropToast = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  return {
    waiting,
    shown,
    line: indicatorLine(shown, now),
    now,
    error: waiting?.error ?? null,
    toasts,
    arriving,
    dropToast,
    handlers: calm.handlers,
  };
};
