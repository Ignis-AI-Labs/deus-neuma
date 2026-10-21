// WindowManager — owns the set of open windows for a desk.
//
// Wraps the pure window-manager reducer and bridges it to persistence:
// the open-set (which apps are open / minimized) is restored on mount via
// a lazy initializer and saved on every change, per wallet. The app
// registry (appId -> { label, icon, title, controls, Body, storageKey,
// multiInstance?, makeTitle? }) is host-supplied, so the manager stays
// app-agnostic.

import { createContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { reducer, hydrate, isValidWindowId, dedupeById, appIdOf } from './window-manager-reducer.js';
import { loadDesk, saveDesk } from './window-storage.js';
import { cycleDirection, isTypingTarget, nextWindowId } from './window-cycle.js';
import { CLOSE_ALL_PRESSES, countsTowardCloseAll, nextStreak } from './escape-close.js';

export const WindowContext = createContext(null);

export const WindowManager = ({ registry, defaultOpen = [], children }) => {
  // Panel-only law (D12): an app flagged `panel: true` lives in the desk's
  // rail, never as a floating window — saved open-sets from before the law
  // (and any defaultOpen entry) are filtered generically by the flag.
  const isWindowable = (id) => !registry[appIdOf(id)]?.panel;
  const [state, dispatch] = useReducer(reducer, null, () => {
    const saved = loadDesk();
    const seed = saved && saved.length
      // localStorage is a boundary: drop apps no longer registered, any
      // malformed/hostile instance id, and duplicate ids (a duplicate would
      // collide as a React key) before they can reach the DOM.
      ? dedupeById(saved.filter((w) => isValidWindowId(registry, w?.id) && isWindowable(w.id)))
      : defaultOpen.filter(isWindowable).map((id) => ({ id }));
    return hydrate(seed);
  });

  // Persist the open-set whenever it changes (geometry persists per-window
  // separately via useWindowFrame's storageKey). A window's spawn payload
  // rides along so an editor reopens on its file after a reload.
  useEffect(() => {
    saveDesk(state.windows.map((w) => (w.payload === undefined ? { id: w.id } : { id: w.id, payload: w.payload })));
  }, [state.windows]);

  // SHIFT+\ MOVES BETWEEN OPEN WINDOWS (ruling, 2026-07-27) — the muscle memory he
  // already has from his editor, carried onto the desk. Ctrl/Cmd+Shift+\ goes
  // back. Lives here because this is where the window set and the dispatch are;
  // a listener nearer the windows would need the state passed down to it.
  //
  // The guard is the load-bearing part: Shift+\ IS the `|` character, so an
  // unguarded handler would steal every pipe typed into the composer, the
  // terminal, a path or a regex. Inside a text surface this does nothing at all.
  useEffect(() => {
    const onKey = (e) => {
      const direction = cycleDirection(e);
      if (!direction || isTypingTarget(e.target)) return;
      const id = nextWindowId(state.windows, state.focusedId, direction);
      if (!id) return; // nothing open, or only one — no pointless focus
      e.preventDefault();
      dispatch({ type: 'FOCUS', id });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.windows, state.focusedId]);

  // ESCAPE ×5, OUTSIDE EVERYTHING, CLOSES EVERY WINDOW (ruling, 2026-10-05) —
  // escape-close.js holds the rules. Each window leaves the way its own ×
  // would take it: the app's close hook first, then out of the open-set.
  const escapes = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (!countsTowardCloseAll(e, { dialogOpen: Boolean(document.querySelector('[role="dialog"]')) })) {
        if (!e.repeat) escapes.current = null;
        return;
      }
      escapes.current = nextStreak(escapes.current, performance.now());
      if (escapes.current.n < CLOSE_ALL_PRESSES) return;
      escapes.current = null;
      for (const w of state.windows) {
        registry[appIdOf(w.id)]?.onClose?.(w.id);
        dispatch({ type: 'CLOSE', id: w.id });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [registry, state.windows]);

  // One value per real change: the desk host re-renders every streamed frame,
  // and a fresh object here re-rendered every window consumer with it.
  const value = useMemo(() => ({ registry, state, dispatch }), [registry, state]);
  return (
    <WindowContext.Provider value={value}>
      {children}
    </WindowContext.Provider>
  );
};
