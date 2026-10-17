// capacity-store.test.js — real disk, real files, zero mocks (RULE 0).
//
// Every test runs against a real temp directory via NEUMA_CAPACITY_PATH — the
// exact isolation the store exists to honor (the 2026-07-03 shadow-lane
// lesson: a test that forgets the override would write into the operator's
// live scan history).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { join } from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  writeCapacity,
  readCapacity,
  listCapacity,
  readLatestCapacity,
  readUsableCapacity,
  usableCapacity,
} from '../../backend/services/capacity-store.js';

const result = (runAt, extra = {}) => ({
  ceiling: 8,
  limitedBy: 'throughput',
  incomplete: false,
  aggregateTokPerSecAtCeiling: 800,
  perAgentLatencyAtCeiling: 1200,
  boundClass: 'A',
  vramFitEstimate: null,
  rawSamples: [{ concurrency: 1, aggregateTokPerSec: 100, perAgentLatencyMs: 1000, ok: true, tokenSource: 'whitespace' }],
  substrate: { model: 'qwen3.5-122b', provider: 'lm-studio', endpoint: 'http://localhost:1234', gpu: 'RTX PRO 6000', vramGB: 96, memoryGB: 128 },
  runAt,
  consent: { by: '0xtest', at: runAt },
  ...extra,
});

let dir;

beforeEach(async () => {
  dir = await createTempDir('capacity-store');
  process.env.NEUMA_CAPACITY_PATH = dir;
});

afterEach(async () => {
  delete process.env.NEUMA_CAPACITY_PATH;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('writeCapacity / readCapacity', () => {
  it('round-trips a full result through the real disk', async () => {
    const r = result('2026-07-04T10:00:00.000Z');
    const id = await writeCapacity(r);
    expect(id).toBe('2026-07-04T10-00-00-000Z');
    const back = await readCapacity(id);
    expect(back).toEqual(r);
    expect(back.rawSamples).toHaveLength(1); // full read keeps provenance
  });

  it('append-only: two runs land as two distinct files', async () => {
    await writeCapacity(result('2026-07-04T10:00:00.000Z'));
    await writeCapacity(result('2026-07-04T11:00:00.000Z'));
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(2);
  });

  it('refuses a result without runAt — no provenance, no record (AC-2)', async () => {
    await expect(writeCapacity({ ceiling: 8 })).rejects.toThrow(/provenance/);
    expect((await fs.readdir(dir)).length).toBe(0); // nothing written
  });

  it('readCapacity returns null for a missing or unsafe id', async () => {
    expect(await readCapacity('2099-01-01T00-00-00-000Z')).toBeNull();
    expect(await readCapacity('../../../etc/passwd')).toBeNull();
  });
});

describe('listCapacity / readLatestCapacity', () => {
  it('lists newest first, without rawSamples', async () => {
    await writeCapacity(result('2026-07-04T10:00:00.000Z'));
    await writeCapacity(result('2026-07-04T12:00:00.000Z'));
    await writeCapacity(result('2026-07-04T11:00:00.000Z'));
    const runs = await listCapacity();
    expect(runs.map((r) => r.runAt)).toEqual([
      '2026-07-04T12:00:00.000Z',
      '2026-07-04T11:00:00.000Z',
      '2026-07-04T10:00:00.000Z',
    ]);
    for (const run of runs) {
      expect(run.rawSamples).toBeUndefined();
      expect(run.id).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  it('empty history before the first scan — honest empty, never fabricated', async () => {
    expect(await listCapacity()).toEqual([]);
    expect(await readLatestCapacity()).toBeNull();
  });

  it('readLatestCapacity returns the newest FULL run, samples included', async () => {
    await writeCapacity(result('2026-07-04T10:00:00.000Z', { ceiling: 4 }));
    await writeCapacity(result('2026-07-04T12:00:00.000Z', { ceiling: 8 }));
    const latest = await readLatestCapacity();
    expect(latest.ceiling).toBe(8);
    expect(latest.rawSamples).toHaveLength(1);
  });

  it('skips an unreadable file instead of fabricating a record', async () => {
    await writeCapacity(result('2026-07-04T10:00:00.000Z'));
    await fs.writeFile(join(dir, 'corrupt.json'), 'not json {');
    const runs = await listCapacity();
    expect(runs).toHaveLength(1);
    expect(runs[0].runAt).toBe('2026-07-04T10:00:00.000Z');
  });
});

describe('test isolation (NEUMA_CAPACITY_PATH)', () => {
  it('the override is resolved per call — everything lands in the test dir', async () => {
    await writeCapacity(result('2026-07-04T10:00:00.000Z'));
    const files = await fs.readdir(dir);
    expect(files).toContain('2026-07-04T10-00-00-000Z.json');
  });
});

// 2026-10-13: the Sep 9 scan read 6 on a 4-slot server. What the platform USES
// is never wider than the server serves; the measured number stays, named.
describe('usableCapacity / readUsableCapacity', () => {
  it('a ceiling wider than the served slots is clamped, the measured one kept', async () => {
    await writeCapacity(result('2026-07-04T12:00:00.000Z', { ceiling: 8 }));
    const usable = await readUsableCapacity();
    expect(usable.ceiling).toBe(4);
    expect(usable.measuredCeiling).toBe(8);
    expect(usable.servedSlots).toBe(4);
  });

  it('a ceiling within the served slots stands as measured', () => {
    expect(usableCapacity({ ceiling: 3 }, 4)).toEqual({ ceiling: 3, measuredCeiling: 3, servedSlots: 4 });
  });

  it('no scan yet stays null', async () => {
    expect(await readUsableCapacity()).toBeNull();
  });
});
