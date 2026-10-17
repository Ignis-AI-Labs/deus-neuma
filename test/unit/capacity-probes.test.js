// capacity-probes.test.js — the one legitimate no-mock unit test (AC-10).
//
// deriveCeiling/classifyBound are pure: real sample arrays in, real verdicts
// out, nothing faked anywhere in the path. Curves below are shaped like the
// real measurement cases the scan runner produces.

import { describe, it, expect } from 'vitest';
import {
  deriveCeiling,
  classifyBound,
  describeCapacity,
  DEFAULT_KNEE_OPTS,
  DEFAULT_BOUND_OPTS,
} from '../../backend/services/capacity-probes.js';

const sample = (concurrency, aggregateTokPerSec, perAgentLatencyMs, ok = true) => ({
  concurrency, aggregateTokPerSec, perAgentLatencyMs, ok, tokenSource: 'whitespace',
});

// A server that batches well: near-linear throughput, gentle latency growth.
const cleanScaleTo = (cap) => {
  const levels = [1, 2, 4, 8, 16, 32, 64].filter((c) => c <= cap);
  return levels.map((c) => sample(c, 100 * c * 0.9, 1000 + c * 10));
};

// A server whose throughput plateaus after `kneeAt` (gain collapses to ~2%).
const plateauAfter = (kneeAt) =>
  [1, 2, 4, 8, 16, 32, 64].map((c) =>
    sample(c, c <= kneeAt ? 100 * c : 100 * kneeAt * 1.02, 1000)
  );

// A single-slot server: second request queues behind the first —
// latency doubles, aggregate throughput goes nowhere.
const serializedCurve = () => [
  sample(1, 100, 1000),
  sample(2, 102, 2050),
  sample(4, 103, 4100),
];

describe('deriveCeiling — knee detection', () => {
  it('finds the throughput plateau and reports the prior level as ceiling', () => {
    const v = deriveCeiling(plateauAfter(8));
    expect(v.ceiling).toBe(8);
    expect(v.limitedBy).toBe('throughput');
    expect(v.incomplete).toBe(false);
    expect(v.throughputKnee).toBe(8);
    expect(v.aggregateTokPerSecAtCeiling).toBe(800);
    expect(v.perAgentLatencyAtCeiling).toBe(1000);
  });

  it('finds the latency knee when throughput keeps gaining', () => {
    // Throughput scales (≥15% gains), latency blows past 2× baseline at level 8.
    const samples = [
      sample(1, 100, 1000),
      sample(2, 180, 1300),
      sample(4, 320, 1800),
      sample(8, 560, 2400),
    ];
    const v = deriveCeiling(samples);
    expect(v.ceiling).toBe(4);
    expect(v.limitedBy).toBe('latency');
    expect(v.throughputKnee).toBeNull();
    expect(v.latencyKnee).toBe(4);
    expect(v.incomplete).toBe(false);
  });

  it('takes the min when both knees fire at different levels', () => {
    // Throughput plateaus after 4; latency doubles only at 16 → knee at 8.
    const samples = [
      sample(1, 100, 1000),
      sample(2, 200, 1100),
      sample(4, 400, 1200),
      sample(8, 410, 1400),
      sample(16, 415, 2200),
    ];
    const v = deriveCeiling(samples);
    expect(v.throughputKnee).toBe(4);
    expect(v.latencyKnee).toBe(8);
    expect(v.ceiling).toBe(4);
    expect(v.limitedBy).toBe('throughput');
  });

  it('a serialized single-slot server honestly resolves to ceiling 1', () => {
    const v = deriveCeiling(serializedCurve());
    expect(v.ceiling).toBe(1);
    expect(v.limitedBy).toBe('throughput');
    expect(v.incomplete).toBe(false);
  });
});

