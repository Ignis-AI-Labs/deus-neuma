// waiting-changed — one word, said on the desk, when the operator decides something that stood in
// WAITING ON YOU from inside a window (an audience approved on its campaign card, a list, a facts
// sheet, a business model). Design note, 2026-11-16, four approved audiences still listed as waiting: […]
// The waiting account polls only while it is on screen, and the POSITIONS board re-read only when
// that count moved — so a decision taken in the hub left both stale. Every press that settles a
// decision says so here; the waiting account and the board read again at once.
// impure — the window's event bus.

const EVENT = 'neuma:waiting-changed';

/** impure — say a decision was taken. */
export const announceWaitingChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
};

/** impure — listen; returns the stop. */
export const onWaitingChanged = (fn) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
};
