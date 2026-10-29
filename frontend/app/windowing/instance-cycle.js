// instance-cycle.js — what a taskbar button does when its app has several windows.
//
// Design note, 2026-10-23 (the STREAM button wearing a […]): […]
// Ledger: docs/work/dock-stream-cycle.md.
//
// THE ORDER IS OPEN ORDER, the same law Shift+\ keeps (window-cycle.js): the
// window manager appends on open and only restacks `z` on focus, so a window's
// place in `state.windows` never moves while it lives. Most-recently-used
// would ping-pong between the last two forever and never reach the third —
// a click has no held modifier to freeze the list.
//
// Where the first click lands: when the person is somewhere ELSE (another app's
// window), the button brings back the window of this app they were last in
// (the frontmost) — […]. Once they are in one of its
// windows, every further click steps to the next, wrapping.
//
// Pure — no React, no DOM — so every decision is provable without a desk.

import { appIdOf, frontmostInstanceId } from './window-manager-reducer.js';

/**
 * The ids of an app's open windows, in open order. Pure.
 * @param {Array<{id: string}>} windows the manager's state.windows
 * @param {string} appId
 * @returns {string[]}
 */
export const instancesOf = (windows, appId) => (windows || [])
  .map((w) => w?.id)
  .filter((id) => typeof id === 'string' && appIdOf(id) === appId);

/**
 * What a plain click on an app's taskbar button raises. Pure.
 *
 * No window open → null (the caller opens one). One window → that window, as
 * it always was (`restore` false: a single window's click is unchanged). Two
 * or more → the next one in open order when the person is already in one of
 * them, else the one they were last in — and that window is `restore`d if it
 * sits minimized, because its turn has come.
 *
 * @param {Array<{id: string, z: number}>} windows
 * @param {string|null} focusedId
 * @param {string} appId
 * @returns {{id: string, restore: boolean}|null}
 */
export const clickTarget = (windows, focusedId, appId) => {
  const ids = instancesOf(windows, appId);
  if (ids.length === 0) return null;
  if (ids.length === 1) return { id: ids[0], restore: false };
  const at = ids.indexOf(focusedId);
  if (at === -1) return { id: frontmostInstanceId(windows, appId), restore: true };
  return { id: ids[(at + 1) % ids.length], restore: true };
};

/**
 * The hover list's rows: every open window of the app, in the SAME open order
 * the clicks step through (so the list is a map of where the next click goes),
 * the focused one marked, each carrying its ordinal for a fallback name. Pure.
 * @param {Array<{id: string, payload?: string}>} windows
 * @param {string|null} focusedId
 * @param {string} appId
 * @returns {Array<{id: string, focused: boolean, payload: (string|undefined)}>}
 */
export const instanceRows = (windows, focusedId, appId) => (windows || [])
  .filter((w) => typeof w?.id === 'string' && appIdOf(w.id) === appId)
  .map((w) => Object.freeze({ id: w.id, focused: w.id === focusedId, payload: w.payload }));

/**
 * Where the drop-up stands, in the taskbar's own coordinates: off the bar on
 * the side the desk is, aligned to the button it belongs to, and never past
 * the bar's far end. Pure — rects in, an inline style out.
 * @param {'bottom'|'top'|'left'} edge the bar's edge
 * @param {{left: number, right: number, top: number, bottom: number}} button
 * @param {{left: number, right: number, top: number, bottom: number, width: number}} bar
 * @param {number} [width] the list's widest expected size, for the clamp
 * @returns {{left: number, top?: number, bottom?: number}}
 */
export const listPlace = (edge, button, bar, width = 280) => {
  const GAP = 10;
  const left = Math.max(0, Math.min(button.left - bar.left, bar.width - width));
  if (edge === 'left') return { left: button.right - bar.left + GAP, bottom: bar.bottom - button.bottom };
  if (edge === 'top') return { left, top: button.bottom - bar.top + GAP };
  return { left, bottom: bar.bottom - button.top + GAP };
};
