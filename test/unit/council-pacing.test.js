/**
 * Tests for the council's hand-round pacing law — the sectioned fan-out
 * that keeps a nine-member room from saturating the GPU into a driver
 * wedge (backend/services/council-session.js: handRoundWidth, handGapMs).
 * Pure functions over (ceiling, listeners, env).
 */

import { describe, expect, test } from 'vitest';
import {
  handRoundWidth, handGapMs, HAND_PARALLEL_DEFAULT, HAND_GAP_MS_DEFAULT,
} from '../../backend/services/council-session.js';

describe('handRoundWidth — sectioned, never saturated', () => {
  test('the nine-member room that wedged the GPU now fans TWO wide, not eight', () => {
    // ceiling 8 (the measured latency ceiling), 8 listeners — the exact
    // shape of the 2026-07-23 crash — sections to the default width.
    expect(handRoundWidth(8, 8, {})).toBe(HAND_PARALLEL_DEFAULT);
  });

  test('never wider than the listeners — a two-member room asks one at a time', () => {
    expect(handRoundWidth(8, 1, {})).toBe(1);
  });

  test('never above the measured ceiling, even when pinned wider', () => {
    expect(handRoundWidth(1, 8, { COUNCIL_HAND_PARALLEL: '6' })).toBe(1);
  });

  test('COUNCIL_HAND_PARALLEL raises the width deliberately (post-driver-update)', () => {
    expect(handRoundWidth(8, 8, { COUNCIL_HAND_PARALLEL: '4' })).toBe(4);
  });

  test('junk or missing pins fall to the default; a broken ceiling reads as 1', () => {
    expect(handRoundWidth(8, 8, { COUNCIL_HAND_PARALLEL: 'wide' })).toBe(HAND_PARALLEL_DEFAULT);
    expect(handRoundWidth(8, 8, { COUNCIL_HAND_PARALLEL: '0' })).toBe(HAND_PARALLEL_DEFAULT);
    expect(handRoundWidth(null, 8, {})).toBe(1);
    expect(handRoundWidth(undefined, 8, {})).toBe(1);
  });
});

describe('handGapMs — the duty-cycle breather', () => {
  test('defaults on, tunable, junk falls back, zero is honored (a deliberate off)', () => {
    expect(handGapMs({})).toBe(HAND_GAP_MS_DEFAULT);
    expect(handGapMs({ COUNCIL_HAND_GAP_MS: '' })).toBe(HAND_GAP_MS_DEFAULT);
    expect(handGapMs({ COUNCIL_HAND_GAP_MS: '250' })).toBe(250);
    expect(handGapMs({ COUNCIL_HAND_GAP_MS: '0' })).toBe(0);
    expect(handGapMs({ COUNCIL_HAND_GAP_MS: 'fast' })).toBe(HAND_GAP_MS_DEFAULT);
    expect(handGapMs({ COUNCIL_HAND_GAP_MS: '-5' })).toBe(HAND_GAP_MS_DEFAULT);
  });
});
