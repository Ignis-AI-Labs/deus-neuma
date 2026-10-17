/**
 * team-run-store — real disk, isolated dir (RULE 0: no mocks). The store that
 * makes a dropped team run resumable: claimed once, snapshotted as the run
 * moves, owner-scoped on every read.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { join } from 'path';
import { createRun, updateRun, readRun, listRuns } from '../../backend/services/team-run-store.js';
import { createTempDir } from '../helpers/temp-fs.js';

const WITNESS = '0xAAAA000000000000000000000000000000000001';
const STRANGER = '0xBBBB000000000000000000000000000000000002';

const record = (over = {}) => ({
  by: WITNESS,
  runAt: '2026-07-08T15:00:00.000Z',
  name: 'TEAM ALPHA',
  goal: 'ship the thing',
  status: 'running',
  steps: [{ id: 'a', neumaId: 'keir', task: 'do it', needs: [] }],
  completed: {},
  statuses: {},
  torches: {},
  order: [],
  failures: {},
  finishedAt: null,
  ...over,
});

let dir;
beforeEach(async () => {
  dir = await createTempDir('team-run-store');
  process.env.NEUMA_TEAM_RUN_PATH = dir;
});
afterEach(async () => {
  delete process.env.NEUMA_TEAM_RUN_PATH;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createRun', () => {
  test('claims one file per run and returns the derived id', async () => {
    const id = await createRun(record());
    expect(id).toBe('2026-07-08T15-00-00-000Z');
    const onDisk = JSON.parse(await fs.readFile(join(dir, `${id}.json`), 'utf8'));
    expect(onDisk.goal).toBe('ship the thing');
    expect(onDisk.status).toBe('running');
  });

  test('same-millisecond collision gets an ordinal, never a silent overwrite', async () => {
    const first = await createRun(record({ name: 'ONE' }));
    const second = await createRun(record({ name: 'TWO' }));
    expect(second).toBe(`${first}-2`);
    expect((await readRun(first, WITNESS)).name).toBe('ONE');
    expect((await readRun(second, WITNESS)).name).toBe('TWO');
  });

  test('refuses a record without provenance, owner, or plan', async () => {
    await expect(createRun(record({ runAt: undefined }))).rejects.toThrow(/runAt/);
    await expect(createRun(record({ by: '' }))).rejects.toThrow(/owning wallet/);
    await expect(createRun(record({ steps: [] }))).rejects.toThrow(/plan/);
  });
});

describe('updateRun', () => {
  test('lands a full snapshot over the claim; id/by/runAt cannot drift', async () => {
    const id = await createRun(record());
    await updateRun(id, WITNESS, record({
      by: STRANGER, // an update cannot re-home the record
      runAt: '1999-01-01T00:00:00.000Z', // nor rewrite its provenance
      status: 'done',
      completed: { a: 'the work' },
      torches: { keir: 'picked up where I left off' },
      order: ['a'],
      finishedAt: '2026-07-08T15:05:00.000Z',
    }));
    const after = await readRun(id, WITNESS);
    expect(after.status).toBe('done');
    expect(after.completed.a).toBe('the work');
    expect(after.torches.keir).toBe('picked up where I left off');
    expect(after.by).toBe(WITNESS);
    expect(after.runAt).toBe('2026-07-08T15:00:00.000Z');
  });

  test('refuses a missing record — an update never silently creates', async () => {
    await expect(updateRun('2026-01-01T00-00-00-000Z', WITNESS, record()))
      .rejects.toThrow(/no record to update/);
  });

  test("refuses a foreign wallet with the same absent-shaped error — a forged id cannot clobber", async () => {
    const id = await createRun(record());
    await expect(updateRun(id, STRANGER, record({ status: 'done' })))
      .rejects.toThrow(/no record to update/);
    expect((await readRun(id, WITNESS)).status).toBe('running');
  });
});

describe('readRun / listRuns — owner-scoped', () => {
  test("another wallet's run reads as absent, never as forbidden-but-real", async () => {
    const id = await createRun(record());
    expect(await readRun(id, STRANGER)).toBeNull();
    expect(await listRuns(STRANGER)).toEqual([]);
  });

  test('list carries summaries newest-first, counts instead of bodies', async () => {
    await createRun(record({ runAt: '2026-07-08T15:00:00.000Z' }));
    const later = await createRun(record({ runAt: '2026-07-08T16:00:00.000Z', name: 'LATER' }));
    // An update is a FULL snapshot — the route composes complete truth every
    // time; anything omitted is honestly gone from the record.
    await updateRun(later, WITNESS, record({
      name: 'LATER',
      status: 'failed',
      completed: { a: 'body never listed' },
      failures: { b: 'conduit dropped' },
    }));
    const list = await listRuns(WITNESS);
    expect(list.map((r) => r.name)).toEqual(['LATER', 'TEAM ALPHA']);
    expect(list[0]).toMatchObject({ status: 'failed', completed: 1, failures: 1, steps: 1 });
    expect(JSON.stringify(list)).not.toContain('body never listed');
  });

  test('a corrupt file is skipped, never fabricated; unsafe ids read as null', async () => {
    await createRun(record());
    await fs.writeFile(join(dir, 'broken.json'), '{not json');
    expect((await listRuns(WITNESS)).length).toBe(1);
    expect(await readRun('../escape', WITNESS)).toBeNull();
  });
});
