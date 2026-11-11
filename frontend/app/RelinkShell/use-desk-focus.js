// use-desk-focus.js — THIS window's working focus, as React state.
//
// impure hook: owns the window's focus (client-held per D2, per-slot
// persisted, D11 spawn/restore semantics). Every decision is pure
// (desk-focus.js); only storage and the window/sessionStorage reads live here.

import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { loadFocus, saveFocus } from '../windowing/window-storage.js';
import { focusEquals, normalizeFocus, normalizeSlot, resolveSpawnFocus } from './desk-focus.js';

// Shared like ConsciousnessContext: provided at the desk host (RelinkShell),
// read by window surfaces.
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

export const useDeskFocus = () => {
  // The window's EXPLICIT focus. `undefined` means no explicit focus exists
  // (nothing restored, nothing set); `null` means explicitly unfocused. Both
  // read as unfocused. The initializer only READS
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

  const focus = explicit ?? null;

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
