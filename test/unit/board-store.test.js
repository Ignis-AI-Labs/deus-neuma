/**
 * THE HOUSE BOARD (unit, RULE 0: real disk, no mock) — the shared task
 * ledger's lifecycle: pure shape law, exclusive-create ids, frozen
 * settlements, and the open-first ordering that puts the longest-waiting
 * work on top.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  makeEntry, fileEntry, readEntry, updateEntry, listEntries, BOARD_STALE_MS,
} from '../../backend/services/staff/board-store.js';

let ground;

const entry = (over = {}) => makeEntry({
  owner: 'scribe-lane',
  filedBy: 'scribe-lane',
  title: 'Draft the ledger report',
  filedAt: '2026-09-15T04:00:00.000Z',
  ...over,
});

beforeEach(async () => {
  ground = await fs.mkdtemp(path.join(os.tmpdir(), 'house-board-'));
});

afterEach(async () => {
  await fs.rm(ground, { recursive: true, force: true });
});

describe('makeEntry — the pure shape law', () => {
  test('a lawful entry opens under its owner, stamped from birth (G7)', () => {
    const e = entry();
    expect(e.v).toBe(1);
    expect(e.status).toBe('open');
    expect(e.owner).toBe('scribe-lane');
    expect(e.updatedAt).toBe(e.filedAt);
    expect(e.blockedBy).toBeNull();
  });

  test('it refuses an unlawful shape', () => {
    expect(() => entry({ owner: 'BAD' })).toThrow(/lawful lane id/);
    expect(() => entry({ title: '' })).toThrow(/title/);
    expect(() => entry({ title: 'x'.repeat(121) })).toThrow(/120/);
    expect(() => entry({ filedAt: 'nope' })).toThrow(/filedAt/);
    expect(() => entry({ blockedBy: 'not an id!' })).toThrow(/lawful entry id/);
  });
});

describe('the board lifecycle', () => {
  test('file → read round-trips; a same-instant collision gets an ordinal', async () => {
    const first = await fileEntry(ground, entry());
    const second = await fileEntry(ground, entry({ title: 'Second entry' }));
    expect(second.id).not.toBe(first.id);
    expect(second.id).toMatch(/-2$/);
    expect((await readEntry(ground, first.id)).title).toBe('Draft the ledger report');
  });

  test('updateEntry moves a live entry and stamps updatedAt', async () => {
    const { id } = await fileEntry(ground, entry());
    const moved = await updateEntry(ground, id, { status: 'working', note: 'on it' });
    expect(moved.status).toBe('working');
    expect(moved.note).toBe('on it');
    expect(Date.parse(moved.updatedAt)).toBeGreaterThan(Date.parse('2026-09-15T04:00:00.000Z'));
  });

  test('a settled entry is frozen', async () => {
    const { id } = await fileEntry(ground, entry());
    await updateEntry(ground, id, { status: 'done' });
    await expect(updateEntry(ground, id, { status: 'working' })).rejects.toThrow(/settled entry does not move/);
  });

  test('updateEntry refuses an unknown status and a missing entry', async () => {
    const { id } = await fileEntry(ground, entry());
    await expect(updateEntry(ground, id, { status: 'vibes' })).rejects.toThrow(/not a board status/);
    await expect(updateEntry(ground, 'nope', { note: 'x' })).rejects.toThrow(/not on the board/);
  });

  test('listEntries puts open work oldest-update-first, settled after', async () => {
    await fileEntry(ground, entry()); // open, updated 04:00
    const working = await fileEntry(ground, entry({ title: 'Working entry' }));
    await updateEntry(ground, working.id, { status: 'working' });
    const settled = entry({ title: 'A settled entry' });
    await fileEntry(ground, { ...settled, status: 'done' });
    const list = await listEntries(ground);
    expect(list.map((e) => e.status)).toEqual(['open', 'working', 'done']);
    expect(list[0].title).toBe('Draft the ledger report');
    expect(list[0].body).toBeUndefined();
  });

  test('an empty board is the ordinary case', async () => {
    expect(await listEntries(ground)).toEqual([]);
    expect(BOARD_STALE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
