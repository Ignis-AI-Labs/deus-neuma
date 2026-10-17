/**
 * Tests for the composer's cap gauge (frontend/app/RelinkShell/compose-cap.js)
 * — the chars / cap · % line that makes the send cap visible before any
 * refusal fires. Pure arithmetic.
 */

import { describe, expect, test } from 'vitest';
import { capGauge, CAP_NEAR } from '../../frontend/app/RelinkShell/compose-cap.js';

describe('capGauge', () => {
  test('an uncapped composer shows nothing — the 1:1 stream stays quiet', () => {
    expect(capGauge(500, null)).toBeNull();
    expect(capGauge(500, undefined)).toBeNull();
    expect(capGauge(500, 0)).toBeNull();
  });

  test('an empty draft shows nothing — no noise before a word exists', () => {
    expect(capGauge(0, 16000)).toBeNull();
  });

  test('calm while there is room, with the honest count and percent', () => {
    const g = capGauge(2400, 16000);
    expect(g.level).toBe('calm');
    expect(g.pct).toBe(15);
    expect(g.label).toBe('2,400 / 16,000 · 15%');
  });

  test('warms at the NEAR threshold (80% of the cap)', () => {
    expect(capGauge(16000 * CAP_NEAR - 1, 16000).level).toBe('calm');
    expect(capGauge(16000 * CAP_NEAR, 16000).level).toBe('near');
    expect(capGauge(15999, 16000).level).toBe('near');
  });

  test('AT the cap still sends (near); one past it is over — a send would refuse', () => {
    expect(capGauge(16000, 16000).level).toBe('near');
    const over = capGauge(16001, 16000);
    expect(over.level).toBe('over');
    expect(over.pct).toBe(100); // rounded — the level carries the truth
    expect(capGauge(20000, 16000).pct).toBe(125);
  });
});
