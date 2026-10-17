/**
 * THE WAKE LEDGER — one row per wake, append-only, per house (Founder,
 * 2026-10-16: […]). Every wake the house
 * took lands here: which seat, why, what for, when it was queued, when it
 * ran and ended, how it ended, the sitting it ran in (its transcript), the
 * acts it took (from the operator's act ledger), and anything it refused and
 * sent back to the operator.
 *
 * Metadata only, like the act ledger: the seat's words stay in its own lane,
 * under its own key; the row points at the sitting, it never copies it.
 *
 * `<realm>/<wallet>/house-clock/wakes.jsonl`. A torn tail line (a crash
 * mid-append) costs that line, never the ledger.
 *
 * impure — appends to and reads the operator's realm.
 */
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { walletDir } from '../user-realm.js';
import { readActs } from '../act-ledger.js';

/** The house clock's own room in the operator's realm. */
export const clockDir = (wallet) => path.join(walletDir(wallet), 'house-clock');
const ledgerFile = (wallet) => path.join(clockDir(wallet), 'wakes.jsonl');

export const LEDGER_PAGE_MAX = 200;

/**
 * The acts a seat took while its wake ran, as the operator's act ledger
 * recorded them. impure (reads the act ledger). Metadata only.
 * @param {string} seat
 * @param {string} startedAt - ISO
 * @param {string} endedAt - ISO
 * @returns {Promise<Array<{ts: string, tool: string, scope: ?string, decision: string, status: string}>>}
 */
export const actsDuring = async (seat, startedAt, endedAt) =>
  (await readActs({ since: startedAt, laneIds: [seat] }))
    .filter((a) => a.ts >= startedAt && a.ts <= endedAt)
    .map(({ ts, tool, scope, decision, status }) => ({ ts, tool, scope: scope ?? null, decision, status }));

// impure — every parsed line of an append-only file, oldest first; a missing
// file is empty, and a torn line costs only itself.
const readLines = async (file) => {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return raw.split('\n').filter((l) => l.trim()).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
};

/**
 * Append one wake's row. impure.
 * @param {string} wallet
 * @param {Object} row
 * @returns {Promise<Object>}
 */
export const appendWakeRow = async (wallet, row) => {
  await fs.mkdir(clockDir(wallet), { recursive: true });
  await fs.appendFile(ledgerFile(wallet), `${JSON.stringify({ v: 1, ...row })}\n`, 'utf8');
  return row;
};

/**
 * A page of the ledger, newest first, optionally only one seat's wakes or one
 * outcome's (the filter runs before the page, so `total` counts what matches).
 * impure.
 * @param {string} wallet
 * @param {{offset?: number, limit?: number, seat?: string, outcome?: string}} [page]
 * @returns {Promise<{rows: Object[], total: number}>}
 */
export const readWakeLedger = async (wallet, { offset = 0, limit = 50, seat = null, outcome = null } = {}) => {
  const rows = (await readLines(ledgerFile(wallet))).reverse()
    .filter((r) => (!seat || r.seat === seat) && (!outcome || r.outcome === outcome));
  const from = Math.max(0, Number.isInteger(offset) ? offset : 0);
  const size = Math.min(LEDGER_PAGE_MAX, Math.max(1, Number.isInteger(limit) ? limit : 50));
  return { rows: rows.slice(from, from + size), total: rows.length };
};

// ── THE OPERATOR'S ASKS — what a wake could not do without them ──────────────
// An act a wake was refused, or a plan it sent back, filed for the operator:
// nobody was at the desk to tap a card, and a wake never waits on one. Append-
// only (`asks.jsonl`), metadata only (the act, what it reached for, why it came
// back) — the seat's words stay in its sitting, which the ask names.

const asksFile = (wallet) => path.join(clockDir(wallet), 'asks.jsonl');

/**
 * File one ask for the operator. impure.
 * @param {string} wallet
 * @param {{wakeId: string, seat: string, kind: 'act'|'plan', tool?: string, planId?: string,
 *   scope?: ?string, why: string, sessionId?: ?string}} ask
 * @returns {Promise<Object>} the filed ask
 */
export const fileAsk = async (wallet, ask) => {
  const row = { v: 1, id: randomUUID(), status: 'open', at: new Date().toISOString(), ...ask };
  await fs.mkdir(clockDir(wallet), { recursive: true });
  await fs.appendFile(asksFile(wallet), `${JSON.stringify(row)}\n`, 'utf8');
  return row;
};

// The operator CLOSING an ask: they saw it and dealt with it (in the seat's
// sitting, or by deciding it should not happen). Closing is not approving —
// nothing runs, the refused act stays not taken. Its own append-only file, so
// the asks themselves are never rewritten; the first close of an ask stands.
const closedFile = (wallet) => path.join(clockDir(wallet), 'asks-closed.jsonl');

export const ASK_NOTE_MAX = 280;

/** Every ask filed for the operator, newest first, closed ones marked. impure. */
export const readAsks = async (wallet) => {
  const [asks, closes] = await Promise.all([readLines(asksFile(wallet)), readLines(closedFile(wallet))]);
  const closed = new Map();
  for (const c of closes) if (!closed.has(c.askId)) closed.set(c.askId, c);
  return asks.map((ask) => {
    const c = closed.get(ask.id);
    return c ? { ...ask, status: 'closed', closedAt: c.at, closedBy: c.by, ...(c.note ? { closeNote: c.note } : {}) } : ask;
  }).reverse();
};

/**
 * The operator closes one ask. impure. Nothing runs.
 * @param {string} wallet
 * @param {{id: string, by: string, note?: string}} close
 * @returns {Promise<?Object>} the ask as it now stands, or null when this house filed no such ask
 */
export const closeAsk = async (wallet, { id, by, note }) => {
  const ask = (await readAsks(wallet)).find((a) => a.id === id);
  if (!ask || ask.status === 'closed') return ask ?? null;
  const text = typeof note === 'string' ? note.trim().slice(0, ASK_NOTE_MAX) : '';
  const row = { v: 1, askId: id, by: String(by || '').toLowerCase(), at: new Date().toISOString(), ...(text ? { note: text } : {}) };
  await fs.mkdir(clockDir(wallet), { recursive: true });
  await fs.appendFile(closedFile(wallet), `${JSON.stringify(row)}\n`, 'utf8');
  return { ...ask, status: 'closed', closedAt: row.at, closedBy: row.by, ...(text ? { closeNote: text } : {}) };
};
