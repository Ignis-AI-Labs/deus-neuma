/**
 * The typing bed's gate (typing-sound.js).
 *
 * Design note, 2026-08-01: […] A voice sitting hides the chat but keeps it
 * MOUNTED, so speech segments go on revealing behind the visualizer — and the
 * typing bed went on clacking underneath a spoken conversation.
 *
 * The decision is pure and tested as such; the loop itself is the sound
 * engine's, which owns real Web Audio and is not exercised here.
 */

import { describe, it, expect, beforeAll } from 'vitest';

// sound-engine.js registers a preference listener on `window` at import time —
// a real browser global, stubbed at the same boundary voice-sitting-shell.test.js
// stubs it. Nothing under test is faked: shouldTypingBedSound is pure.
let shouldTypingBedSound;
beforeAll(async () => {
  globalThis.window = globalThis.window || {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  };
  globalThis.localStorage = globalThis.localStorage
    || { getItem: () => null, setItem() {}, removeItem() {} };
  ({ shouldTypingBedSound } = await import('../../frontend/app/RelinkShell/typing-sound.js'));
});

describe('typing bed — sounds while revealing, silent inside a talk', () => {
  it('sounds while segments are revealing on the ordinary desk', () => {
    expect(shouldTypingBedSound({ holders: 1, sittingActive: false })).toBe(true);
    expect(shouldTypingBedSound({ holders: 4, sittingActive: false })).toBe(true);
  });

  it('is silent once the last segment catches up', () => {
    expect(shouldTypingBedSound({ holders: 0, sittingActive: false })).toBe(false);
  });

  it('is silent throughout a voice sitting, however many segments reveal', () => {
    // The exact case Founder heard: the chat is hidden but still mounted, so
    // holders climb while a spoken conversation is underway.
    expect(shouldTypingBedSound({ holders: 1, sittingActive: true })).toBe(false);
    expect(shouldTypingBedSound({ holders: 9, sittingActive: true })).toBe(false);
  });

  it('comes back on its own when the talk ends mid-reveal', () => {
    // The refcount is never touched by the gate — only whether it sounds — so
    // leaving the talk with segments still revealing picks the bed straight up.
    expect(shouldTypingBedSound({ holders: 2, sittingActive: true })).toBe(false);
    expect(shouldTypingBedSound({ holders: 2, sittingActive: false })).toBe(true);
  });

  it('fails silent on missing input rather than clacking', () => {
    expect(shouldTypingBedSound()).toBe(false);
    expect(shouldTypingBedSound({})).toBe(false);
  });
});
