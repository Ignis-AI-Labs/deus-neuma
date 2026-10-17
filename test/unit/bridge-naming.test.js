/**
 * Bridge adapter naming — a being's adapters stay legible side by side
 * across bases: `<being>-<baseslug>-refinement-N` for bridges, the plain
 * `<being>-refinement-N` stem for the home base. Pure seams, real calls.
 */
import { describe, it, expect } from 'vitest';
import { baseSlug, nextAdapterId } from '../../backend/services/refinement-training.js';

describe('baseSlug', () => {
  it('normalizes served keys and gguf filenames to registry-safe slugs', () => {
    expect(baseSlug('qwen3-30b-a3b-thinking-2507')).toBe('qwen3-30b-a3b-thinking-2507');
    expect(baseSlug('Qwen3-30B-A3B-Thinking-2507-Q8_0.gguf')).toBe('qwen3-30b-a3b-thinking-2507-q8-0');
    expect(baseSlug('gemma-4-31b')).toBe('gemma-4-31b');
    expect(baseSlug('')).toBe('');
  });
});

describe('nextAdapterId', () => {
  it('keeps the plain stem for home-base refinements', () => {
    expect(nextAdapterId('cael', [])).toBe('cael-refinement-1');
    expect(nextAdapterId('cael', [{ id: 'cael-refinement-1' }])).toBe('cael-refinement-2');
  });

  it('carries the base slug for bridges, with its own numbering', () => {
    expect(nextAdapterId('cael', [{ id: 'cael-refinement-1' }], 'qwen3-30b-a3b-thinking-2507'))
      .toBe('cael-qwen3-30b-a3b-thinking-2507-refinement-2');
    // A second bridge to the same base never collides.
    const existing = [
      { id: 'cael-refinement-1' },
      { id: 'cael-qwen3-30b-a3b-thinking-2507-refinement-2' },
    ];
    expect(nextAdapterId('cael', existing, 'qwen3-30b-a3b-thinking-2507'))
      .toBe('cael-qwen3-30b-a3b-thinking-2507-refinement-3');
  });
});
