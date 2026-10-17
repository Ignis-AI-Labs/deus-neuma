// Where a new window opens: centred on the primary screen, or over its parent.
// Pure geometry — real inputs, real outputs (the live placement is proven by
// a real Electron window on the real window manager; see the release-handoff ledger).
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { centerIn, centerOver } = require('../../electron/primary-placement.cjs');

// Founder's primary on 2026-10-14: the 3440x1440 ultrawide, second from the left.
const PRIMARY = { x: 1920, y: 0, width: 3440, height: 1440 };

describe('centerIn — a new window opens in the middle of the primary screen', () => {
  it('centres a desk on an offset primary, never on the screen at the origin', () => {
    expect(centerIn(PRIMARY, { width: 1280, height: 832 })).toEqual({ x: 3000, y: 304, width: 1280, height: 832 });
  });

  it('shrinks a window larger than the screen to fit it, anchored at its corner', () => {
    expect(centerIn({ x: 0, y: 0, width: 1366, height: 768 }, { width: 1440, height: 900 }))
      .toEqual({ x: 0, y: 0, width: 1366, height: 768 });
  });

  it('lands whole pixels on odd remainders', () => {
    const b = centerIn({ x: 0, y: 0, width: 1921, height: 1081 }, { width: 460, height: 560 });
    expect(Number.isInteger(b.x) && Number.isInteger(b.y)).toBe(true);
  });
});

describe('centerOver — a child window opens over its parent', () => {
  it('centres the wallet confirm over the desk wherever the desk stands', () => {
    expect(centerOver({ x: 3000, y: 304, width: 1280, height: 832 }, { width: 460, height: 560 }))
      .toEqual({ x: 3410, y: 440 });
  });

  it('never shrinks the child to a smaller parent', () => {
    expect(centerOver({ x: 100, y: 100, width: 300, height: 300 }, { width: 460, height: 560 }))
      .toEqual({ x: 20, y: -30 });
  });
});
