// branch-view.js — THE TAKES: the session fold (pure).
//
// Design note, 2026-07-27: […]
//
// The record law: a user row OPENS a turn-point by minting a `turnId`; every
// assistant answer to it is a TAKE carrying `{ turnId, takeIndex }` (the
// first answer is take 1, RETRY appends take 2, 3…). Disk stays append-only
// — a superseded take is never erased (the same never-rewrite law as
// INTERRUPT_MARK). Which take is VIEWED is itself an append-only fact: a
// `{ role: 'system', branchView: { <turnId>: k } }` row; the latest such row
// wins per key, and a point with no view fact defaults to its latest take.
//
// This module is the ONE fold both prompt seams (neuma `_gatherMemories`,
// witness history build) and the desk's mirror
// (frontend/app/RelinkShell/branch-view.js) agree on — the chain the being
// reads and the chain the witness sees are the same fold of the same record.
// Legacy rows (no turnId — everything written before the takes law) fold as
// single-take turn-points, byte-identical to before.
//
// Everything here is pure: records in, view out. No IO, no clocks.

/** The branch-view marker shape: a system row whose payload is the view map. */
// pure
export const isBranchViewRow = (record) =>
  Boolean(record) && record.role === 'system'
  && record.branchView && typeof record.branchView === 'object'
  && !Array.isArray(record.branchView);

/**
 * A row that is ONLY a view fact — what the prompt tail and the resume display
 * leave out. A compaction summary also carries the region's branchView (so a
 * take switch made before the compaction still reads after it), but it is the
 * session's condensed speech and rides; isBranchViewRow stays true for it,
 * because latestBranchView reads the carried view through that predicate.
 */
// pure
export const isViewMarker = (record) => isBranchViewRow(record) && record.compacted !== true;

/**
 * The standing view: every branchView row folded in order, later rows winning
 * per key. Values that are not positive integers are ignored — a hand-edited
 * or future row must never name a take that cannot exist.
 * @param {Array<object>} records raw session rows
 * @returns {Object<string, number>} turnId -> viewed takeIndex ({} when none)
 */
// pure
export const latestBranchView = (records) => {
  const view = {};
  for (const record of Array.isArray(records) ? records : []) {
    if (!isBranchViewRow(record)) continue;
    for (const [turnId, takeIndex] of Object.entries(record.branchView)) {
      if (Number.isInteger(takeIndex) && takeIndex >= 1) view[turnId] = takeIndex;
    }
  }
  return view;
};

/**
 * How many takes each turn-point holds, keyed by turnId. Only points with at
 * least one take appear — a point whose answer never landed reads as 0.
 * @param {Array<object>} records raw session rows
 * @returns {Object<string, number>}
 */
// pure
export const takeCounts = (records) => {
  const counts = {};
  for (const record of Array.isArray(records) ? records : []) {
    if (record?.role !== 'assistant') continue;
    if (typeof record.turnId !== 'string' || !record.turnId) continue;
    counts[record.turnId] = (counts[record.turnId] || 0) + 1;
  }
  return counts;
};

// pure — a take's index, normalized: a take row missing its index reads as
// take 1 (the first answer predates indexing only in hand-built records).
const takeIndexOf = (record) =>
  (Number.isInteger(record.takeIndex) && record.takeIndex >= 1 ? record.takeIndex : 1);

// pure — the take indexes each point holds IN THIS SLICE, keyed by turnId.
// Present indexes, never a row count: a compaction can summarize take 1 away
// and keep take 2, and a count of 1 would then name a take that is not there.
const presentTakes = (records) => {
  const present = {};
  for (const record of records) {
    if (record?.role !== 'assistant') continue;
    if (typeof record.turnId !== 'string' || !record.turnId) continue;
    (present[record.turnId] ||= new Set()).add(takeIndexOf(record));
  }
  return present;
};

// pure — which take of a point the view shows: the named one when it is
// present, else the latest present (a view must never render nothing — the
// desk's fold shows a take in that case, so the engine's must too).
const viewedIndex = (turnId, present, branchView) => {
  const takes = present[turnId];
  if (!takes) return undefined;
  const named = branchView?.[turnId];
  return Number.isInteger(named) && takes.has(named) ? named : Math.max(...takes);
};

// pure — the REVISED asks on disk, keyed turnId -> takeIndex -> ask (THE
// EDIT-FORK, Design note, 2026-07-28: a take minted from revised words carries its
// ask beside turnId/takeIndex; the point's user row keeps the FIRST asking,
// append-only. The fold shows the viewed take's ask when it carries one.
const revisedAsks = (records) => {
  const asks = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (record?.role !== 'assistant') continue;
    if (typeof record.turnId !== 'string' || !record.turnId) continue;
    if (typeof record.ask !== 'string' || !record.ask) continue;
    if (!asks.has(record.turnId)) asks.set(record.turnId, new Map());
    asks.get(record.turnId).set(takeIndexOf(record), record.ask);
  }
  return asks;
};

