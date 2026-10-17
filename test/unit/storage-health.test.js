/**
 * Storage health — pure threshold judgment + real statfs measurement
 * (RULE 0: freeGBAt/checkStorage run against the real filesystem).
 */

import { tmpdir } from 'os';
import {
  MIN_FREE_DISK_GB, RECOMMENDED_FREE_DISK_GB,
  freeGBAt, assessStorage, checkStorage,
} from '../../backend/services/storage-health.js';

describe('assessStorage (pure)', () => {
  test('null measurement is honestly unknown, never ok', () => {
    expect(assessStorage(null)).toEqual({
      level: 'unknown', freeGB: null,
      minGB: MIN_FREE_DISK_GB, recommendedGB: RECOMMENDED_FREE_DISK_GB,
    });
  });

  test('below the floor is critical', () => {
    expect(assessStorage(0.4).level).toBe('critical');
    expect(assessStorage(0).level).toBe('critical');
  });

  test('at the floor but under recommended is low', () => {
    expect(assessStorage(MIN_FREE_DISK_GB).level).toBe('low');
    expect(assessStorage(RECOMMENDED_FREE_DISK_GB - 0.1).level).toBe('low');
  });

  test('at or above recommended is ok', () => {
    expect(assessStorage(RECOMMENDED_FREE_DISK_GB).level).toBe('ok');
    expect(assessStorage(500).level).toBe('ok');
  });

  test('freeGB is reported to one decimal, thresholds ride along', () => {
    const a = assessStorage(123.456);
    expect(a.freeGB).toBe(123.5);
    expect(a.minGB).toBe(MIN_FREE_DISK_GB);
    expect(a.recommendedGB).toBe(RECOMMENDED_FREE_DISK_GB);
  });
});

describe('freeGBAt / checkStorage (real filesystem)', () => {
  test('a real directory measures to a positive number of gigabytes', async () => {
    const free = await freeGBAt(tmpdir());
    expect(typeof free).toBe('number');
    expect(free).toBeGreaterThan(0);
  });

  test('an unmeasurable path returns null, and checkStorage judges it unknown', async () => {
    expect(await freeGBAt('/no/such/path/anywhere-at-all')).toBeNull();
    const assessment = await checkStorage('/no/such/path/anywhere-at-all');
    expect(assessment.level).toBe('unknown');
  });

  test('checkStorage on a real path agrees with a direct measurement', async () => {
    const [assessment, free] = await Promise.all([checkStorage(tmpdir()), freeGBAt(tmpdir())]);
    expect(assessment.level).toBe(assessStorage(free).level);
  });
});
