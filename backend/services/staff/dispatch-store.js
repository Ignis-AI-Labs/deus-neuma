// dispatch-store.js — the Optio's charge drawer, STRUCTURED.
//
// The office scaffold seeded staff/dispatches/ as a drawer and a playbook
// paragraph; the seated Optio's own report (2026-09-15) named the gap: a
// charge was freehand markdown, invisible to the desk, the board, and the
// office's own tooling. This store makes each charge a record so dispatch
// becomes a closed loop — filed, delivered, tracked, closed.
//
// One file per charge in the officer lane's sovereign workspace
// (staff/dispatches/<id>.json), atomic tmp+rename (the realm-writer law),
// exclusive-create ids with an ordinal suffix on a same-instant collision
// (the team-run-store scheme). Provenance rides every record (`by` = the
// operator wallet whose house ground the delivery post rode) — the status
// sweep needs the house root without a connection in hand.
//
// The WRITER law: only the seated officer's lane (through the staff/*
// intents) and the platform's own status sweep (the office's clerk, which
// stamps lastCheckedAt) write here. A seat's reply is house post EVIDENCE —
// it never moves a charge by itself.

import fs from 'fs/promises';
import path from 'path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { readNewPosts, readInboxLines } from '../house-post.js';
import { signalWake } from '../house-clock/wake-signal.js';

const LANE_ID = /^[a-z0-9][a-z0-9-]*$/;
const CHARGE_ID = /^[a-zA-Z0-9_-]+$/;

export const DISPATCH_TITLE_MAX = 120;
export const DISPATCH_BODY_MAX = 2000;
export const DISPATCH_NOTE_MAX = 500;

/** The charge lifecycle. Pure constant.
 *
 *  Open: dispatched → received → working (progress states a seat's ack may
 *  move through — the CoS audit's G3: `house/post` was fire-and-forget, and a
 *  manager who cannot see a dispatch land is coordinating blind). Terminal:
 *  done / blocked / withdrawn — frozen once landed; only an open charge moves.
 */
export const DISPATCH_STATUSES = Object.freeze([
  'dispatched', 'received', 'working', 'done', 'blocked', 'withdrawn',
]);
export const OPEN_DISPATCH_STATUSES = Object.freeze(['dispatched', 'received', 'working']);
export const TERMINAL_DISPATCH_STATUSES = Object.freeze(['done', 'blocked', 'withdrawn']);

// ISO-stamp → filesystem-safe id, plus an ordinal when two charges land on
// the same millisecond (never overwrite — the team-run-store law).
const idFromFiledAt = (filedAt) => String(filedAt).replace(/[:.]/g, '-');

/**
 * Compose one validated charge. Pure — throws on unlawful shape, never
 * normalizes silently (the officer resolves it).
 * @param {{from: string, to: string, title: string, body: string, filedAt: string,
 *   dueAt?: string|null, by: string, postId?: string|null, boardId?: string|null}} p
 * @returns {{v: 1, id: string, from: string, to: string, title: string, body: string,
 *   filedAt: string, dueAt: string|null, by: string, postId: string|null,
 *   boardId: string|null, status: 'dispatched', ackAt: null, ackBy: null,
 *   doneAt: null, note: '', lastCheckedAt: null}}
 */
export const makeCharge = (p) => {
  const from = typeof p?.from === 'string' ? p.from.trim() : '';
  const to = typeof p?.to === 'string' ? p.to.trim() : '';
  if (!LANE_ID.test(from)) throw new Error(`sender "${from}" is not a lawful lane id`);
  if (!LANE_ID.test(to)) throw new Error(`recipient "${to}" is not a lawful lane id`);
  if (from === to) throw new Error('a charge to the office itself is a note — dispatch moves work to a seat');
  const title = typeof p?.title === 'string' ? p.title.trim() : '';
  if (!title) throw new Error('a charge needs a title');
  if (title.length > DISPATCH_TITLE_MAX) throw new Error(`charge title exceeds ${DISPATCH_TITLE_MAX} chars`);
  const body = typeof p?.body === 'string' ? p.body.trim() : '';
  if (!body) throw new Error('a charge needs a body — say what done looks like');
  if (body.length > DISPATCH_BODY_MAX) throw new Error(`charge body exceeds ${DISPATCH_BODY_MAX} chars`);
  const filedMs = Date.parse(p?.filedAt);
  if (Number.isNaN(filedMs)) throw new Error('a charge needs a real filedAt timestamp');
  const filedAt = new Date(filedMs).toISOString();
  let dueAt = null;
  if (p?.dueAt != null) {
    const dueMs = Date.parse(p.dueAt);
    if (Number.isNaN(dueMs)) throw new Error('dueAt is not a real timestamp');
    dueAt = new Date(dueMs).toISOString();
    if (dueMs <= filedMs) throw new Error('dueAt must land after filedAt');
  }
  const by = typeof p?.by === 'string' ? p.by.trim() : '';
  if (!by) throw new Error('a charge carries the operator wallet (by) — it names whose house the work rides');
  return {
    v: 1,
    id: idFromFiledAt(filedAt),
    from, to, title, body, filedAt, dueAt, by,
    postId: typeof p?.postId === 'string' ? p.postId : null,
    boardId: typeof p?.boardId === 'string' ? p.boardId : null,
    status: 'dispatched',
    ackAt: null,
    ackBy: null,
    doneAt: null,
    note: '',
    lastCheckedAt: null,
  };
};

