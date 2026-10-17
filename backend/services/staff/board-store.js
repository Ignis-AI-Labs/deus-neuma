// board-store.js — THE HOUSE TASK BOARD, on the house's shared ground.
//
// The seated CoS's audit (2026-09-15) named the biggest gap: no house-level
// ledger — each seat's work lived in its own sovereign head, so […] was unanswerable in one call. The board is the answer,
// and its law matters: entries are AUTHORED by seats onto the shared ground —
// the same trust plane as house post, plaintext by design, the room sees
// every act. The platform never scrapes a sovereign ledger to build it;
// visibility comes from authorship, not extraction.
//
// One record per entry at <houseRoot>/board/<id>.json, exclusive-create ids
// with an ordinal on collision, atomic tmp+rename — the dispatch-store
// scheme. Owner and updatedAt ride every record from birth (audit G7): a
// quiet entry with an old updatedAt is an orphan the fold surfaces.

import fs from 'fs/promises';
import path from 'path';

const LANE_ID = /^[a-z0-9][a-z0-9-]*$/;
const ENTRY_ID = /^[a-zA-Z0-9_-]+$/;

export const BOARD_TITLE_MAX = 120;
export const BOARD_NOTE_MAX = 500;

/** A task's life: two live states, three settlements. Pure constant. */
export const BOARD_STATUSES = Object.freeze(['open', 'working', 'done', 'blocked', 'withdrawn']);
export const OPEN_BOARD_STATUSES = Object.freeze(['open', 'working']);
export const FROZEN_BOARD_STATUSES = Object.freeze(['done', 'withdrawn']);

/** Drawer status → board status (ackCharge's mirror law). Pure constant. */
export const BOARD_STATUS_OF = Object.freeze({
  dispatched: 'open',
  received: 'open',
  working: 'working',
  done: 'done',
  blocked: 'blocked',
  withdrawn: 'withdrawn',
});

/** An open entry untouched this long reads as STALE — the fold flags it. */
export const BOARD_STALE_MS = 7 * 24 * 60 * 60 * 1000;

const boardDir = (houseRoot) => path.join(houseRoot, 'board');
const entryPath = (houseRoot, id) => path.join(boardDir(houseRoot), `${id}.json`);

/**
 * Compose one validated board entry. Pure — throws on unlawful shape, never
 * normalizes silently (the filing seat resolves it).
 * @param {{owner: string, filedBy: string, title: string, filedAt: string,
 *   blockedBy?: string|null, note?: string}} p
 * @returns {{v: 1, id: string, owner: string, filedBy: string, title: string,
 *   status: 'open', blockedBy: string|null, note: string, filedAt: string,
 *   updatedAt: string}}
 */
export const makeEntry = (p) => {
  const owner = typeof p?.owner === 'string' ? p.owner.trim() : '';
  const filedBy = typeof p?.filedBy === 'string' ? p.filedBy.trim() : '';
  if (!LANE_ID.test(owner)) throw new Error(`owner "${owner}" is not a lawful lane id`);
  if (!LANE_ID.test(filedBy)) throw new Error(`filer "${filedBy}" is not a lawful lane id`);
  const title = typeof p?.title === 'string' ? p.title.trim() : '';
  if (!title) throw new Error('a board entry needs a title');
  if (title.length > BOARD_TITLE_MAX) throw new Error(`entry title exceeds ${BOARD_TITLE_MAX} chars`);
  const filedMs = Date.parse(p?.filedAt);
  if (Number.isNaN(filedMs)) throw new Error('a board entry needs a real filedAt timestamp');
  let blockedBy = null;
  if (p?.blockedBy != null) {
    blockedBy = String(p.blockedBy).trim();
    if (!ENTRY_ID.test(blockedBy)) throw new Error(`blockedBy "${blockedBy}" is not a lawful entry id`);
  }
  const note = typeof p?.note === 'string' ? p.note.trim().slice(0, BOARD_NOTE_MAX) : '';
  const iso = new Date(filedMs).toISOString();
  return {
    v: 1,
    id: iso.replace(/[:.]/g, '-'),
    owner,
    filedBy,
    title,
    status: 'open',
    blockedBy,
    note,
    filedAt: iso,
    updatedAt: iso,
  };
};