// 2026-10-14: three scans of one quiet rig read 3, 2, 3. The 2 came from the
// bisect's half-step (2 → 3) held to a doubling's 15% bar — 12% read as a
// plateau while 4 still gained 22% over 3. The bar scales with the step.
describe('deriveCeiling — a bisect half-step is held to a half-step\'s bar', () => {
  // The real samples of that scan (server-counted tokens, 64-token probes).
  const night = [sample(1, 121, 749), sample(2, 212, 966), sample(3, 238, 1316), sample(4, 290, 1565)];

  it('the measured curve: 2 → 3 gained 12% — growth for a half-step; the latency knee at 4 decides', () => {
    const v = deriveCeiling(night);
    expect(v.throughputKnee).toBeNull();
    expect(v.ceiling).toBe(3);
    expect(v.limitedBy).toBe('latency');
  });

  it('a real plateau on a half-step still reads as one', () => {
    const v = deriveCeiling([sample(1, 100, 1000), sample(2, 180, 1200), sample(3, 183, 1500), sample(4, 185, 1700)]);
    expect(v.throughputKnee).toBe(2);
    expect(v.ceiling).toBe(2);
  });

  it('a doubling keeps the documented bar exactly', () => {
    const under = deriveCeiling([sample(1, 100, 1000), sample(2, 114, 1000)]);
    const over = deriveCeiling([sample(1, 100, 1000), sample(2, 116, 1000)]);
    expect(under.throughputKnee).toBe(1);
    expect(over.throughputKnee).toBeNull();
  });
});

describe('deriveCeiling — totality (every input defined)', () => {
  it('zero knees through the full ladder → ceiling = cap, incomplete', () => {
    const v = deriveCeiling(cleanScaleTo(64));
    expect(v.ceiling).toBe(64);
    expect(v.limitedBy).toBe('ladder-cap');
    expect(v.incomplete).toBe(true);
  });

  it('truncation reason is carried when no knee fired', () => {
    const v = deriveCeiling(cleanScaleTo(8), { truncatedBy: 'deadline' });
    expect(v.ceiling).toBe(8);
    expect(v.limitedBy).toBe('deadline');
    expect(v.incomplete).toBe(true);

    const b = deriveCeiling(cleanScaleTo(8), { truncatedBy: 'probe-budget' });
    expect(b.limitedBy).toBe('probe-budget');
  });

  it('a knee found before truncation is a complete measurement', () => {
    const v = deriveCeiling(plateauAfter(4).slice(0, 5), { truncatedBy: 'deadline' });
    expect(v.ceiling).toBe(4);
    expect(v.limitedBy).toBe('throughput');
    expect(v.incomplete).toBe(false);
  });

  it('a failed level is a hard ceiling: prior level wins, limitedBy errors', () => {
    const samples = [
      sample(1, 100, 1000),
      sample(2, 200, 1050),
      sample(4, 0, 0, false),
    ];
    const v = deriveCeiling(samples);
    expect(v.ceiling).toBe(2);
    expect(v.limitedBy).toBe('errors');
    expect(v.incomplete).toBe(false);
  });

  it('failure at level 1 means nothing sustained: ceiling 0', () => {
    const v = deriveCeiling([sample(1, 0, 0, false)]);
    expect(v.ceiling).toBe(0);
    expect(v.limitedBy).toBe('errors');
    expect(v.aggregateTokPerSecAtCeiling).toBeNull();
  });

  it('single clean sample → ceiling 1, incomplete (no comparison possible)', () => {
    const v = deriveCeiling([sample(1, 100, 1000)]);
    expect(v.ceiling).toBe(1);
    expect(v.limitedBy).toBe('ladder-cap');
    expect(v.incomplete).toBe(true);
  });

  it('empty input → null ceiling, never a fabricated number', () => {
    const v = deriveCeiling([]);
    expect(v.ceiling).toBeNull();
    expect(v.limitedBy).toBe('no-samples');
    expect(v.incomplete).toBe(true);
    expect(v.aggregateTokPerSecAtCeiling).toBeNull();
  });

  it('verdicts are frozen', () => {
    const v = deriveCeiling(plateauAfter(4));
    expect(Object.isFrozen(v)).toBe(true);
  });
});

