/**
 * THE TAKES — the branch-view fold's truth table (pure tables) plus the
 * workspace's take-writing append paths against a REAL temp workspace on
 * REAL encrypted disk (RULE 0 — the append functions do IO, so they are
 * proven where the IO actually lands, never against a stub).
 *
 * Tables pinned here:
 *   - multi-take points fold to the VIEWED take, latest by default
 *   - legacy rows (no turnId) fold as single-take points, byte-identical
 *   - branchView rows switch the view; latest row wins per key; a view
 *     naming a nonexistent take clamps to latest rather than rendering nothing
 *   - compaction summary rows and junk pass through, never folded into takes
 *   - a duplicated user row of one point (the pre-takes bare re-send record)
 *     folds to ONE ask
 *   - turnPointCount counts answered POINTS, not rows
 *   - findTurnUserRow anchors by turnId, or by content+timestamp for legacy
 *   - appendTurnPoint / appendTake / appendBranchView land on disk readable
 *     through the same engine, and the fold reads them back
 */

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  isBranchViewRow,
  latestBranchView,
  takeCounts,
  foldBranchView,
  turnPointCount,
  findTurnUserRow,
} from '../../core/workspace/branch-view.js';
import {
  latestBranchView as deskLatestBranchView,
  foldForDisplay,
} from '../../frontend/app/RelinkShell/branch-view.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const user = (content, extra = {}) => ({ role: 'user', content, ...extra });
const take = (turnId, takeIndex, content, extra = {}) =>
  ({ role: 'assistant', content, turnId, takeIndex, ...extra });
const legacyAnswer = (content) => ({ role: 'assistant', content });
const viewRow = (map) => ({ role: 'system', branchView: map });
const summaryRow = () => ({ role: 'system', content: '[SESSION SUMMARY] …', compacted: true });

