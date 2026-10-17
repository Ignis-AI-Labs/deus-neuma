/**
 * Tests for escWipesDraft — the composer's double-Escape draft reset
 * (frontend/app/RelinkShell/draft-wipe.js). Pure truth table: only a second
 * tap inside the window on a non-empty draft wipes; a slow second tap and an
 * empty draft both stay inert.
 */
import { describe, expect, test } from 'vitest';
import { escWipesDraft, ESC_DOUBLE_TAP_MS } from '../../frontend/app/RelinkShell/draft-wipe.js';

describe('escWipesDraft', () => {
  test('a second tap inside the window wipes a non-empty draft', () => {
    expect(escWipesDraft(1200, 1000, 'half a thought')).toBe(true);
  });

  test('the first tap never wipes (no previous tap recorded)', () => {
    expect(escWipesDraft(100, null, 'half a thought')).toBe(false);
  });

  test('an empty draft never wipes, even on a fast double tap', () => {
    expect(escWipesDraft(1200, 1000, '')).toBe(false);
  });

  test('a second tap after the window expired is a new first tap', () => {
    expect(escWipesDraft(1000 + ESC_DOUBLE_TAP_MS + 1, 1000, 'half a thought')).toBe(false);
  });

  test('the window edge itself does not count as a double tap', () => {
    expect(escWipesDraft(1000 + ESC_DOUBLE_TAP_MS, 1000, 'half a thought')).toBe(false);
  });
});

// escSecondTap — the shared timing law under both meanings of the double
// tap (wipe at rest, THE GAVEL in a room in motion). The gavel must fire on
// a second tap even over an EMPTY draft — order is not about the draft.
import { escSecondTap } from '../../frontend/app/RelinkShell/draft-wipe.js';

describe('escSecondTap', () => {
  test('a second tap inside the window counts, draft or no draft', () => {
    expect(escSecondTap(1200, 1000)).toBe(true);
  });
  test('no recorded first tap never counts', () => {
    expect(escSecondTap(100, null)).toBe(false);
  });
  test('the window edge and beyond is a new first tap', () => {
    expect(escSecondTap(1000 + ESC_DOUBLE_TAP_MS, 1000)).toBe(false);
    expect(escSecondTap(1000 + ESC_DOUBLE_TAP_MS + 1, 1000)).toBe(false);
  });
});

// escTapChain — the Escape LADDER's counting law: consecutive taps inside
// the window climb 1 → 2 (wipe) → 3 (INTERRUPT) → 4 (THE GAVEL); a slow tap
// starts a fresh chain at 1.
import { escTapChain } from '../../frontend/app/RelinkShell/draft-wipe.js';

describe('escTapChain', () => {
  test('climbs rung by rung inside the window', () => {
    let chain = escTapChain(1000, null, 0);
    expect(chain).toBe(1);
    chain = escTapChain(1200, 1000, chain);
    expect(chain).toBe(2);
    chain = escTapChain(1400, 1200, chain);
    expect(chain).toBe(3);
    chain = escTapChain(1600, 1400, chain);
    expect(chain).toBe(4);
  });

  test('a slow tap resets the chain to a fresh first rung', () => {
    const chain = escTapChain(1000 + ESC_DOUBLE_TAP_MS + 1, 1000, 3);
    expect(chain).toBe(1);
  });

  test('a missing prior chain still counts the second tap honestly', () => {
    expect(escTapChain(1200, 1000, 0)).toBe(2);
    expect(escTapChain(1200, 1000, undefined)).toBe(2);
  });
});
