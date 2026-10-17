/**
 * frontend/app/windowing/frame-registry.js isFrameOccluded — a window wholly
 * covered by one window stacked above it is not drawn (2026-10-04: stacked
 * full-size windows overflowed the GPU's tile budget). Never hides a window
 * any part of which can be seen. Real registry, real rects.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { registerFrame, unregisterFrame, isFrameOccluded, subscribeFrames } from '../../frontend/app/windowing/frame-registry.js';

const frame = (x, y, w, h, z, targetable = true) => ({ rect: { x, y, w, h }, z, targetable, applySplit: () => {} });
const ids = [];
const put = (id, f) => { ids.push(id); registerFrame(id, f); };
afterEach(() => { ids.splice(0).forEach(unregisterFrame); });

describe('a window covered whole is not drawn', () => {
  it('under a full-size window above it: occluded; the one on top never is', () => {
    put('chat', frame(0, 0, 1600, 900, 21));
    put('bench', frame(0, 0, 1600, 900, 22));
    expect(isFrameOccluded('chat')).toBe(true);
    expect(isFrameOccluded('bench')).toBe(false);
  });

  it('any part showing — past an edge, or above the cover — keeps it drawn', () => {
    put('big', frame(100, 100, 800, 600, 30));
    put('peeks', frame(50, 150, 300, 300, 20)); // its left edge shows
    put('over', frame(200, 200, 100, 100, 40)); // stacked above the big one
    expect(isFrameOccluded('peeks')).toBe(false);
    expect(isFrameOccluded('over')).toBe(false);
  });

  it('a shaded or departing window covers nothing', () => {
    put('under', frame(0, 0, 400, 400, 10));
    put('shaded', frame(0, 0, 800, 800, 20, false));
    expect(isFrameOccluded('under')).toBe(false);
  });

  it('tells its listeners when the desk changes', () => {
    let heard = 0;
    const off = subscribeFrames(() => { heard += 1; });
    put('a', frame(0, 0, 10, 10, 1));
    off();
    put('b', frame(0, 0, 10, 10, 2));
    expect(heard).toBe(1);
  });
});