describe('branch-view fold — the truth table', () => {
  test('a multi-take point folds to the LATEST take by default, user row once', () => {
    const records = [
      user('q1', { turnId: 't1' }),
      take('t1', 1, 'first answer'),
      take('t1', 2, 'second answer'),
      take('t1', 3, 'third answer'),
    ];
    expect(foldBranchView(records)).toEqual([
      user('q1', { turnId: 't1' }),
      take('t1', 3, 'third answer'),
    ]);
  });

  test('a branchView row switches the viewed take; the latest row wins per key', () => {
    const records = [
      user('q1', { turnId: 't1' }),
      take('t1', 1, 'a1'),
      take('t1', 2, 'a2'),
      take('t1', 3, 'a3'),
      viewRow({ t1: 1 }),
      viewRow({ t1: 2 }),
    ];
    expect(foldBranchView(records).map((r) => r.content)).toEqual(['q1', 'a2', undefined, undefined]);
    expect(latestBranchView(records)).toEqual({ t1: 2 });
  });

  test('a view naming a take that does not exist clamps to the latest — never renders nothing', () => {
    const records = [
      user('q1', { turnId: 't1' }),
      take('t1', 1, 'a1'),
      take('t1', 2, 'a2'),
      viewRow({ t1: 9 }),
    ];
    expect(foldBranchView(records).map((r) => r.content)).toEqual(['q1', 'a2', undefined]);
  });

  test('an invalid view value (0, negative, garbage) is ignored', () => {
    expect(latestBranchView([viewRow({ t1: 0 }), viewRow({ t1: -2 }), viewRow({ t1: 'two' })])).toEqual({});
  });

  test('legacy rows (no turnId) pass through untouched — every answer its own point', () => {
    const records = [user('q1'), legacyAnswer('a1'), user('q1'), legacyAnswer('a2')];
    expect(foldBranchView(records)).toEqual(records);
    expect(takeCounts(records)).toEqual({});
    expect(turnPointCount(records)).toBe(2);
  });

  test('compaction summary rows and branch-view markers pass through; takes fold around them', () => {
    const records = [
      summaryRow(),
      user('q1', { turnId: 't1' }),
      take('t1', 1, 'a1'),
      take('t1', 2, 'a2'),
      viewRow({ t1: 1 }),
    ];
    const folded = foldBranchView(records);
    expect(folded[0]).toEqual(summaryRow());
    expect(folded.map((r) => r.content)).toEqual(['[SESSION SUMMARY] …', 'q1', 'a1', undefined]);
    expect(isBranchViewRow(folded.at(-1))).toBe(true);
  });

  test('a duplicated user row of one point (the pre-takes re-send record) folds to one ask', () => {
    const records = [
      user('q1', { turnId: 't1' }),
      take('t1', 1, 'a1'),
      user('q1', { turnId: 't1' }), // the bare re-send wrote the ask twice
      take('t1', 2, 'a2'),
    ];
    expect(foldBranchView(records).map((r) => r.content)).toEqual(['q1', 'a2']);
  });

  test('an unanswered point keeps its user row; orphan takes fold among themselves', () => {
    const records = [
      user('q-new', { turnId: 't9' }),
      take('t1', 1, 'a1'), // user row fell outside the slice — takes still fold
      take('t1', 2, 'a2'),
    ];
    expect(foldBranchView(records).map((r) => r.content)).toEqual(['q-new', 'a2']);
  });

  test('junk and unknown roles pass through; null entries survive', () => {
    const records = [null, { role: 'tool', content: 'x' }, 'stray', user('q', { turnId: 't1' })];
    expect(foldBranchView(records)).toEqual(records);
  });

  test('takeCounts counts takes per point; a take missing its index reads as take 1', () => {
    const records = [
      take('t1', 1, 'a1'), take('t1', 2, 'a2'),
      { role: 'assistant', content: 'unindexed', turnId: 't2' },
    ];
    expect(takeCounts(records)).toEqual({ t1: 2, t2: 1 });
    expect(foldBranchView(records).map((r) => r.content)).toEqual(['a2', 'unindexed']);
  });

  test('turnPointCount counts answered POINTS — takes share their point', () => {
    const records = [
      user('q1', { turnId: 't1' }),
      take('t1', 1, 'a1'),
      take('t1', 2, 'a2'),
      take('t1', 3, 'a3'),
      user('q2', { turnId: 't2' }), // unanswered — counts nothing, as before
      user('q3'), legacyAnswer('a-legacy'),
    ];
    expect(turnPointCount(records)).toBe(2);
  });

  test('findTurnUserRow anchors by turnId, or by content+timestamp for a legacy row', () => {
    const row = user('q1', { turnId: 't1' });
    const legacy = user('old words', { timestamp: '2026-07-27T00:00:00.000Z' });
    const records = [row, legacy];
    expect(findTurnUserRow(records, { turnId: 't1' })).toBe(row);
    expect(findTurnUserRow(records, { content: 'old words', timestamp: '2026-07-27T00:00:00.000Z' })).toBe(legacy);
    // a turnId never matches a legacy row, and content never matches a turned row
    expect(findTurnUserRow(records, { turnId: 'nope' })).toBe(null);
    expect(findTurnUserRow(records, { content: 'q1' })).toBe(null);
    expect(findTurnUserRow(records, {})).toBe(null);
  });

  test('the fold takes an explicit view (a slice folded with the full-file view)', () => {
    const tail = [take('t1', 1, 'a1'), take('t1', 2, 'a2')];
    expect(foldBranchView(tail, { t1: 1 }).map((r) => r.content)).toEqual(['a1']);
    expect(foldBranchView([])).toEqual([]);
    expect(foldBranchView(undefined)).toEqual([]);
  });

  test('THE EDIT-FORK — the viewed take\'s revised ask is the point\'s displayed ask', () => {
    const records = [
      user('first asking', { turnId: 't1' }),
      take('t1', 1, 'a1'),
      take('t1', 2, 'a2', { ask: 'revised asking' }),
    ];
    // Viewing the revised take (latest by default) shows the revised asking…
    const folded = foldBranchView(records);
    expect(folded.map((r) => r.content)).toEqual(['revised asking', 'a2']);
    // …the record itself is never mutated — the fold answers a copy.
    expect(records[0].content).toBe('first asking');
    // …and viewing take 1 shows the FIRST asking again.
    expect(foldBranchView(records, { t1: 1 }).map((r) => r.content)).toEqual(['first asking', 'a1']);
  });

  test('a take without an ask leaves the point\'s asking on the user row', () => {
    const records = [
      user('first asking', { turnId: 't1' }),
      take('t1', 1, 'a1'),
      take('t1', 2, 'a2'), // a plain retry — no revised words
    ];
    expect(foldBranchView(records).map((r) => r.content)).toEqual(['first asking', 'a2']);
  });

  test('an ask on a NON-viewed take never leaks into the displayed asking', () => {
    const records = [
      user('first asking', { turnId: 't1' }),
      take('t1', 1, 'a1', { ask: 'earlier revision' }),
      take('t1', 2, 'a2'),
    ];
    // Viewing take 1 shows ITS ask; the default (take 2, no ask) shows the record.
    expect(foldBranchView(records, { t1: 1 }).map((r) => r.content)).toEqual(['earlier revision', 'a1']);
    expect(foldBranchView(records).map((r) => r.content)).toEqual(['first asking', 'a2']);
  });
});

