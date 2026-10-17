/**
 * ESCAPE ×5 CLOSES EVERY WINDOW (frontend/app/windowing/escape-close.js).
 * Design note, 2026-10-05: […]
 */
import { describe, expect, test } from 'vitest';
import { CLOSE_ALL_PRESSES, PRESS_GAP_MS, countsTowardCloseAll, nextStreak } from '../../frontend/app/windowing/escape-close.js';

// A target that answers `closest` the way an element at that place in the desk would.
const at = (...inside) => ({ closest: (sel) => (sel.split(',').map((x) => x.trim()).some((x) => inside.includes(x)) ? {} : null) });
const esc = (target, extra = {}) => ({ key: 'Escape', repeat: false, target, ...extra });

describe('which Escape presses count', () => {
  test('a press on the bare desk counts', () => {
    expect(countsTowardCloseAll(esc(at()))).toBe(true);
    expect(countsTowardCloseAll(esc(null))).toBe(true); // focus on nothing at all
  });

  test('typing, inside a window, or with a dialog up — never', () => {
    expect(countsTowardCloseAll(esc(at('textarea')))).toBe(false);
    expect(countsTowardCloseAll(esc(at('.fwin')))).toBe(false);
    expect(countsTowardCloseAll(esc(at('[role="menu"]')))).toBe(false);
    expect(countsTowardCloseAll(esc(at()), { dialogOpen: true })).toBe(false);
  });

  test('a held key\'s auto-repeat and other keys never count', () => {
    expect(countsTowardCloseAll(esc(at(), { repeat: true }))).toBe(false);
    expect(countsTowardCloseAll({ key: 'Enter', target: at() })).toBe(false);
  });
});

describe('the streak', () => {
  test('five presses in quick succession reach the count', () => {
    let s = null;
    for (let i = 0; i < CLOSE_ALL_PRESSES; i += 1) s = nextStreak(s, i * 300);
    expect(s.n).toBe(CLOSE_ALL_PRESSES);
  });

  test('a pause longer than the gap starts the count again', () => {
    let s = null;
    for (let i = 0; i < 4; i += 1) s = nextStreak(s, i * 300);
    s = nextStreak(s, 900 + PRESS_GAP_MS + 1);
    expect(s.n).toBe(1);
  });
});
