// capacity-scan.test.js — the injectable orchestrator under a scripted fire.
//
// Same idiom as the STATE benchmark runner: every effect is injected, so the
// ramp/budget/abort logic is proven deterministically. The REAL fire
// (fireCapacityProbes → createStreamRequest) is proven by the gated live
// integration test — nothing here claims the wire works.

import { describe, it, expect } from 'vitest';
import { runCapacityScan, ScanAborted, DEFAULT_LADDER } from '../../backend/services/capacity-scan.js';

const SUBSTRATE = {
  model: 'qwen3.5-122b', provider: 'lm-studio', endpoint: 'http://localhost:1234',
  gpu: 'RTX PRO 6000', vramGB: 96, memoryGB: 128,
};

// A scripted fire shaped by a curve: concurrency → { agg, lat }. Real
// function, real data — the injected seam, not a mock of the wire.
const scriptedFire = (curve, calls = []) => async (concurrency, probe) => {
  calls.push(concurrency);
  const { agg, lat, ok = true } = curve(concurrency);
  return { aggregateTokPerSec: agg, perAgentLatencyMs: [lat], ok };
};

// Throughput scales ×100/level up to `kneeAt`, then flatlines (~2% gains).
const plateauCurve = (kneeAt) => (c) => ({
  agg: c <= kneeAt ? 100 * c : 100 * kneeAt * 1.02,
  lat: 1000,
});

const cleanScaleCurve = () => (c) => ({ agg: 100 * c * 0.9, lat: 1000 + c * 10 });

const deps = (overrides = {}) => ({
  testConnection: async () => true,
  substrate: SUBSTRATE,
  runAt: '2026-07-04T10:00:00.000Z',
  consent: { by: '0xtest', at: '2026-07-04T10:00:00.000Z' },
  repeats: 1,
  now: () => 0,
  ...overrides,
});

describe('runCapacityScan — ramp + knee + bisection', () => {
  it('ascends until the knee fires, bisects once, reports the ceiling', async () => {
    const calls = [];
    const result = await runCapacityScan(deps({ fire: scriptedFire(plateauCurve(8), calls) }));

    expect(result.ceiling).toBe(8);
    expect(result.limitedBy).toBe('throughput');
    expect(result.incomplete).toBe(false);
    // Ladder stopped at 16 (the level that revealed the plateau), then the
    // one bisection step tested the 8↔16 midpoint.
    expect(calls).toEqual([1, 2, 4, 8, 16, 12]);
    expect(result.rawSamples.map((s) => s.concurrency)).toEqual([1, 2, 4, 8, 12, 16]);
    expect(result.aggregateTokPerSecAtCeiling).toBe(800);
    expect(result.boundClass).toBe('A');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('carries substrate, runAt and consent through untouched (provenance)', async () => {
    const result = await runCapacityScan(deps({ fire: scriptedFire(plateauCurve(4)) }));
    expect(result.substrate).toEqual(SUBSTRATE);
    expect(result.runAt).toBe('2026-07-04T10:00:00.000Z');
    expect(result.consent.by).toBe('0xtest');
    expect(result.vramFitEstimate).toBeNull();
  });

  it('a serialized single-slot server: honest ceiling 1, boundClass B', async () => {
    const serialized = (c) => ({ agg: 100 + (c - 1) * 2, lat: 1000 * c });
    const result = await runCapacityScan(deps({ fire: scriptedFire(serialized) }));
    expect(result.ceiling).toBe(1);
    expect(result.boundClass).toBe('B');
  });

  it('clean scale through the whole ladder → ceiling at cap, incomplete', async () => {
    const calls = [];
    const result = await runCapacityScan(deps({ fire: scriptedFire(cleanScaleCurve(), calls) }));
    expect(calls).toEqual([...DEFAULT_LADDER]);
    expect(result.ceiling).toBe(64);
    expect(result.limitedBy).toBe('ladder-cap');
    expect(result.incomplete).toBe(true);
  });

  it('a failed level ends the ramp; bisection refines the error ceiling', async () => {
    const calls = [];
    const failsAt8 = (c) => ({ agg: 100 * c, lat: 1000, ok: c < 8 });
    const result = await runCapacityScan(deps({ fire: scriptedFire(failsAt8, calls) }));
    // Ladder stops at the failure (8); the midpoint probe (6) sustains, so
    // the honest ceiling is 6 — tighter than the last full ladder level (4).
    expect(calls).toEqual([1, 2, 4, 8, 6]);
    expect(result.ceiling).toBe(6);
    expect(result.limitedBy).toBe('errors');
    expect(result.incomplete).toBe(false);
  });
});

describe('runCapacityScan — bounds are honest, never silent', () => {
  it('probe budget: stops before overspending, flags probe-budget', async () => {
    const result = await runCapacityScan(deps({
      fire: scriptedFire(cleanScaleCurve()),
      limits: { maxTotalProbes: 7, perRunDeadlineMs: 300_000 }, // 1+2+4 fits; 8 would not
    }));
    expect(result.ceiling).toBe(4);
    expect(result.limitedBy).toBe('probe-budget');
    expect(result.incomplete).toBe(true);
  });

  it('deadline: stops when the clock runs out, flags deadline', async () => {
    let t = 0;
    const clockedFire = async (c) => { t += 200_000; return { aggregateTokPerSec: 90 * c, perAgentLatencyMs: [1000], ok: true }; };
    const result = await runCapacityScan(deps({
      fire: clockedFire,
      now: () => t,
    }));
    // L1 → t=200k (inside 300k) → L2 runs → t=400k → deadline before L4.
    expect(result.rawSamples.map((s) => s.concurrency)).toEqual([1, 2]);
    expect(result.limitedBy).toBe('deadline');
    expect(result.incomplete).toBe(true);
  });

  it('bisection is skipped, not forced, when the budget cannot afford it', async () => {
    const calls = [];
    const result = await runCapacityScan(deps({
      fire: scriptedFire(plateauCurve(8), calls),
      limits: { maxTotalProbes: 31, perRunDeadlineMs: 300_000 }, // 1+2+4+8+16=31; midpoint 12 would overrun
    }));
    expect(result.ceiling).toBe(8); // unbisected knee still reported
    expect(calls).toEqual([1, 2, 4, 8, 16]); // no 12
    expect(result.incomplete).toBe(false);
  });
});

describe('runCapacityScan — abort and offline write nothing', () => {
  it('offline substrate throws before any probe fires', async () => {
    const calls = [];
    await expect(runCapacityScan(deps({
      testConnection: async () => false,
      fire: scriptedFire(plateauCurve(8), calls),
    }))).rejects.toThrow(/unreachable/);
    expect(calls).toEqual([]);
  });

  it('soft abort between levels throws ScanAborted — no partial result', async () => {
    const controller = new AbortController();
    const abortingFire = async (c) => {
      controller.abort(); // witness hits ABORT while level 1 is in flight
      return { aggregateTokPerSec: 100, perAgentLatencyMs: [1000], ok: true };
    };
    await expect(runCapacityScan(deps({
      fire: abortingFire,
      signal: controller.signal,
    }))).rejects.toBeInstanceOf(ScanAborted);
  });

  it('a fire failure propagates — a scan with no real measurement is not a result', async () => {
    await expect(runCapacityScan(deps({
      fire: async () => { throw new Error('connection reset'); },
    }))).rejects.toThrow(/connection reset/);
  });
});