const chargePath = (laneId, id) => path.join(neumaWorkspace.pathFor(laneId), 'staff', 'dispatches', `${id}.json`);

/**
 * Land one charge record. Exclusive create — never overwrites; a same-id
 * collision gets an ordinal suffix. impure (fs).
 * @param {string} laneId - the officer lane (the drawer's owner)
 * @param {Object} charge - a makeCharge product (id pre-derived)
 * @returns {Promise<Object>} the landed record (id possibly suffixed)
 */
export const fileDispatch = async (laneId, charge) => {
  if (!charge || !CHARGE_ID.test(charge.id)) throw new Error(`not a lawful charge id: ${charge?.id}`);
  const dir = path.dirname(chargePath(laneId, charge.id));
  await fs.mkdir(dir, { recursive: true });
  for (let n = 1; ; n++) {
    const id = n === 1 ? charge.id : `${charge.id}-${n}`;
    try {
      const record = { ...charge, id };
      await fs.writeFile(chargePath(laneId, id), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
      // The seat holding the charge has work: the house clock may wake it.
      signalWake({ seat: record.to, reason: 'dispatch', ref: id, detail: { from: record.from, title: record.title } });
      return record;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
};

/** One charge record, or null when absent (a foreign id reads as absent). impure. */
export const readDispatch = async (laneId, id) => {
  if (!CHARGE_ID.test(String(id))) return null;
  try {
    return JSON.parse(await fs.readFile(chargePath(laneId, id), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

// The fields a status transition may move, and the closure stamp that rides
// every terminal state. Anything else in the patch is refused, not ignored —
// a silent no-op patch would read as success while changing nothing.
const applyPatch = (record, patch) => {
  const next = { ...record };
  if (patch.status !== undefined) {
    if (!DISPATCH_STATUSES.includes(patch.status)) {
      throw new Error(`"${patch.status}" is not a charge status — one of: ${DISPATCH_STATUSES.join(', ')}`);
    }
    if (TERMINAL_DISPATCH_STATUSES.includes(record.status)) {
      throw new Error(`charge ${record.id} is already ${record.status} — a closed charge does not move`);
    }
    next.status = patch.status;
    if (TERMINAL_DISPATCH_STATUSES.includes(patch.status)) next.doneAt = new Date().toISOString();
  }
  if (patch.note !== undefined) {
    const note = typeof patch.note === 'string' ? patch.note.trim() : '';
    if (note.length > DISPATCH_NOTE_MAX) throw new Error(`note exceeds ${DISPATCH_NOTE_MAX} chars`);
    next.note = note;
  }
  return next;
};

/**
 * Move one charge: a status transition and/or a note. impure (fs; tmp+rename).
 * Refuses a missing charge and an already-closed one.
 * @param {string} laneId
 * @param {string} id
 * @param {{status?: string, note?: string}} patch
 */
export const updateDispatch = async (laneId, id, patch) => {
  const existing = await readDispatch(laneId, id);
  if (!existing) throw new Error(`charge '${id}' has no record in the drawer`);
  const next = applyPatch(existing, patch || {});
  const file = chargePath(laneId, id);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
  await fs.rename(tmp, file);
  return next;
};

/**
 * The status sweep's clerk stamp — when the office last asked this seat where
 * the charge stands. Platform-internal; never touches status. impure.
 */
export const recordStatusCheck = async (laneId, id, at) => {
  const existing = await readDispatch(laneId, id);
  if (!existing) throw new Error(`charge '${id}' has no record in the drawer`);
  const file = chargePath(laneId, id);
  const next = { ...existing, lastCheckedAt: new Date(Date.parse(at)).toISOString() };
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
  await fs.rename(tmp, file);
  return next;
};

/**
 * A seat's ACK on its own charge (the CoS audit's G3): the evidence moves the
 * record. `by` must be the charge's holder (charge.to) or the officer
 * (charge.from) — anyone else reads as a foreign id, not a refusal with
 * details. When the holder acks, ackAt/ackBy stamp WHO answered and when;
 * when the dispatch carries a linked board entry (staff/dispatch files one),
 * the entry moves with the charge so the house board never disagrees with the
 * drawer. impure (fs; the board leg fails soft — the drawer is the truth).
 * @param {string} laneId - the officer lane (the drawer's owner)
 * @param {string} id
 * @param {{status?: string, note?: string}} patch
 * @param {string} by - the acking lane
 */
export const ackCharge = async (laneId, id, patch, by) => {
  const existing = await readDispatch(laneId, id);
  if (!existing) throw new Error(`charge '${id}' has no record in the drawer`);
  if (by !== existing.to && by !== existing.from) {
    throw new Error(`charge '${id}' belongs to ${existing.to} — only its holder or the office may ack it`);
  }
  const applied = applyPatch(existing, patch || {});
  const holderAcked = by === existing.to;
  const next = {
    ...applied,
    ...(holderAcked ? { ackAt: new Date().toISOString(), ackBy: by } : {}),
  };
  const file = chargePath(laneId, id);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
  await fs.rename(tmp, file);
  if (next.boardId) {
    try {
      const { loadHouseWorkspace } = await import('../house-workspace.js');
      const { root } = await loadHouseWorkspace(next.by);
      if (root) {
        const { updateEntry, BOARD_STATUS_OF } = await import('./board-store.js');
        await updateEntry(root, next.boardId, {
          ...(patch.status !== undefined ? { status: BOARD_STATUS_OF[patch.status] } : {}),
          ...(patch.note !== undefined ? { note: patch.note } : {}),
        });
      }
    } catch {
      // The board leg is a mirror, never the truth — the drawer stands even
      // if the ground is unreachable this once.
    }
  }
  return next;
};

/**
 * The drawer as summaries — newest first, no bodies (the list says what is
 * owed and where it stands, not the whole charge). A missing drawer is the
 * ordinary case. impure.
 * @param {string} laneId
 * @returns {Promise<Object[]>}
 */
export const listDispatches = async (laneId) => {
  const dir = path.join(neumaWorkspace.pathFor(laneId), 'staff', 'dispatches');
  let names;
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const records = await Promise.all(names.map(async (n) => {
    try {
      const r = JSON.parse(await fs.readFile(path.join(dir, n), 'utf8'));
      return {
        id: r.id, title: r.title, to: r.to, status: r.status,
        filedAt: r.filedAt, dueAt: r.dueAt ?? null, doneAt: r.doneAt ?? null,
        note: r.note ?? '', lastCheckedAt: r.lastCheckedAt ?? null,
        boardId: r.boardId ?? null,
      };
    } catch {
      return null; // a corrupt file is skipped, never fabricated
    }
  }));
  return records.filter(Boolean).sort((a, b) => String(b.filedAt).localeCompare(String(a.filedAt)));
};

/**
 * Delivery state of one charge's post — a READ-ONLY fact on the house's
 * shared ground (the room sees every act; this reads it). Never throws, never
 * advances a cursor. impure.
 * @param {string} houseRoot - the house workspace root
 * @param {{to: string, postId: string|null}} charge
 * @returns {Promise<'unsent'|'waiting-unread'|'collected'>}
 */
export const deliveryOf = async (houseRoot, charge) => {
  if (!houseRoot || !charge?.to || !charge.postId) return 'unsent';
  try {
    const lines = await readInboxLines(houseRoot, charge.to);
    let present = false;
    for (const line of lines) {
      try {
        if (JSON.parse(line)?.id === charge.postId) { present = true; break; }
      } catch { /* a torn line is not evidence of anything */ }
    }
    if (!present) return 'unsent';
    const unread = await readNewPosts(houseRoot, charge.to);
    return unread.messages.some((m) => m.id === charge.postId) ? 'waiting-unread' : 'collected';
  } catch {
    return 'unsent';
  }
};
