// storage-scope.js — the desk's localStorage key scoping, extracted from
// window-storage (size law). Every persisted-desk module keys off these two;
// they live in their own leaf because window-storage's re-export barrel
// imports the split stores, and scoping left there would close a cycle.
//
// impure — localStorage + the window.neuma global the shell's preload exposes.

import { normalizeSlot } from '../RelinkShell/desk-focus.js';
import { entryModeSegment } from '../../utils/entry-mode-scope.js';

/**
 * Pure — the key segment a desk slot contributes. Desk 1 contributes
 * NOTHING: its keys are exactly the pre-multi-window keys, so the layout
 * every witness already has survives untouched (zero migration). Only
 * desks ≥ 2 gain a namespace.
 * @param {unknown} slot
 * @returns {string}
 */
const slotSegment = (slot) =>
  (Number.isInteger(slot) && /** @type {number} */ (slot) >= 2 ? `desk${slot}:` : '');

// Which desk this window IS — claimed at window creation and exposed by the
// preload (I-01). A plain browser tab (no shell) is desk 1.
// impure — reads the window.neuma global the shell's preload exposes.
const deskSlot = () => {
  try {
    return normalizeSlot(typeof window !== 'undefined' ? window.neuma?.deskSlot : null);
  } catch {
    return 1;
  }
};

// The harness and the full platform are two separate desks (utils/entry-mode-scope.js):
// the harness's keys carry `harness:`, the full platform's are unchanged.
export const scopedKey = (key) => {
  const seg = `${entryModeSegment()}${slotSegment(deskSlot())}`;
  try {
    const wallet = localStorage.getItem('walletAddress');
    return wallet ? `${wallet.toLowerCase()}:win:${seg}${key}` : `win:${seg}${key}`;
  } catch {
    return `win:${seg}${key}`;
  }
};

// The folder shelf is wallet-scoped but deliberately NOT slot-scoped: the
// FAVORITES/RECENTS macros belong to the WITNESS, and every desk window
// shares one shelf — opening a repo on desk 2 must surface it on desk 1.
// Like the desk itself, the shelf, drafts and desk prefs are the harness's or
// the full platform's own.
export const walletKey = (key) => operatorKey(`${entryModeSegment()}${key}`);

// The OPERATOR's own, in either state — the language they read in.
export const operatorKey = (key) => {
  try {
    const wallet = localStorage.getItem('walletAddress');
    return wallet ? `${wallet.toLowerCase()}:win:${key}` : `win:${key}`;
  } catch {
    return `win:${key}`;
  }
};
