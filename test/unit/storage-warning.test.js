/**
 * Storage warning display logic — pure functions behind the shell's
 * storage:warning handling (frontend/app/RelinkShell/storage-warning.js).
 * No IO, no clocks — deterministic.
 */

import { describe, expect, test } from 'vitest';
import {
  storageWarningText, shouldAnnounceStorage,
} from '../../frontend/app/RelinkShell/storage-warning.js';

describe('storageWarningText', () => {
  test('low warning names the free space and the recommendation', () => {
    const text = storageWarningText({ level: 'low', freeGB: 4.2, minGB: 1, recommendedGB: 10 });
    expect(text).toContain('Storage low');
    expect(text).toContain('4.2 GB free');
    expect(text).toContain('10 GB recommended');
  });

  test('critical warning says memory can be lost', () => {
    const text = storageWarningText({ level: 'critical', freeGB: 0.4, minGB: 1, recommendedGB: 10 });
    expect(text).toContain('Storage critical');
    expect(text).toContain('0.4 GB free');
    expect(text).toContain('memory can be lost');
  });

  test('an unmeasurable frame is honest, not a fabricated number', () => {
    const text = storageWarningText({ level: 'low', freeGB: null });
    expect(text).toContain('unmeasurable space');
    expect(text).not.toContain('null');
  });
});

describe('shouldAnnounceStorage', () => {
  const low = (freeGB) => ({ level: 'low', freeGB });

  test('the first warning always announces; an absent frame never does', () => {
    expect(shouldAnnounceStorage(null, low(5))).toBe(true);
    expect(shouldAnnounceStorage(low(5), null)).toBe(false);
  });

  test('a level change announces both directions', () => {
    expect(shouldAnnounceStorage(low(1.2), { level: 'critical', freeGB: 0.9 })).toBe(true);
    expect(shouldAnnounceStorage({ level: 'critical', freeGB: 0.9 }, low(1.2))).toBe(true);
  });

  test('a repeat of the same picture stays silent', () => {
    expect(shouldAnnounceStorage(low(5.3), low(5.2))).toBe(false);
    expect(shouldAnnounceStorage(low(5.3), low(5.9))).toBe(false);
  });

  test('each further whole-gigabyte drop announces again', () => {
    expect(shouldAnnounceStorage(low(5.3), low(4.9))).toBe(true);
    expect(shouldAnnounceStorage(low(4.9), low(3.0))).toBe(true);
  });

  test('non-numeric freeGB never crashes the rule', () => {
    expect(shouldAnnounceStorage(low(undefined), low(4))).toBe(false);
    expect(shouldAnnounceStorage(low(5), low(undefined))).toBe(false);
  });
});