/**
 * Fold the raw session record to the BRANCH VIEW: one row per turn-point —
 * the user row once plus the VIEWED take — everything else passing through
 * untouched (compaction summary rows, branch-view markers, any role the fold
 * does not know). The fold never rewrites; it drops what the view hides:
 *   - superseded takes of a point (kept on disk, out of the view),
 *   - a duplicated user row for a point that already has one (the pre-takes
 *     record: a bare re-send wrote the ask twice — the point keeps ONE ask).
 * The viewed take stands where the point's FIRST take stands, as on the desk
 * (frontend/app/RelinkShell/branch-view.js groups a point's takes there): a
 * retry of an earlier point appends its take at the end of the file, and the
 * being must read its chosen answer under its own ask, not after later turns.
 * Orphan takes (their user row fell outside a tail slice) still fold among
 * themselves: the view is a property of the take set, not of the slice.
 * @param {Array<object>} records raw session rows (any slice of them)
 * @param {Object<string, number>} [branchView] standing view; defaults to
 *   latestBranchView(records) — pass the full-file view when folding a slice.
 * @returns {Array<object>} the folded view, new array, records by reference
 */
// pure
export const foldBranchView = (records, branchView) => {
  const list = Array.isArray(records) ? records : [];
  const view = branchView || latestBranchView(list);
  const present = presentTakes(list);
  const asks = revisedAsks(list);
  const viewedTake = new Map();
  for (const record of list) {
    const turnId = record?.role === 'assistant' && typeof record.turnId === 'string' ? record.turnId : '';
    if (turnId && !viewedTake.has(turnId) && takeIndexOf(record) === viewedIndex(turnId, present, view)) {
      viewedTake.set(turnId, record);
    }
  }
  const seenTurns = new Set();
  const placedTurns = new Set();
  const out = [];
  for (const record of list) {
    if (!record || typeof record !== 'object') { out.push(record); continue; }
    if (isBranchViewRow(record)) { out.push(record); continue; }
    const turnId = typeof record.turnId === 'string' && record.turnId ? record.turnId : null;
    if (record.role === 'user' && turnId) {
      if (seenTurns.has(turnId)) continue; // the point was already asked — once
      seenTurns.add(turnId);
      // The point's displayed ask is the VIEWED take's revised ask when that
      // take carries one — the recorded first asking stands untouched on
      // disk; the view alone moves (a copy, never a mutation of the record).
      const revised = asks.get(turnId)?.get(viewedIndex(turnId, present, view));
      out.push(typeof revised === 'string' ? { ...record, content: revised } : record);
      continue;
    }
    if (record.role === 'assistant' && turnId) {
      seenTurns.add(turnId);
      if (placedTurns.has(turnId)) continue;
      placedTurns.add(turnId);
      out.push(viewedTake.get(turnId));
      continue;
    }
    out.push(record);
  }
  return out;
};

/**
 * The fold-count of ANSWERED turn-points — the number sessionMsgCount and
 * the compaction triggers mean when they say "exchanges". Takes share their
 * point: a retried exchange is still ONE. Assistant-side by construction
 * (an unanswered ask counted as nothing before the takes law and still does);
 * assistant rows without a turnId (legacy, council, hand-written) count one
 * each, exactly as they always have.
 * @param {Array<object>} records raw session rows
 * @returns {number}
 */
// pure
export const turnPointCount = (records) => {
  const seen = new Set();
  let count = 0;
  for (const record of Array.isArray(records) ? records : []) {
    if (record?.role !== 'assistant') continue;
    const turnId = typeof record.turnId === 'string' && record.turnId ? record.turnId : null;
    if (!turnId) { count += 1; continue; }
    if (seen.has(turnId)) continue;
    seen.add(turnId);
    count += 1;
  }
  return count;
};

/**
 * Locate the user row a retry runs against. A `turnId` names its point
 * directly; a legacy row (pre-takes record, no turnId) is anchored by the
 * content+timestamp pair the desk still holds for it. Never throws — no
 * matching row answers null and the caller refuses the retry out loud.
 * @param {Array<object>} records raw session rows
 * @param {{turnId?: string, content?: string, timestamp?: string}} anchor
 * @returns {object|null} the user row, by reference
 */
// pure
export const findTurnUserRow = (records, { turnId, content, timestamp } = {}) => {
  const list = Array.isArray(records) ? records : [];
  if (typeof turnId === 'string' && turnId) {
    return list.find((r) => r?.role === 'user' && r.turnId === turnId) || null;
  }
  if (typeof content === 'string') {
    return list.find((r) => r?.role === 'user' && !r.turnId
      && r.content === content
      && (typeof timestamp !== 'string' || r.timestamp === timestamp)) || null;
  }
  return null;
};
