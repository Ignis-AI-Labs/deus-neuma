/**
 * Tests for the exclusive stream-rail value — the pure boundary validator in
 * window-storage (frontend/app/windowing/window-storage.js). One value names
 * the open rail; junk degrades to 'tasks' (the historic default).
 */
import { describe, it, expect } from 'vitest';
import { openRailOf, STREAM_RAILS } from '../../frontend/app/windowing/window-storage.js';

describe('openRailOf', () => {
  it('accepts every known rail id and null (all folded)', () => {
    for (const id of STREAM_RAILS) expect(openRailOf(id)).toBe(id);
    expect(openRailOf(null)).toBeNull();
  });

  it('junk degrades to tasks — never an unknown rail on the wire', () => {
    for (const junk of ['sidebar', 42, {}, [], undefined, true, { collapsed: false }]) {
      expect(openRailOf(junk)).toBe('tasks');
    }
  });

  it('the rail registry is frozen — exclusivity is shared state, not a mutable global', () => {
    expect(Object.isFrozen(STREAM_RAILS)).toBe(true);
  });
});