/**
 * Land one entry. Exclusive create — never overwrites; a same-instant
 * collision gets an ordinal suffix. impure (fs).
 * @param {string} houseRoot
 * @param {Object} entry - a makeEntry product (id pre-derived)
 * @returns {Promise<Object>} the landed record (id possibly suffixed)
 */
export const fileEntry = async (houseRoot, entry) => {
  if (!entry || !ENTRY_ID.test(entry.id)) throw new Error(`not a lawful entry id: ${entry?.id}`);
  if (!houseRoot) throw new Error('the board needs the house ground — no root, no board');
  await fs.mkdir(boardDir(houseRoot), { recursive: true });
  for (let n = 1; ; n++) {
    const id = n === 1 ? entry.id : `${entry.id}-${n}`;
    try {
      const record = { ...entry, id };
      await fs.writeFile(entryPath(houseRoot, id), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
      return record;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
};

/** One entry, or null when absent. impure. */
export const readEntry = async (houseRoot, id) => {
  if (!houseRoot || !ENTRY_ID.test(String(id))) return null;
  try {
    return JSON.parse(await fs.readFile(entryPath(houseRoot, id), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

/**
 * Move one entry: status transition and/or note/blockedBy. The OWNER-or-Optio
 * check lives at the intent layer (it knows the connection); this lands the
 * truth. impure (fs; tmp+rename). Terminal states do not move.
 * @param {string} houseRoot
 * @param {string} id
 * @param {{status?: string, note?: string, blockedBy?: string|null}} patch
 */
export const updateEntry = async (houseRoot, id, patch) => {
  const existing = await readEntry(houseRoot, id);
  if (!existing) throw new Error(`entry '${id}' is not on the board`);
  if (FROZEN_BOARD_STATUSES.includes(existing.status)) {
    throw new Error(`entry '${id}' is already ${existing.status} — a settled entry does not move`);
  }
  const next = { ...existing };
  if (patch.status !== undefined) {
    if (!BOARD_STATUSES.includes(patch.status)) {
      throw new Error(`"${patch.status}" is not a board status — one of: ${BOARD_STATUSES.join(', ')}`);
    }
    next.status = patch.status;
  }
  if (patch.blockedBy !== undefined) {
    if (patch.blockedBy !== null && !ENTRY_ID.test(String(patch.blockedBy))) {
      throw new Error(`blockedBy "${patch.blockedBy}" is not a lawful entry id`);
    }
    next.blockedBy = patch.blockedBy;
  }
  if (patch.note !== undefined) {
    const note = typeof patch.note === 'string' ? patch.note.trim() : '';
    if (note.length > BOARD_NOTE_MAX) throw new Error(`note exceeds ${BOARD_NOTE_MAX} chars`);
    next.note = note;
  }
  next.updatedAt = new Date().toISOString();
  const file = entryPath(houseRoot, id);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
  await fs.rename(tmp, file);
  return next;
};

/**
 * The board as summaries — OPEN first (oldest update first, the work that has
 * waited longest), then settled by recency. A missing board is the ordinary
 * case. impure.
 * @param {string} houseRoot
 * @returns {Promise<Object[]>}
 */
export const listEntries = async (houseRoot) => {
  let names;
  try {
    names = (await fs.readdir(boardDir(houseRoot))).filter((n) => n.endsWith('.json'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const records = await Promise.all(names.map(async (n) => {
    try {
      const r = JSON.parse(await fs.readFile(path.join(boardDir(houseRoot), n), 'utf8'));
      return {
        id: r.id, title: r.title, owner: r.owner, filedBy: r.filedBy,
        status: r.status, blockedBy: r.blockedBy ?? null, note: r.note ?? '',
        filedAt: r.filedAt, updatedAt: r.updatedAt ?? r.filedAt,
      };
    } catch {
      return null; // a corrupt file is skipped, never fabricated
    }
  }));
  const live = records.filter((r) => r && OPEN_BOARD_STATUSES.includes(r.status))
    .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
  const settled = records.filter((r) => r && !OPEN_BOARD_STATUSES.includes(r.status))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return [...live, ...settled];
};
