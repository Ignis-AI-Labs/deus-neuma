// The ceremony's thinking strip readout. Pure — real inputs, real outputs.
import { describe, it, expect } from 'vitest';
import { clockOf, thoughtLine } from '../../frontend/components/BirthCeremony/ceremony-thoughts.js';

describe('the thinking strip says how long and how much', () => {
  it('reads a clock in minutes and seconds', () => {
    expect(clockOf(0)).toBe('0:00');
    expect(clockOf(9_400)).toBe('0:09');
    expect(clockOf(152_000)).toBe('2:32');
  });

  it('says THINKING while it thinks and THOUGHT once it speaks, in tokens', () => {
    expect(thoughtLine({ settled: false, ms: 72_000, tokens: 4212 })).toBe('THINKING · 1:12 · 4,212 TOKENS');
    expect(thoughtLine({ settled: true, ms: 152_000, tokens: 9037 })).toBe('THOUGHT · 2:32 · 9,037 TOKENS');
    expect(thoughtLine({ settled: false, ms: 1_000, tokens: 1 })).toBe('THINKING · 0:01 · 1 TOKEN');
  });
});
