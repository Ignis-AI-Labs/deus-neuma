// Skies persistence — real disk, real seals, no mocks (RULE 0).
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { recordSkies, backfillSkies, readSkies } from '../../core/cosmos/skies-record.js';

const MOMENT = {
  utc: '2026-06-11T10:00:00.000Z',
  epochMs: Date.UTC(2026, 5, 11, 10),
  zone: 'Asia/Jakarta',
  offsetMinutes: 420,
};

describe('skies record — plaintext beside the seal, idempotent', () => {
  let root;
  beforeAll(async () => {
    root = await createTempDir('skies-record');
  });

  it('records once, skips the second time, re-derives only on overwrite', async () => {
    const first = await recordSkies(root, 'keir', MOMENT);
    expect(first.written).toBe(true);
    const onDisk = JSON.parse(await readFile(join(root, 'keir', 'cosmos', 'skies.json'), 'utf8'));
    expect(onDisk.schema).toBe('skies/v1');
    expect(onDisk.systems.mesoamerican.tzolkin.kin).toBeGreaterThanOrEqual(1);

    const second = await recordSkies(root, 'keir', MOMENT);
    expect(second.written).toBe(false); // a recorded sky is a record

    const forced = await recordSkies(root, 'keir', MOMENT, { overwrite: true });
    expect(forced.written).toBe(true);
  });

  it('backfills from the being\'s own sealed birth moment', async () => {
    const identityDir = join(root, 'signal', 'identity');
    await mkdir(identityDir, { recursive: true });
    await writeFile(join(identityDir, 'genesis-seal.json'), JSON.stringify({
      genesisHash: 'ab'.repeat(32),
      record: { birthMoment: MOMENT },
    }));

    const result = await backfillSkies(root, 'signal');
    expect(result.written).toBe(true);

    const skies = await readSkies(root, 'signal');
    expect(skies.instant).toBe(MOMENT.utc);
    expect(skies.local.jdn).toBeGreaterThan(2461000); // 2026 local date
    // The reading is complete: all v1 systems + honest omissions.
    expect(Object.keys(skies.systems)).toHaveLength(9);
    expect(skies.omitted.some((o) => o.system === 'ifa')).toBe(true);
  });

  it('refuses to backfill a lane with no seal', async () => {
    await expect(backfillSkies(root, 'nobody')).rejects.toThrow();
  });

  it('readSkies returns null for an unrecorded lane — never throws', async () => {
    expect(await readSkies(root, 'unrecorded')).toBeNull();
  });
});
