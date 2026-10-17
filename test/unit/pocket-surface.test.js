// Which shell a viewport gets (Neuma Remote phase 2), the pure half.
import { describe, it, expect } from 'vitest';
import { isPocketSurface, POCKET_MAX_WIDTH, POCKET_QUERY } from '../../frontend/app/PocketShell/pocket-surface.js';

describe('isPocketSurface', () => {
  it('a phone-width viewport is a pocket, a desk is not', () => {
    expect(isPocketSurface({ width: 375, coarsePointer: false })).toBe(true);
    expect(isPocketSurface({ width: POCKET_MAX_WIDTH, coarsePointer: false })).toBe(true);
    expect(isPocketSurface({ width: POCKET_MAX_WIDTH + 1, coarsePointer: false })).toBe(false);
    expect(isPocketSurface({ width: 1920, coarsePointer: false })).toBe(false);
  });
  it('a finger makes any width a pocket', () => {
    expect(isPocketSurface({ width: 1024, coarsePointer: true })).toBe(true);
  });
  it('the media query says the same thing the function does', () => {
    expect(POCKET_QUERY).toBe(`(max-width: ${POCKET_MAX_WIDTH}px), (pointer: coarse)`);
  });
});
