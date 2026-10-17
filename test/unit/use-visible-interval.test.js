// createVisibleInterval — the poll runs only while the page is visible AND the
// watched element is on screen, and runs at once on coming back into view.
// Timers are injected (a real call log, no fake-timer library).
import { describe, test, expect } from 'vitest';
import { createVisibleInterval, isShowing } from '../../frontend/app/RelinkShell/use-visible-interval.js';

const harness = () => {
  const log = [];
  let next = 1;
  const live = new Set();
  const gate = createVisibleInterval({
    run: () => log.push('run'),
    ms: 1500,
    setTimer: () => { const id = next++; live.add(id); return id; },
    clearTimer: (id) => live.delete(id),
  });
  return { gate, log, live };
};

describe('createVisibleInterval', () => {
  test('starts running at once while visible', () => {
    const { gate, log, live } = harness();
    expect(log).toEqual(['run']);
    expect(live.size).toBe(1);
    expect(gate.running()).toBe(true);
  });
  test('a window-shade (off screen) stops the timer; coming back runs fresh at once', () => {
    const { gate, log, live } = harness();
    gate.setOnScreen(false);
    expect(live.size).toBe(0);
    gate.setOnScreen(true);
    expect(log).toEqual(['run', 'run']);
    expect(live.size).toBe(1);
  });
  test('a hidden desk stops it too, and both must be true to run', () => {
    const { gate, log, live } = harness();
    gate.setPageVisible(false);
    gate.setOnScreen(false);
    gate.setPageVisible(true); // still off screen
    expect(live.size).toBe(0);
    expect(log).toEqual(['run']);
    gate.setOnScreen(true);
    expect(live.size).toBe(1);
  });
  test('repeated same-state signals never stack timers or double-run', () => {
    const { gate, log, live } = harness();
    gate.setOnScreen(true); gate.setPageVisible(true);
    expect(live.size).toBe(1);
    expect(log).toEqual(['run']);
  });
  test('a window-shaded frame (window-shown.js) stops it; unshading runs fresh at once', () => {
    const { gate, log, live } = harness();
    gate.setWindowShown(false);
    expect(live.size).toBe(0);
    gate.setWindowShown(true);
    expect(log).toEqual(['run', 'run']);
    expect(live.size).toBe(1);
  });
  test('a gate born hidden or shaded never runs until it is seen', () => {
    for (const born of [{ page: false }, { shown: false }, { screen: false }]) {
      const log = [];
      const live = new Set();
      let next = 1;
      const gate = createVisibleInterval({
        run: () => log.push('run'),
        ms: 1500,
        setTimer: () => { const id = next++; live.add(id); return id; },
        clearTimer: (id) => live.delete(id),
        ...born,
      });
      expect(log).toEqual([]);
      expect(live.size).toBe(0);
      gate.setPageVisible(true); gate.setWindowShown(true); gate.setOnScreen(true);
      expect(log).toEqual(['run']);
      expect(live.size).toBe(1);
    }
  });
  test('stop is final', () => {
    const { gate, live } = harness();
    gate.stop();
    gate.setOnScreen(true); gate.setPageVisible(true);
    expect(live.size).toBe(0);
  });
});

describe('isShowing', () => {
  test('a zero-area box on the viewport edge is not showing (the window-shade case)', () => {
    expect(isShowing({ isIntersecting: true, intersectionRect: { width: 640, height: 0 } })).toBe(false);
    expect(isShowing({ isIntersecting: true, intersectionRect: { width: 640, height: 12 } })).toBe(true);
    expect(isShowing({ isIntersecting: false, intersectionRect: { width: 0, height: 0 } })).toBe(false);
  });
});
