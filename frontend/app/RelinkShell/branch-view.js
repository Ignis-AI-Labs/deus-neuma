// branch-view.js — THE TAKES: the desk's fold of the session record.
//
// Design note, 2026-07-27: […]
//
// A DELIBERATE MIRROR of core/workspace/branch-view.js — the two cannot
// literally share a module (this is the desk, that is the engine; the same
// situation orderQueueForBoard documents). The LAW is the same and both are
// tested against the same tables (test/unit/branch-view.test.js): disk stays
// append-only, the latest branchView row wins per key, a point with no view
// fact shows its latest take, and a view naming a take that does not exist
// clamps back to the latest rather than rendering nothing.
//
// Where the engine's fold answers […] (the
// prompt seams), this fold answers […]: take-aware
// entries, every take of a point kept TOGETHER so the ‹ k/N › switch is a
// local re-fold with no refetch. Pure: records in, entries out.

/**
 * The standing view: every `{ role: 'system', branchView }` row folded in
 * order, later rows winning per key; values that are not positive integers
 * are ignored. Mirrors the engine's latestBranchView.
 * @param {Array<object>} records raw session rows
 * @returns {Object<string, number>} turnId -> viewed takeIndex ({} when none)
 */
// pure
export const latestBranchView = (records) => {
  const view = {};
  for (const record of Array.isArray(records) ? records : []) {
    if (record?.role !== 'system' || !record.branchView || typeof record.branchView !== 'object'
        || Array.isArray(record.branchView)) continue;
    for (const [turnId, takeIndex] of Object.entries(record.branchView)) {
      if (Number.isInteger(takeIndex) && takeIndex >= 1) view[turnId] = takeIndex;
    }
  }
  return view;
};

/**
 * Fold raw session rows into display entries, in stream order:
 *   { kind: 'user',  record }                          a turn-point's ask (once)
 *   { kind: 'takes', turnId, takes: [record], viewed } a point's answers, viewed 1-based
 *   { kind: 'other', record }                          legacy rows, system rows, junk —
 *                                                      the consumer decides (today: drop)
 * A duplicated user row of one point (the pre-takes bare re-send record) is
 * dropped — the point was asked once. Orphan takes (their ask fell outside a
 * tail slice) still group: the point is a property of its takes.
 * @param {Array<object>} records raw session rows (any slice of them)
 * @param {Object<string, number>} [branchView] standing view; defaults to
 *   latestBranchView(records)
 * @returns {Array<object>}
 */
// pure
export const foldForDisplay = (records, branchView) => {
  const list = Array.isArray(records) ? records : [];
  const view = branchView || latestBranchView(list);
  const groupsByTurn = new Map();
  const seenTurns = new Set();
  const out = [];
  for (const record of list) {
    if (!record || typeof record !== 'object') { out.push({ kind: 'other', record }); continue; }
    const turnId = typeof record.turnId === 'string' && record.turnId ? record.turnId : null;
    if (record.role === 'user' && turnId) {
      if (seenTurns.has(turnId)) continue; // asked once
      seenTurns.add(turnId);
      out.push({ kind: 'user', record });
      continue;
    }
    if (record.role === 'assistant' && turnId) {
      seenTurns.add(turnId);
      let group = groupsByTurn.get(turnId);
      if (!group) {
        group = { kind: 'takes', turnId, takes: [], viewed: 1 };
        groupsByTurn.set(turnId, group);
        out.push(group);
      }
      group.takes.push(record);
      continue;
    }
    out.push({ kind: 'other', record });
  }
  for (const group of groupsByTurn.values()) {
    const named = view[group.turnId];
    group.viewed = Number.isInteger(named) && named >= 1 && named <= group.takes.length
      ? named
      : group.takes.length;
  }
  // THE EDIT-FORK (the engine's fold law, mirrored): the point's displayed
  // asking is the VIEWED take's revised ask when that take carries one — the
  // user record keeps the FIRST asking, append-only; the view alone moves.
  // A copy, never a mutation of the record.
  for (const entry of out) {
    if (entry.kind !== 'user') continue;
    const group = groupsByTurn.get(entry.record.turnId);
    if (!group) continue;
    const ask = group.takes[group.viewed - 1]?.ask;
    if (typeof ask === 'string' && ask) entry.record = { ...entry.record, content: ask };
  }
  return out;
};