describe('workspace take appends — real temp workspace, real encrypted disk', () => {
  let origRoot;
  const KEY = 'branch-view-test-key-long-enough';
  const NEUMA = 'takesecho';
  const SESSION = 'sess-takes';

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = KEY;
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(await createTempDir('branch-view-ws'));
    await workspace.create(NEUMA);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    setWorkspacesRoot(origRoot);
    delete process.env.DNA_ENCRYPTION_KEY;
  });

  test('appendTurnPoint mints a turnId; appendTake links the answers; the fold reads them back', async () => {
    const point = await workspace.appendTurnPoint(NEUMA, SESSION, { role: 'user', content: 'what is the void?' });
    expect(typeof point.turnId).toBe('string');
    expect(point.turnId.length).toBeGreaterThan(0);
    expect(typeof point.timestamp).toBe('string');

    await workspace.appendTake(NEUMA, SESSION, point.turnId, 1, { role: 'assistant', content: 'first' });
    await workspace.appendTake(NEUMA, SESSION, point.turnId, 2, { role: 'assistant', content: 'second' });

    const records = await workspace.readSession(NEUMA, SESSION);
    // The record keeps EVERYTHING — both takes, one user row (append-only law).
    expect(records.filter((r) => r.role === 'user')).toHaveLength(1);
    expect(records.filter((r) => r.role === 'assistant')).toHaveLength(2);
    expect(takeCounts(records)).toEqual({ [point.turnId]: 2 });
    // …and the fold of the same records shows the latest take, one ask.
    expect(foldBranchView(records).map((r) => r.content)).toEqual(['what is the void?', 'second']);
  });

  test('appendBranchView lands a view row that survives a re-read and moves the fold', async () => {
    const records = await workspace.readSession(NEUMA, SESSION);
    const turnId = records.find((r) => r.role === 'user').turnId;
    await workspace.appendBranchView(NEUMA, SESSION, { [turnId]: 1 });

    const reread = await workspace.readSession(NEUMA, SESSION);
    expect(latestBranchView(reread)).toEqual({ [turnId]: 1 });
    expect(foldBranchView(reread).map((r) => r.content)).toEqual(['what is the void?', 'first', undefined]);
  });

  test('a take carrying a revised ask round-trips through the real file and the fold prefers it', async () => {
    const point = await workspace.appendTurnPoint(NEUMA, SESSION, { role: 'user', content: 'original words' });
    await workspace.appendTake(NEUMA, SESSION, point.turnId, 1, { role: 'assistant', content: 'v1' });
    await workspace.appendTake(NEUMA, SESSION, point.turnId, 2, { role: 'assistant', content: 'v2', ask: 'revised words' });

    const reread = await workspace.readSession(NEUMA, SESSION);
    const take2 = reread.find((r) => r.turnId === point.turnId && r.takeIndex === 2);
    expect(take2.ask).toBe('revised words'); // the field survived the disk round-trip
    // The point's own slice folded with the full-file view: revised ask shows.
    const slice = reread.filter((r) => r.turnId === point.turnId);
    expect(foldBranchView(slice, latestBranchView(reread)).map((r) => r.content))
      .toEqual(['revised words', 'v2']);
    expect(foldBranchView(slice, { [point.turnId]: 1 }).map((r) => r.content))
      .toEqual(['original words', 'v1']);
  });

  test('appendTake validates its identity — a take without a point or index refuses to write', async () => {
    await expect(workspace.appendTake(NEUMA, SESSION, '', 1, { role: 'assistant', content: 'x' }))
      .rejects.toThrow(/turnId/);
    await expect(workspace.appendTake(NEUMA, SESSION, 't', 0, { role: 'assistant', content: 'x' }))
      .rejects.toThrow(/takeIndex/);
    await expect(workspace.appendBranchView(NEUMA, SESSION, { t: 0 }))
      .rejects.toThrow(/branchView/i);
    // Nothing landed — the file holds exactly the takes the previous tests wrote.
    const records = await workspace.readSession(NEUMA, SESSION);
    expect(records.filter((r) => r.role === 'assistant')).toHaveLength(4);
  });

  test('appendMessage is untouched for every existing caller — no turnId appears uninvited', async () => {
    const record = await workspace.appendMessage(NEUMA, SESSION, { role: 'user', content: 'plain append' });
    expect(record.turnId).toBeUndefined();
  });
});

