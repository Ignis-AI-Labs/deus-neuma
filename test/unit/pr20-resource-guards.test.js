import { describe, expect, test } from 'vitest';
import { designRefusals } from '../../backend/services/branding/card-safety.js';
import { wordsOf } from '../../core/memory/atlas-cluster.js';

describe('PR20 L-25: hostile text work is bounded', () => {
  test('nested opening brackets are refused before XML parsing', () => {
    const source = `<svg>${'<g'.repeat(30_000)}`;
    const started = performance.now();
    expect(designRefusals(source)).toContain('a design tag has a malformed opening boundary');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('atlas word scanning stays linear on punctuation-heavy text', () => {
    const started = performance.now();
    const words = wordsOf(` ${'x'.repeat(199_999)}'`);
    expect(words).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
