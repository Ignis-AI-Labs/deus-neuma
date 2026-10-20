// A part's calendar due as its attempt clock arms it (team-part-clock.js) —
// the real clock on real timers. setTimeout holds at most 2^31-1 ms (about
// 24.8 days); a longer delay overflows to 1 ms, so a part due five weeks out
// was told its clock had passed the moment its attempt began.

import { describe, it, expect } from 'vitest';
import { createAttemptClock } from '../../backend/services/team-part-clock.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const settle = (ms) => new Promise((r) => { setTimeout(r, ms); });

const clockDue = (dueMs) => {
  const passed = [];
  const clock = createAttemptClock({
    entry: { worked: {}, workingSince: {} }, stepId: 'build', limits: { limitMs: null, dueMs }, onPass: (by) => passed.push(by),
  });
  return { passed, clock };
};

describe('a part\'s calendar due', () => {
  it('a due 40 days out does not pass when the attempt begins', async () => {
    const { passed, clock } = clockDue(Date.now() + 40 * DAY_MS);
    await settle(150);
    clock.end();
    expect(passed).toEqual([]);
  });

  it('a near due still passes, once, by its due', async () => {
    const { passed, clock } = clockDue(Date.now() + 40);
    await settle(200);
    clock.end();
    expect(passed).toEqual(['due']);
  });
});
