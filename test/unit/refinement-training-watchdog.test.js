import { describe, expect, it } from 'vitest';
import { runStep } from '../../backend/services/refinement-process-scope.js';
import {
  FORGE_MAX_DURATION_MS,
  WATCHDOG_MAX_POLL_MS,
  WATCHDOG_MIN_POLL_MS,
  forgeMemoryVerdict,
  parseAvailableMemoryBytes,
  resolveForgeDurationMs,
  resolveForgeHeadroomBytes,
  resolveForgeMemoryFactor,
  resolveMemoryFloorBytes,
  resolveWatchdogPollMs,
  runWatchdogStep,
  startMemoryWatchdog,
} from '../../backend/services/refinement-training-watchdog.js';


describe('refinement training watchdog', () => {
  it('allows a lower wall clock but never raises or disables the six-hour ceiling', () => {
    expect(resolveForgeDurationMs(12_345)).toBe(12_345);
    expect(resolveForgeDurationMs(FORGE_MAX_DURATION_MS)).toBe(FORGE_MAX_DURATION_MS);
    expect(resolveForgeDurationMs(FORGE_MAX_DURATION_MS + 1)).toBe(FORGE_MAX_DURATION_MS);
    expect(resolveForgeDurationMs(0)).toBe(FORGE_MAX_DURATION_MS);
    expect(resolveForgeDurationMs(-1)).toBe(FORGE_MAX_DURATION_MS);
    expect(resolveForgeDurationMs(Number.POSITIVE_INFINITY)).toBe(FORGE_MAX_DURATION_MS);
    expect(resolveForgeDurationMs(undefined)).toBe(FORGE_MAX_DURATION_MS);
  });

  it('keeps watchdog polling inside its operational bounds', () => {
    expect(resolveWatchdogPollMs(1)).toBe(WATCHDOG_MIN_POLL_MS);
    expect(resolveWatchdogPollMs(5_000)).toBe(5_000);
    expect(resolveWatchdogPollMs(WATCHDOG_MAX_POLL_MS + 1)).toBe(WATCHDOG_MAX_POLL_MS);
    expect(resolveWatchdogPollMs(0)).toBe(5_000);
  });

  it('rejects invalid memory arithmetic and preserves exact safe boundaries', () => {
    const gib = 1024 ** 3;
    expect(resolveForgeMemoryFactor('-1')).toBe(0.8);
    expect(resolveForgeMemoryFactor('0.1')).toBe(0.8);
    expect(resolveForgeHeadroomBytes('1')).toBe(8 * gib);
    expect(resolveMemoryFloorBytes(undefined, '1')).toBe(6 * gib);
    expect(() => forgeMemoryVerdict({
      checkpointBytes: 10 * gib,
      availableBytes: 15 * gib,
      factor: -1,
      headroomBytes: 8 * gib,
    })).toThrow(/factor/);
    for (const field of ['checkpointBytes', 'availableBytes']) {
      expect(() => forgeMemoryVerdict({
        checkpointBytes: 0,
        availableBytes: 0,
        [field]: Number.NaN,
        headroomBytes: 8 * gib,
      })).toThrow(/finite safe nonnegative/);
      expect(() => forgeMemoryVerdict({
        checkpointBytes: 0,
        availableBytes: 0,
        [field]: Number.MAX_SAFE_INTEGER + 1,
        headroomBytes: 8 * gib,
      })).toThrow(/finite safe nonnegative/);
    }
    for (const headroomBytes of [-1, Number.NaN, Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => forgeMemoryVerdict({
        checkpointBytes: 0,
        availableBytes: 0,
        headroomBytes,
      })).toThrow(/headroomBytes/);
    }
    expect(() => forgeMemoryVerdict({
      checkpointBytes: Number.MAX_SAFE_INTEGER,
      availableBytes: Number.MAX_SAFE_INTEGER,
      factor: 4,
      headroomBytes: 8 * gib,
    })).toThrow(/byte ceiling/);

    expect(forgeMemoryVerdict({
      checkpointBytes: 10 * gib,
      availableBytes: 16 * gib,
      factor: 0.8,
      headroomBytes: 8 * gib,
    })).toEqual({ fits: true, requiredBytes: 16 * gib, shortfallBytes: 0 });
  });
  it('parses available memory with checked integer multiplication', () => {
    expect(parseAvailableMemoryBytes('MemTotal: 12 kB\nMemAvailable: 8192 kB\n'))
      .toBe(8 * 1024 ** 2);
    expect(() => parseAvailableMemoryBytes('MemAvailable: NaN kB\n'))
      .toThrow(/absent or malformed/);
    expect(() => parseAvailableMemoryBytes(
      `MemAvailable: ${Math.ceil(Number.MAX_SAFE_INTEGER / 1024) + 1} kB\n`,
    )).toThrow(/byte ceiling/);
  });

  it('uses a real short timer to abort with one stable timeout reason and observation', async () => {
    const watchdog = startMemoryWatchdog({
      durationMs: 40,
      floorBytes: 1,
      pollMs: WATCHDOG_MIN_POLL_MS,
    });
    try {
      const failure = await runWatchdogStep(watchdog, (signal) =>
        runStep(
          process.execPath,
          ['-e', 'setTimeout(() => {}, 2_000)'],
          () => {},
          signal,
        )).then(() => null, (error) => error);
      const reason = watchdog.reason;
      expect(failure).toMatchObject({
        code: 'TRAINING_TIMEOUT',
        observed: {
          durationMs: 40,
          floorBytes: 1,
          pollMs: WATCHDOG_MIN_POLL_MS,
        },
      });
      expect(watchdog.signal.aborted).toBe(true);
      expect(reason).toMatchObject({
        code: 'TRAINING_TIMEOUT',
        observed: {
          durationMs: 40,
          floorBytes: 1,
          pollMs: WATCHDOG_MIN_POLL_MS,
        },
      });
      expect(reason.observed.elapsedMs).toBeGreaterThanOrEqual(40);
      expect(watchdog.signal.reason).toBe(reason);
      expect(watchdog.observed).toBe(reason.observed);
      expect(failure.observed).toBe(reason.observed);
      expect(Object.isFrozen(reason)).toBe(true);
      expect(Object.isFrozen(reason.observed)).toBe(true);
    } finally {
      watchdog.stop();
    }
  });
});
