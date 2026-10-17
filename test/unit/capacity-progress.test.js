/**
 * THE CAPACITY SCAN'S PROGRESS — a measurement you can watch.
 *
 * Design note, 2026-08-29, staring at the panel: […]
 *
 * He was right on every count, and the causes were three:
 *   1. the scan emitted NOTHING — it ran up to five minutes in silence;
 *   2. "MEASURING" was the panel's OWN local state, so reopening the window
 *      mid-scan showed nothing and a wedged run looked identical to a live one;
 *   3. there was no ETA because nothing was ever timed.
 *
 * These are the laws that keep that shut. No mock anywhere (RULE 0): the
 * progress events come from the REAL `runCapacityScan` ladder, driven through
 * the `fire` seam the module documents as its injection point, and the line is
 * the REAL pure renderer the card draws.
 */
import { describe, test, expect } from 'vitest';
import { runCapacityScan, DEFAULT_LADDER, REPEATS_PER_LEVEL } from '../../backend/services/capacity-scan.js';
import { scanLine } from '../../frontend/app/RelinkShell/ParallelCeilingCard.jsx';

const AT = Date.parse('2026-08-29T09:00:00Z');

// A level that answers instantly and never knees, so the ladder runs long
// enough to watch. The wave shape is the real one the scan consumes.
const flatFire = async (concurrency) => ({
  ok: true, concurrency, medianMs: 100, throughput: concurrency,
});

const collect = async (fire) => {
  const seen = [];
  await runCapacityScan({
    fire,
    testConnection: async () => true,
    substrate: { model: 'probe' },
    runAt: '2026-08-29T09:00:00Z',
    onProgress: (p) => seen.push(p),
  }).catch(() => {});
  return seen;
};

describe('the scan reports itself while it runs', () => {
  test('every ladder level announces its start AND its finish', async () => {
    const seen = await collect(flatFire);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0].phase).toBe('level-start');
    expect(seen[0].concurrency).toBe(DEFAULT_LADDER[0]);
    expect(seen[0].probesInLevel).toBe(DEFAULT_LADDER[0] * REPEATS_PER_LEVEL);
    // Starts and finishes strictly alternate — a level that began and never
    // ended is exactly the wedge the operator needs to be able to see.
    for (let i = 0; i < seen.length; i += 2) {
      expect(seen[i].phase).toBe('level-start');
      expect(seen[i + 1]?.phase).toBe('level-done');
      expect(seen[i + 1].concurrency).toBe(seen[i].concurrency);
    }
  });

  test('levelsDone only ever counts levels that actually FINISHED', async () => {
    const seen = await collect(flatFire);
    const starts = seen.filter((p) => p.phase === 'level-start');
    const dones = seen.filter((p) => p.phase === 'level-done');
    expect(starts[0].levelsDone).toBe(0);
    dones.forEach((p, i) => expect(p.levelsDone).toBe(i + 1));
    // The ladder rides every event, so the panel can say "3 of 7" without
    // holding its own copy that could drift from the scan's.
    for (const p of seen) expect(p.ladder).toEqual([...DEFAULT_LADDER]);
  });

  test('a level is TIMED, which is the only reason an ETA can exist', async () => {
    const seen = await collect(flatFire);
    expect(seen[0].meanLevelMs).toBeNull();          // nothing measured yet
    const done = seen.filter((p) => p.phase === 'level-done');
    expect(done[done.length - 1].meanLevelMs).not.toBeNull();
    expect(done[done.length - 1].meanLevelMs).toBeGreaterThanOrEqual(0);
  });

  test('a dead substrate says so instead of reporting a phantom scan', async () => {
    const seen = [];
    await runCapacityScan({
      fire: flatFire,
      testConnection: async () => false,
      substrate: {}, runAt: '2026-08-29T09:00:00Z',
      onProgress: (p) => seen.push(p),
    }).catch(() => {});
    expect(seen[0].phase).toBe('unreachable');
  });

  test('a progress listener that throws can never fail a real measurement', async () => {
    const result = await runCapacityScan({
      fire: flatFire,
      testConnection: async () => true,
      substrate: { model: 'probe' }, runAt: '2026-08-29T09:00:00Z',
      onProgress: () => { throw new Error('the panel exploded'); },
    });
    expect(result.ceiling).toBeGreaterThan(0);
  });
});

describe('what the operator actually reads', () => {
  test('nothing running says nothing', () => {
    expect(scanLine({ running: false }, AT)).toBeNull();
    expect(scanLine(null, AT)).toBeNull();
  });

  test('before the first level is timed there is NO ETA — a number would be invented', () => {
    const line = scanLine({
      running: true, startedAt: '2026-08-29T09:00:00Z',
      progress: { phase: 'starting', ladder: [...DEFAULT_LADDER] },
    }, AT + 4000);
    expect(line).toContain('STARTING');
    expect(line).toContain('4s elapsed');
    expect(line).not.toContain('left');
  });

  test('under load it names the level, the position, the clock, and a CEILING on the wait', () => {
    const line = scanLine({
      running: true, startedAt: '2026-08-29T09:00:00Z',
      progress: {
        phase: 'level-start', concurrency: 8, ladder: [...DEFAULT_LADDER],
        levelsDone: 3, meanLevelMs: 20_000, deadlineMs: 300_000,
      },
    }, AT + 95_000);
    expect(line).toContain('MEASURING 8 AT ONCE');
    expect(line).toContain('level 4/7');
    expect(line).toContain('1m 35s elapsed');
    // 4 levels left x 20s = 80s, and it is stated as a bound because the knee
    // can end the scan at any level.
    expect(line).toContain('at most ~1m 20s left');
    expect(line).toContain('stops early when the ceiling is found');
  });

  test('the ETA never exceeds the run deadline that is actually left', () => {
    const line = scanLine({
      running: true, startedAt: '2026-08-29T09:00:00Z',
      progress: {
        phase: 'level-start', concurrency: 64, ladder: [...DEFAULT_LADDER],
        levelsDone: 1, meanLevelMs: 120_000, deadlineMs: 300_000,
      },
    }, AT + 280_000);
    // 6 levels x 2min would be 12 minutes, but only 20s of deadline remain.
    expect(line).toContain('at most ~20s left');
  });

  test('an unreachable substrate is said plainly, not dressed as progress', () => {
    expect(scanLine({ running: true, progress: { phase: 'unreachable', ladder: [1, 2] } }, AT))
      .toContain('THE SUBSTRATE DID NOT ANSWER');
  });

  test('the elapsed clock comes from the START STAMP, so it survives a reopened window', () => {
    // The panel that did not start the scan still shows the true elapsed time.
    const line = scanLine({
      running: true, startedAt: '2026-08-29T09:00:00Z',
      progress: { phase: 'level-start', concurrency: 2, ladder: [1, 2], levelsDone: 1, meanLevelMs: 1000 },
    }, AT + 65_000);
    expect(line).toContain('1m 5s elapsed');
  });
});
