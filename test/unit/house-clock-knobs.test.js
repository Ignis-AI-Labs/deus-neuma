/**
 * THE FLIGHT CHECK'S KNOBS (the house flight check) — time is
 * compressed only when the flight sets the env; unset, the house clock runs
 * exactly as production: a 60 s tick, the queue's own 3 s settle and 60 s
 * retry backoff, cadence counted in hours. Pure: clockKnobs is called with real env objects.
 */
import { describe, test, expect } from 'vitest';
import { clockKnobs, CLOCK_TICK_MS } from '../../backend/services/house-clock/house-clock.js';
import { WAKE_SETTLE_MS, WAKE_RETRY_MS } from '../../backend/services/house-clock/wake-queue.js';

describe('the house clock flight knobs', () => {
  test('unset, every value is the production one', () => {
    expect(CLOCK_TICK_MS).toBe(60_000);
    expect(WAKE_SETTLE_MS).toBe(3000);
    expect(WAKE_RETRY_MS).toBe(60_000);
    expect(clockKnobs({})).toEqual({ tickMs: 60_000, settleMs: null, retryMs: null, cadenceUnitMs: 3_600_000 });
    expect(clockKnobs()).toEqual({ tickMs: 60_000, settleMs: null, retryMs: null, cadenceUnitMs: 3_600_000 });
  });

  test('a flight compresses the tick, the settle, a failed wake\'s backoff and the cadence unit', () => {
    expect(clockKnobs({ HOUSE_CLOCK_TICK_MS: '2000', HOUSE_WAKE_SETTLE_MS: '0', HOUSE_WAKE_RETRY_MS: '1500', HOUSE_FLIGHT_CADENCE_UNIT: 'minute' }))
      .toEqual({ tickMs: 2000, settleMs: 0, retryMs: 1500, cadenceUnitMs: 60_000 });
  });

  test('a value that is not a whole number falls back to production, never to zero', () => {
    for (const bad of ['', 'fast', '-5', '1.5', '0x10']) {
      expect(clockKnobs({ HOUSE_CLOCK_TICK_MS: bad, HOUSE_WAKE_SETTLE_MS: bad, HOUSE_WAKE_RETRY_MS: bad })).toMatchObject({ tickMs: 60_000, settleMs: null, retryMs: null });
    }
    expect(clockKnobs({ HOUSE_CLOCK_TICK_MS: '0' }).tickMs).toBe(60_000);
    expect(clockKnobs({ HOUSE_FLIGHT_CADENCE_UNIT: 'second' }).cadenceUnitMs).toBe(3_600_000);
  });
});
