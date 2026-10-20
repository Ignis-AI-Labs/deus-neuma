// speakable-text — markdown is for the eye, not the mouth.
//
// THE BUG (ruling, 2026-08-01): […]
//
// Measured against the real Kokoro sidecar before the fix:
//   "That is important."     1092 ms
//   "That is **important**." 3343 ms  ← 3x, the excess entirely spoken markup
//
// Pure function, real inputs, real outputs — no mocks (RULE 0).

import { describe, test, expect } from 'vitest';
import { speakableText } from '../../backend/services/voice/speakable-text.js';

describe('speakableText — the markup goes, the words stay', () => {
  test('bold and italic keep their words and lose their asterisks', () => {
    expect(speakableText('That is **important**.')).toBe('That is important.');
    expect(speakableText('That is *important*.')).toBe('That is important.');
    expect(speakableText('That is ***vital***.')).toBe('That is vital.');
    expect(speakableText('~~struck~~ out')).toBe('struck out');
  });

  test('headings, bullets and quotes lose only their furniture', () => {
    expect(speakableText('## The Result')).toBe('The Result');
    expect(speakableText('- First item')).toBe('First item');
    expect(speakableText('* First item')).toBe('First item');
    expect(speakableText('> quoted thought')).toBe('quoted thought');
    // Numbered lists are LEFT: "1." reads as "one" and carries real ordering.
    expect(speakableText('1. First item')).toBe('1. First item');
  });

  test('code spans and fences leave the words, not the backticks', () => {
    expect(speakableText('Open the `portal` now.')).toBe('Open the portal now.');
    expect(speakableText('```js\nconst a = 1;\n```')).toContain('const a = 1;');
    expect(speakableText('```js\nconst a = 1;\n```')).not.toContain('`');
  });

  test('links are spoken as their text, never as their URL', () => {
    expect(speakableText('See [the docs](https://example.dev) now.')).toBe('See the docs now.');
    expect(speakableText('![a diagram](x.png)')).toBe('a diagram');
  });

  // THE RISK THIS GUARDS: over-stripping corrupts the being's actual words,
  // which is a worse failure than speaking a symbol.
  test('never touches underscores — identifiers are words here', () => {
    expect(speakableText('Look at use_live_voice and min_silence_ms.'))
      .toBe('Look at use_live_voice and min_silence_ms.');
    expect(speakableText('_emphasis_ stays')).toBe('_emphasis_ stays');
  });

  test('leaves ordinary prose and punctuation exactly as written', () => {
    const plain = "I hear you. Let's look at the routing — it isn't obvious, is it?";
    expect(speakableText(plain)).toBe(plain);
    expect(speakableText('The rate is 24.0 kHz (roughly).')).toBe('The rate is 24.0 kHz (roughly).');
    expect(speakableText('2 * 3 is six')).toBe('2 * 3 is six'); // lone marker, no pair
  });

  test('an unclosed marker never swallows the rest of the reply', () => {
    // The whole point of forbidding newlines inside the emphasis patterns.
    const out = speakableText('**start of a bold that never closes\nand the next line');
    expect(out).toContain('start of a bold that never closes');
    expect(out).toContain('and the next line');
    expect(out).not.toContain('*');
  });

  test('a stray marker is dropped rather than spoken', () => {
    expect(speakableText('word **')).toBe('word');
    expect(speakableText('---')).toBe('');
  });

  test('never throws, and non-strings are simply unspeakable', () => {
    expect(speakableText('')).toBe('');
    expect(speakableText(null)).toBe('');
    expect(speakableText(undefined)).toBe('');
    expect(speakableText(42)).toBe('');
  });
});
