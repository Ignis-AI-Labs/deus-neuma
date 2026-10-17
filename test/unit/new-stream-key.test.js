/**
 * Ctrl/Cmd+Shift+N opens a new stream window (Design note, 2026-09-29. The chord
 * decision is pure and proven here on real event-shaped inputs; the window
 * actually opening is proven in test/e2e/desk.spec.js. No mocks (RULE 0).
 */
import { describe, it, expect } from 'vitest';
import { isNewStreamChord } from '../../frontend/app/RelinkShell/new-stream-key.js';

const press = (over) => ({ key: 'N', code: 'KeyN', shiftKey: true, ctrlKey: true, metaKey: false, altKey: false, repeat: false, ...over });

describe('isNewStreamChord', () => {
  it('Ctrl+Shift+N and Cmd+Shift+N ask for a new stream', () => {
    expect(isNewStreamChord(press())).toBe(true);
    expect(isNewStreamChord(press({ ctrlKey: false, metaKey: true }))).toBe(true);
  });

  it('a layout that reports only the character still answers', () => {
    expect(isNewStreamChord(press({ code: '' }))).toBe(true);
  });

  it('never fires without Shift or without Ctrl/Cmd — plain N and Shift+N type letters', () => {
    expect(isNewStreamChord(press({ shiftKey: false }))).toBe(false);
    expect(isNewStreamChord(press({ ctrlKey: false }))).toBe(false);
  });

  it('stands aside for Ctrl+Alt+Shift+N — the separate-sign-in desk', () => {
    expect(isNewStreamChord(press({ altKey: true }))).toBe(false);
  });

  it('a held key never spawns a row of windows', () => {
    expect(isNewStreamChord(press({ repeat: true }))).toBe(false);
  });

  it('other keys and missing events are not the chord', () => {
    expect(isNewStreamChord(press({ key: 'M', code: 'KeyM' }))).toBe(false);
    expect(isNewStreamChord(null)).toBe(false);
  });
});
