// The STATE tripwire — pure comparison law over two consented runs.

import { describe, it, expect } from 'vitest';
import { stateTripwire } from '../../core/runtime/benchmark-tripwire.js';

const run = (scores) => ({
  dimensions: Object.entries(scores).map(([key, score]) => ({ key, score })),
});

describe('stateTripwire', () => {
  it('names EVERY dimension that fell — never averaged away by ones that rose', () => {
    const result = stateTripwire(
      run({ identity: 0.9, capability: 0.8, coherence: 0.7 }),
      run({ identity: 1.0, capability: 0.6, coherence: 0.7 }),
    );
    expect(result.verdict).toBe('regression');
    expect(result.regressed).toEqual(['capability']);
    expect(result.rows.find((r) => r.key === 'capability').delta).toBeCloseTo(-0.2, 10);
  });

  it('holds no-regression when nothing fell', () => {
    const result = stateTripwire(run({ identity: 0.8 }), run({ identity: 0.8 }));
    expect(result.verdict).toBe('no-regression');
    expect(result.comparable).toBe(1);
  });

  it('an unscorable dimension is honest: not comparable, never a silent pass', () => {
    const result = stateTripwire(run({ identity: null }), run({ identity: 0.5 }));
    expect(result.verdict).toBe('insufficient');
    expect(result.rows[0]).toMatchObject({ comparable: false, regressed: false, delta: null });
  });

  it('tolerance absorbs measurement noise, not real drops', () => {
    const before = run({ identity: 0.80 });
    expect(stateTripwire(before, run({ identity: 0.79 }), { tolerance: 0.02 }).verdict).toBe('no-regression');
    expect(stateTripwire(before, run({ identity: 0.70 }), { tolerance: 0.02 }).verdict).toBe('regression');
  });

  it('refuses malformed inputs by name', () => {
    expect(() => stateTripwire({}, run({ a: 1 }))).toThrow(/dimensions/);
    expect(() => stateTripwire(run({ a: 1 }), run({ a: 1 }), { tolerance: 2 })).toThrow(/tolerance/);
  });
});
