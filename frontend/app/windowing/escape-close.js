// escape-close.js — Escape five times, outside everything, closes every window.
//
// Design note, 2026-10-05: […] Five presses is the deliberateness: no
// single slip clears a desk. Each press must follow the last within
// PRESS_GAP_MS, or the count starts again. Only a press made OUTSIDE everything
// counts — not while typing, not inside a window (a window may use Escape for
// itself), not while a dialog is up, and never a held key's auto-repeat.
//
// Pure — no React, no DOM beyond reading the event's target.

import { isTypingTarget } from './window-cycle.js';

export const CLOSE_ALL_PRESSES = 5;
export const PRESS_GAP_MS = 700;

/**
 * Does this keydown count toward the streak? Pure.
 * @param {{key:string, repeat?:boolean, target:EventTarget|null}} e
 * @param {{dialogOpen?:boolean}} [desk]
 */
export const countsTowardCloseAll = (e, { dialogOpen = false } = {}) => {
  if (e?.key !== 'Escape' || e.repeat || dialogOpen) return false;
  if (isTypingTarget(e.target)) return false;
  const el = e.target && typeof e.target.closest === 'function' ? e.target : null;
  return !el?.closest('.fwin, [role="dialog"], [role="menu"]');
};

/**
 * The streak after one press at `now`: one more if it follows the last press
 * closely enough, else a fresh count of one. Pure.
 * @param {{n:number, at:number}|null} streak
 * @param {number} now
 * @returns {{n:number, at:number}}
 */
export const nextStreak = (streak, now) => (streak && now - streak.at <= PRESS_GAP_MS
  ? { n: streak.n + 1, at: now }
  : { n: 1, at: now });
