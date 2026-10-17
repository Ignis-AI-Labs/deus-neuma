// taskbar-storage.js — the person's taskbar preferences (pins, names, edge),
// per wallet and per desk slot like every desk store (storage-scope.js).
// Shapes are normalized by taskbar-model.normalizePrefs at the reader.
//
// impure — localStorage.

import { scopedKey } from './storage-scope.js';

const KEY = 'taskbar';

/** The saved prefs, raw (null when none or unreadable). */
export const loadTaskbarPrefs = () => {
  try {
    const raw = localStorage.getItem(scopedKey(KEY));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const saveTaskbarPrefs = (prefs) => {
  try {
    localStorage.setItem(scopedKey(KEY), JSON.stringify({ pins: prefs.pins, labels: prefs.labels, edge: prefs.edge }));
  } catch { /* storage full or blocked — the bar still works this session */ }
};
