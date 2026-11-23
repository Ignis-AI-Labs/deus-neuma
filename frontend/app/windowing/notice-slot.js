// notice-slot — where the taskbar keeps a place for the notification marks, to the right of its clock (Founder,
// 2026-11-21: […]).
// The taskbar hands its slot element in; the notification tray reads it and draws its bell row there (a portal),
// so the marks sit IN the bar instead of floating over the window above it. With no taskbar on screen the tray
// keeps its own corner. One tiny store: no context, no prop drilling between two trees that never meet.
const listeners = new Set();
let slot = null;

/** impure — the taskbar's ref callback: its slot element, or null when it leaves. */
export const setNoticeSlot = (element) => {
  if (slot === element) return;
  slot = element ?? null;
  for (const fn of listeners) fn();
};

/** For useSyncExternalStore. */
export const subscribeNoticeSlot = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const readNoticeSlot = () => slot;
