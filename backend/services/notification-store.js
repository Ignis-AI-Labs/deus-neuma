/**
 * NOTIFICATION STORE — what happened while the operator was not looking, kept.
 *
 * One append-only `.jsonl` per operator, in the operator's own realm, beside
 * their chats. The tray's whole claim is […], and an account that vanishes on restart
 * is not an account.
 *
 * ── WHY THE REALM AND NOT PlatformDB ────────────────────────────────────────
 *
 * PlatformDB would give indexes and ordering for free. It also has no migration
 * mechanism at all — its schema is one static DDL string applied with `exec` —
 * and it degrades to a silent no-op driver when the native binding cannot load,
 * which happens when `better-sqlite3` was built for a different ABI. That
 * combination is uniquely bad here: a wrong-ABI packaged build would boot
 * healthy, render a working tray, and keep NOTHING, while every test passed on
 * the developer's machine.
 *
 * A per-wallet JSONL file has neither failure mode, matches how chats are
 * already stored, and is provable against a real temp dir with no mock at all.
 *
 * ── WHY THE READER IS TOLERANT ──────────────────────────────────────────────
 *
 * `appendFile` gives an atomic OFFSET, not an atomic write: a crash mid-write
 * leaves a torn final line. And the realm root is shared — a dev backend on one
 * port and a packaged NEUMA on another append to the SAME file. A reader that
 * did `JSON.parse` over `split('\n')` would throw on that one bad line and the
 * whole tray would come up empty, turning a cosmetic tear into total loss.
 *
 * So every line is parsed independently, bad ones are counted and skipped, and
 * the count is logged. Skipping is silent to the operator but never silent to
 * the log — a store quietly dropping records is exactly the failure this
 * feature cannot afford.
 *
 * ── WHY THERE IS NO COMPACTION HERE ─────────────────────────────────────────
 *
 * Retention is a READ-side window: the tray asks for the last N and the file
 * keeps growing. That is deliberate for this commit.
 *
 * Compaction rewrites the file, and the atomic-rename that makes a rewrite safe
 * REPLACES THE INODE — so any append landing between the read and the rename is
 * lost, silently. It also cannot be undone. It ships as its own later commit,
 * running only at backend boot before any socket is accepted (single-writer by
 * construction), so that the writer and the pruner can be reverted separately.
 * Ship the thing that only adds before the thing that removes.
 *
 * ── WHY READ STATE IS A RECORD, NOT A MUTATION ──────────────────────────────
 *
 * Marking a notification read appends a marker line rather than rewriting the
 * record. Append-only stays append-only, two desk windows marking the same card
 * cannot corrupt each other, and the fold happens on read. The cost is a longer
 * file, which the read window already bounds.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { walletDir } from './user-realm.js';
import { createLogger } from './logger.js';
import { validateRecord, compareRecords } from '../../core/runtime/notification-record.js';

const log = createLogger('Notifications');

/**
 * How many records the tray is given. The file keeps everything; this bounds
 * what is read, parsed, and shipped over the socket on every desk open.
 */
export const READ_WINDOW = 200;

/**
 * How much of the tail to read off disk.
 *
 * Deliberately larger than READ_WINDOW: read markers live in the same file and
 * consume lines, so a window of exactly 200 lines could return fewer than 200
 * records. Reading a wider tail and then trimming is the cheap, correct order.
 */
const TAIL_LINES = READ_WINDOW * 6;

/** Marker written when the operator reads a card. */
const READ_MARKER = 'read';

/** The operator's notification log. Reuses the realm's own traversal guard. */
export const notificationPath = (wallet) => {
  const dir = path.resolve(walletDir(wallet), 'notifications');
  const resolved = path.resolve(dir, 'notifications.jsonl');
  if (!resolved.startsWith(dir + path.sep)) throw new Error('Path traversal denied');
  return resolved;
};

/**
 * Append one validated record.
 *
 * Rejects an invalid record rather than writing it: this file is append-only on
 * the operator's own disk, so a malformed line is permanent. Validating at the
 * write boundary is the only place it is still cheap.
 *
 * A failed write is logged and rethrown — never swallowed. The feature's claim
 * is that history survives; a silent write failure makes that claim false while
 * the tray still looks correct.
 *
 * impure
 * @param {string} wallet
 * @param {object} record - a record from `makeRecord`
 * @returns {Promise<object>} the record that was written
 */
export const appendNotification = async (wallet, record) => {
  const { ok, errors } = validateRecord(record);
  if (!ok) {
    const message = `Refusing to store a malformed notification: ${errors.join('; ')}`;
    log.error(message, { id: record?.id, kind: record?.kind });
    throw new Error(message);
  }
  const file = notificationPath(wallet);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // One record, one line, one write. Never batch several records into a single
    // appendFile call: a torn multi-record write loses more than the tear.
    await fs.appendFile(file, `${JSON.stringify(record)}\n`);
  } catch (error) {
    log.error('Notification append failed', { error: error.message, id: record.id });
    throw error;
  }
  return record;
};

/**
 * Append a read marker for one or more ids.
 *
 * Ids are validated by the caller at the WS boundary; this only refuses an
 * empty set so a stray call cannot write a meaningless line.
 *
 * impure
 */
export const markNotificationsRead = async (wallet, ids, nowMs) => {
  const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === 'string' && id !== '');
  if (list.length === 0) return 0;
  const file = notificationPath(wallet);
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const ts = Number.isFinite(nowMs) ? Math.floor(nowMs) : 0;
    await fs.appendFile(file, `${JSON.stringify({ marker: READ_MARKER, ids: list, ts })}\n`);
  } catch (error) {
    log.error('Notification read-marker append failed', { error: error.message, count: list.length });
    throw error;
  }
  return list.length;
};

/**
 * Read the operator's recent notifications, newest first, with read state folded in.
 *
 * Never throws on a damaged file. A missing file is an empty list — an operator
 * who has never been notified is not an error.
 *
 * impure
 * @param {string} wallet
 * @param {{limit?: number}} [options]
 * @returns {Promise<{records: object[], unread: number, skipped: number}>}
 */
export const readNotifications = async (wallet, { limit = READ_WINDOW } = {}) => {
  const file = notificationPath(wallet);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { records: [], unread: 0, skipped: 0 };
    log.error('Notification read failed', { error: error.message });
    return { records: [], unread: 0, skipped: 0 };
  }

  const lines = raw.split('\n').filter((line) => line !== '');
  const tail = lines.length > TAIL_LINES ? lines.slice(-TAIL_LINES) : lines;

  const byId = new Map();
  const readIds = new Set();
  let skipped = 0;

  for (const line of tail) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      // A torn final line, or a line from a build that wrote something else.
      // Counted, never fatal.
      skipped += 1;
      continue;
    }
    if (parsed?.marker === READ_MARKER) {
      for (const id of Array.isArray(parsed.ids) ? parsed.ids : []) readIds.add(id);
      continue;
    }
    // An unknown schema version is skipped rather than guessed at — the whole
    // point of stamping `v` on record one.
    if (!validateRecord(parsed).ok) {
      skipped += 1;
      continue;
    }
    byId.set(parsed.id, parsed);
  }

  if (skipped > 0) {
    log.warn('Skipped unreadable notification lines', { skipped, file });
  }

  const records = [...byId.values()]
    .sort(compareRecords)
    .slice(0, Math.max(0, limit))
    .map((rec) => Object.freeze({ ...rec, read: readIds.has(rec.id) }));

  return {
    records,
    unread: records.filter((rec) => !rec.read).length,
    skipped,
  };
};
