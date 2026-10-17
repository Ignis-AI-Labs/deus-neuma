/**
 * Tests for the sent-history recall steppers — the CLI muscle memory behind
 * ArrowUp/ArrowDown in the composer (frontend/app/RelinkShell/sent-history.js).
 * Pure arithmetic, provable without a DOM.
 */

import { describe, expect, test } from 'vitest';
import { stepRecall, mayStep } from '../../frontend/app/RelinkShell/sent-history.js';

const HISTORY = ['first word', 'second word', 'third word'];

describe('stepRecall — the walk', () => {
  test('back from rest lands on the newest entry', () => {
    expect(stepRecall(HISTORY, null, 'back')).toEqual({ cursor: 2, text: 'third word' });
  });

  test('back walks toward the oldest, one step at a time', () => {
    expect(stepRecall(HISTORY, 2, 'back')).toEqual({ cursor: 1, text: 'second word' });
    expect(stepRecall(HISTORY, 1, 'back')).toEqual({ cursor: 0, text: 'first word' });
  });

  test('back at the oldest stays — no wrap, no clearing', () => {
    expect(stepRecall(HISTORY, 0, 'back')).toBeNull();
  });

  test('forward walks toward the newest and finally OUT to an empty draft', () => {
    expect(stepRecall(HISTORY, 0, 'forward')).toEqual({ cursor: 1, text: 'second word' });
    expect(stepRecall(HISTORY, 2, 'forward')).toEqual({ cursor: null, text: '' });
  });

  test('forward while not walking means nothing', () => {
    expect(stepRecall(HISTORY, null, 'forward')).toBeNull();
  });

  test('an empty history has nowhere to go, either way', () => {
    expect(stepRecall([], null, 'back')).toBeNull();
    expect(stepRecall(undefined, null, 'back')).toBeNull();
    expect(stepRecall([], null, 'forward')).toBeNull();
  });
});

describe('mayStep — typed words are never clobbered', () => {
  test('an empty draft may always step', () => {
    expect(mayStep('', HISTORY, null)).toBe(true);
    expect(mayStep('', HISTORY, 1)).toBe(true);
  });

  test('a draft that IS the recalled entry keeps walking', () => {
    expect(mayStep('second word', HISTORY, 1)).toBe(true);
  });

  test('an edited draft is the witness\'s — navigation stands down', () => {
    expect(mayStep('second word, revised', HISTORY, 1)).toBe(false);
  });

  test('a non-empty draft with no walk in progress never steps', () => {
    expect(mayStep('typing something new', HISTORY, null)).toBe(false);
  });
});