describe('the desk mirror (frontend/app/RelinkShell/branch-view.js) — the SAME law, the same tables', () => {
  // The desk cannot import the engine's module, so it carries a deliberate
  // mirror. These tables pin the SHARED law against both folds: same view
  // resolution, same default, same clamp, same dedup — only the answer's
  // SHAPE differs (the engine answers "which rows show", the desk answers
  // […]).
  test('the view map agrees: latest row wins per key, invalid values ignored', () => {
    const records = [viewRow({ t1: 1 }), viewRow({ t1: 2 }), viewRow({ t2: 0 }), viewRow({ t2: 'x' })];
    expect(deskLatestBranchView(records)).toEqual(latestBranchView(records));
    expect(deskLatestBranchView(records)).toEqual({ t1: 2 });
  });

  test('a multi-take point groups its takes, viewed = latest by default', () => {
    const entries = foldForDisplay([
      user('q1', { turnId: 't1' }),
      take('t1', 1, 'a1'),
      take('t1', 2, 'a2'),
    ]);
    expect(entries).toEqual([
      { kind: 'user', record: user('q1', { turnId: 't1' }) },
      { kind: 'takes', turnId: 't1', takes: [take('t1', 1, 'a1'), take('t1', 2, 'a2')], viewed: 2 },
    ]);
  });

  test('the viewed take honors the branch view and clamps a nonexistent one — never nothing', () => {
    const records = [
      take('t1', 1, 'a1'), take('t1', 2, 'a2'),
      viewRow({ t1: 1 }),
    ];
    expect(foldForDisplay(records)[0].viewed).toBe(1);
    expect(foldForDisplay(records, { t1: 9 })[0].viewed).toBe(2);
    // …and the engine's fold of the same records shows the same take.
    expect(foldBranchView(records).map((r) => r.content)).toEqual(['a1', undefined]);
  });

  test('a duplicated user row of one point folds to one ask; orphan takes still group', () => {
    const entries = foldForDisplay([
      user('q1', { turnId: 't1' }),
      take('t1', 1, 'a1'),
      user('q1', { turnId: 't1' }),
      take('t1', 2, 'a2'),
    ]);
    expect(entries.filter((e) => e.kind === 'user')).toHaveLength(1);
    expect(entries.filter((e) => e.kind === 'takes')[0].takes).toHaveLength(2);
    expect(foldForDisplay([take('t9', 1, 'x'), take('t9', 2, 'y')]))
      .toEqual([{ kind: 'takes', turnId: 't9', takes: [take('t9', 1, 'x'), take('t9', 2, 'y')], viewed: 2 }]);
  });

  test('legacy rows and system rows pass through as other — the consumer decides', () => {
    const entries = foldForDisplay([user('q'), legacyAnswer('a'), summaryRow(), null]);
    expect(entries.map((e) => e.kind)).toEqual(['other', 'other', 'other', 'other']);
  });

  test('THE EDIT-FORK — the desk fold shows the VIEWED take\'s revised ask, like the engine', () => {
    const records = [
      user('first asking', { turnId: 't1' }),
      take('t1', 1, 'a1'),
      take('t1', 2, 'a2', { ask: 'revised asking' }),
    ];
    // Viewing the revised take (latest by default): the user entry carries
    // the revised asking — and the engine's fold of the same records agrees.
    const entries = foldForDisplay(records);
    expect(entries[0]).toEqual({ kind: 'user', record: user('revised asking', { turnId: 't1' }) });
    expect(foldBranchView(records).map((r) => r.content)).toEqual(['revised asking', 'a2']);
    // The record itself is never mutated — the fold answers a copy.
    expect(records[0].content).toBe('first asking');
    // …and viewing take 1 shows the FIRST asking again, on both folds.
    expect(foldForDisplay(records, { t1: 1 })[0].record.content).toBe('first asking');
    expect(foldBranchView(records, { t1: 1 }).map((r) => r.content)).toEqual(['first asking', 'a1']);
  });

  test('a take without an ask leaves the point\'s asking on the user entry; a non-viewed take\'s ask never leaks', () => {
    const plain = [
      user('first asking', { turnId: 't1' }),
      take('t1', 1, 'a1'),
      take('t1', 2, 'a2'), // a plain retry — no revised words
    ];
    expect(foldForDisplay(plain)[0].record.content).toBe('first asking');
    const records = [
      user('first asking', { turnId: 't1' }),
      take('t1', 1, 'a1', { ask: 'earlier revision' }),
      take('t1', 2, 'a2'),
    ];
    // Viewing take 1 shows ITS ask; the default (take 2, no ask) shows the record.
    expect(foldForDisplay(records, { t1: 1 })[0].record.content).toBe('earlier revision');
    expect(foldForDisplay(records)[0].record.content).toBe('first asking');
    // An unanswered point (orphan takes grouped, no user row) folds unchanged.
    expect(foldForDisplay([take('t9', 1, 'x', { ask: 'orphan words' })]))
      .toEqual([{ kind: 'takes', turnId: 't9', takes: [take('t9', 1, 'x', { ask: 'orphan words' })], viewed: 1 }]);
  });
});
