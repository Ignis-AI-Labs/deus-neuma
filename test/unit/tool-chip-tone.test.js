/**
 * The tool chip's colour register. Pure function, real inputs (RULE 0).
 *
 * Anchored on the real complaint: an image render emitted `running` on every
 * progress frame, and every one of those chips painted itself in the ALERT
 * register on the way to succeeding.
 */
import { describe, test, expect } from 'vitest';
import { chipTone, isInflight, progressFrom } from '../../frontend/app/RelinkShell/tool-chip-tone.js';

describe('chipTone', () => {
  test('a render in progress is IN FLIGHT, never a failure', () => {
    // The exact status image-forge emits per progress frame.
    expect(chipTone('running')).toBe('inflight');
    expect(isInflight('running')).toBe(true);
  });

  test('every in-flight status across the tool surface reads the same', () => {
    // 'executing' is terminal commands + email sends; all were painting alert.
    for (const s of ['running', 'executing', 'pending', 'in_progress', 'busy']) {
      expect(chipTone(s)).toBe('inflight');
    }
  });

  test('success reads as ok, under any of its words', () => {
    for (const s of ['ok', 'completed', 'approved', 'titled', 'loaded', 'released']) {
      expect(chipTone(s)).toBe('ok');
    }
  });

  test('real failures still reach the alert register', () => {
    for (const s of ['error', 'failed', 'denied', 'unavailable', 'unsafe_args']) {
      expect(chipTone(s)).toBe('failed');
    }
  });

  test('a content-law refusal stays ALERT — the operator must see it', () => {
    expect(chipTone('denied')).toBe('failed');
  });

  test('an unknown status falls to failed — the conservative direction', () => {
    // Better to show an unclassified status as needing attention than as fine.
    expect(chipTone('some_new_status')).toBe('failed');
    expect(chipTone('')).toBe('failed');
    expect(chipTone(undefined)).toBe('failed');
    expect(chipTone(null)).toBe('failed');
  });

  test('is pure — the same input always answers the same', () => {
    expect(chipTone('running')).toBe(chipTone('running'));
    expect(isInflight('ok')).toBe(false);
  });
});

describe('progressFrom — the loading bar\'s number', () => {
  test('reads the percent a render is already reporting in words', () => {
    expect(progressFrom('rendering — 44%')).toBe(44);
    expect(progressFrom('rendering — 100%')).toBe(100);
    expect(progressFrom('rendering — 0%')).toBe(0);
  });

  test('no percent ⇒ null, so the row shows the tick rather than a 0% bar', () => {
    expect(progressFrom('rendering — SDXL — text to image')).toBeNull();
    expect(progressFrom('')).toBeNull();
    expect(progressFrom(undefined)).toBeNull();
  });

  test('clamps a nonsense percent instead of overflowing the track', () => {
    expect(progressFrom('rendering — 480%')).toBe(100);
  });
});
