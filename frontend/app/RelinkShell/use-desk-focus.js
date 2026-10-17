// use-desk-focus.js — THIS window's working focus, as React state.
//
// impure hook: owns the window's focus (client-held per D2, per-slot
// persisted, D11 spawn/restore semantics) and the legacy compat shim that
// keeps existing desks on the global active-project lens until Waves 2-3
// ship the switching UX. Every decision is pure (desk-focus.js); only
// storage and the window/sessionStorage reads live here.

import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { loadFocus, saveFocus } from '../windowing/window-storage.js';
import { focusEquals, normalizeFocus, normalizeSlot, resolveSpawnFocus } from './desk-focus.js';

// Shared like ConsciousnessContext/ProjectContext: provided at the desk host
// (RelinkShell), read by window surfaces. Consumers arrive in Waves 2-3.
export const FocusContext = createContext(null);

// Per-window spawn marker (D11): sessionStorage survives a reload and dies
// with the window, so its presence distinguishes reload from fresh spawn.
const SPAWN_MARKER_KEY = 'neuma.desk.spawned';

// Which desk this window IS — claimed at window creation and exposed by the
// preload. A plain browser tab (no shell) is desk 1.
// impure — reads the window.neuma global the shell's preload exposes.
const deskSlot = () => {
  try {
    return normalizeSlot(typeof window !== 'undefined' ? window.neuma?.deskSlot : null);
  } catch {
    return 1;
  }
};

// impure — sessionStorage probe for the spawn marker.
const hasSpawnMarker = () => {
  try {
    return sessionStorage.getItem(SPAWN_MARKER_KEY) === '1';
  } catch {
    return false;
  }
};

export const useDeskFocus = ({ activeProject = null } = {}) => {
  // The window's EXPLICIT focus. `undefined` means no explicit focus exists
  // (nothing restored, nothing set) — the compat shim below derives the lens
  // instead. `null` means explicitly unfocused. The initializer only READS
  // (marker + storage); arming the marker happens in the effect below, so a
  // double-invoked initializer cannot see its own write and change verdict.
  const [explicit, setExplicit] = useState(
    () => resolveSpawnFocus(deskSlot(), hasSpawnMarker(), loadFocus()) ?? undefined,
  );
  const explicitRef = useRef(explicit);
  explicitRef.current = explicit;

  // Arm the spawn marker on first mount so a reload of THIS window restores
  // its focus while a fresh desk spawn opens unfocused (D11). Idempotent.
  useEffect(() => {
    try {
      sessionStorage.setItem(SPAWN_MARKER_KEY, '1');
    } catch {
      // Private mode — reloads then behave like fresh spawns; never fatal.
    }
  }, []);

  // COMPAT SHIM — retires in Wave 2 with the open-gesture/switching UX.
  // While this window has NO explicit focus, the lens is seeded live from
  // the legacy global active project, exactly the desk's pre-focus behavior:
  // existing desks keep their lens, and ProjectsApp's activate (still
  // global-only this wave) keeps moving the strip and the memory scope.
  // Derived, never persisted — persistence records only what this window
  // explicitly chose, so the shim can never fork from the global store.
  const focus = explicit !== undefined
    ? explicit
    : (activeProject ? Object.freeze({ kind: 'project', id: activeProject.id }) : null);

  // Set (and persist) this window's focus. The value is re-validated at the
  // boundary — garbage degrades to null (unfocused), never a malformed lens.
  const setFocus = useCallback((next) => {
    const normalized = normalizeFocus(next);
    if (explicitRef.current !== undefined && focusEquals(explicitRef.current, normalized)) return;
    setExplicit(normalized);
    saveFocus(normalized); // impure edge: persistence rides every real change
  }, []);

  const clearFocus = useCallback(() => {
    setFocus(null);
  }, [setFocus]);

  return { focus, setFocus, clearFocus };
};