describe('classifyBound — A/B/C from curve shape', () => {
  it('B: ceiling 1 with the serialization signature (config-bound)', () => {
    expect(classifyBound(serializedCurve())).toBe('B');
  });

  it('C: ceiling 1 WITHOUT the signature (real gain, latency-priced)', () => {
    // Level 2 gains 60% throughput but latency doubles — genuinely can't
    // afford 2, not a queueing artifact.
    const samples = [sample(1, 100, 1000), sample(2, 160, 2100)];
    expect(classifyBound(samples)).toBe('C');
  });

  it('A: plateau well before the cap (config headroom)', () => {
    expect(classifyBound(plateauAfter(8))).toBe('A');
  });

  it('C: knee in the top half of the ladder (hardware-shaped)', () => {
    expect(classifyBound(plateauAfter(32))).toBe('C');
  });

  it('C: clean scale to the cap with no knee', () => {
    expect(classifyBound(cleanScaleTo(64))).toBe('C');
  });

  it('exact transitions at the documented thresholds', () => {
    const base = sample(1, 100, 1000);
    const at = (latencyRatio, gain) => [base, sample(2, 100 * (1 + gain), 1000 * latencyRatio)];
    // Just inside the B signature: latency ratio ≥ 1.8, gain < 0.10 …
    expect(classifyBound(at(1.8, 0.09))).toBe('B');
    // … latency a hair under the ratio → not serialized → C (ceiling still 1).
    expect(classifyBound(at(1.79, 0.09))).toBe('C');
    // Gain at the threshold is throughput-knee'd (0.10 < 0.15 plateau) but the
    // signature needs gain < 0.10 → C.
    expect(classifyBound(at(1.8, 0.10))).toBe('C');
  });

  it('C not B: an errored level-2 is not the serialization signature', () => {
    // ceiling resolves to 1 via the error knee, and level-2 latency is high —
    // but it errored (a timeout), so it must NOT read as "single slot configured".
    const samples = [sample(1, 100, 1000), sample(2, 0, 5000, false)];
    expect(deriveCeiling(samples).ceiling).toBe(1);
    expect(classifyBound(samples)).toBe('C');
  });

  it('never emits a number — only a class', () => {
    for (const curve of [serializedCurve(), plateauAfter(8), cleanScaleTo(64), []]) {
      expect(['A', 'B', 'C']).toContain(classifyBound(curve));
    }
  });
});

describe('AC-3 reproducibility math (two-part falsifiable check)', () => {
  // Two scans of an "unchanged rig": same knee level, tok/s wobbling ±10%.
  const runA = plateauAfter(8);
  const runB = plateauAfter(8).map((s) => ({ ...s, aggregateTokPerSec: s.aggregateTokPerSec * 1.1 }));

  it('(a) the ceiling level is identical across re-runs', () => {
    expect(deriveCeiling(runA).ceiling).toBe(deriveCeiling(runB).ceiling);
  });

  it('(b) aggregate tok/s at the ceiling agrees within ±15%', () => {
    const a = deriveCeiling(runA).aggregateTokPerSecAtCeiling;
    const b = deriveCeiling(runB).aggregateTokPerSecAtCeiling;
    expect(Math.abs(a - b) / a).toBeLessThanOrEqual(0.15);
  });
});

describe('describeCapacity — the neuma\'s words for its rig capacity (guardrail 5)', () => {
  const cap = (ceiling, boundClass, runAt = '2026-07-04T14:59:35.211Z') => ({ ceiling, boundClass, runAt });

  it('unmeasured → empty (never a fabricated capacity)', () => {
    expect(describeCapacity(null)).toBe('');
    expect(describeCapacity({ ceiling: null })).toBe('');
    expect(describeCapacity({ ceiling: 0 })).toBe('');
  });

  it('a measured ceiling ≥ 2 states the parallel width and the plateau', () => {
    const s = describeCapacity(cap(3, 'A'));
    expect(s).toContain('about 3 of you working in parallel');
    expect(s).toContain('measured 2026-07-04');
    expect(s).toContain('plateaus');
    expect(s).not.toContain('hardware-bound'); // A is not framed as hardware-bound
  });

  it('boundClass C adds the tentative hardware-bound note', () => {
    expect(describeCapacity(cap(16, 'C'))).toContain('appears hardware-bound');
  });

  it('ceiling 1 + boundClass B is framed as a configuration limit, not hardware', () => {
    const s = describeCapacity(cap(1, 'B'));
    expect(s).toContain('1 of you at a time');
    expect(s).toContain('configuration limit');
    expect(s).not.toContain("hardware's ceiling is"); // never claims the hw ceiling
  });

  it('ceiling 1 without the config signature is honest about the cost', () => {
    const s = describeCapacity(cap(1, 'C'));
    expect(s).toContain('1 of you at a time');
    expect(s).toContain('costs more than it gains');
  });
});

describe('defaults are the ratified values', () => {
  it('knee opts', () => {
    expect(DEFAULT_KNEE_OPTS).toEqual({
      plateauGainThreshold: 0.15, latencyDegradeFactor: 2.0, ladderCap: 64,
    });
  });
  it('bound opts', () => {
    expect(DEFAULT_BOUND_OPTS).toEqual({
      latencyRatioB: 1.8, gainB: 0.10, nearCapRatio: 0.5,
    });
  });
});
