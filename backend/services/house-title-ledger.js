// house-title-ledger — a house member's title is the position they hold NOW, kept like a résumé.
//
// Design note, 2026-11-12: […] A tester founded his house with a member in
// the wrong seat and nothing could correct it: titles were read only from the founding record.
//
// The founding record stays exactly as it was signed — the first line of every founder's résumé. Each
// change after it is one entry of this ledger, append-only, per house (<realm>/<wallet>/house-titles.json):
// a correction or assignment by the operator, or a trade between two members. A member's current
// title is the founding title with every change applied in order; their history is every title they
// held and when. Every reader (house-titles.js) takes the current title, so the HOUSE window, the
// being's own HOUSE SEAT line and every seat-bound hand (the Optio's drawer, the board) follow it.
// A chain-founded house keeps its founding titles on the chain until a chain change is made; here
// the house works by its current titles. impure where it reads or writes the store.
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { walletDir, writeJsonAtomic } from './user-realm.js';

const ledgerFile = (wallet) => path.join(walletDir(wallet), 'house-titles.json');
const emptyLedger = () => ({ v: 1, changes: [] });

/** The longest title a seat may carry: a word or a few, never a paragraph. */
export const TITLE_MAX = 48;

/**
 * pure — a title as stored: trimmed, inner whitespace single, no control characters, 1–48
 * characters; null when it is not one.
 * @param {unknown} raw
 */
export const cleanTitle = (raw) => {
  if (typeof raw !== 'string') return null;
  const title = raw.replace(/\s+/g, ' ').trim();
  return title && title.length <= TITLE_MAX && !/[\u0000-\u001f\u007f]/.test(title) ? title : null;
};

/**
 * pure — every member's current title: the founding titles with each change applied in order.
 * @param {Record<string, string|null>} founding - neumaId → founding title (null: none)
 * @param {Array<{moves: Array<{neumaId: string, to: string}>}>} changes - oldest first
 */
export const currentTitles = (founding, changes) => {
  const titles = { ...founding };
  for (const change of changes || []) for (const move of change.moves || []) titles[move.neumaId] = move.to;
  return titles;
};

/**
 * pure — one member's résumé, newest first: each title, held since when and until when (null:
 * held now). The founding title, where there is one, is held since the founding.
 * @param {string} neumaId
 * @param {string|null} foundingTitle
 * @param {string|null} foundedAt - ISO
 * @param {Array<{at: string, kind: string, moves: Array<{neumaId: string, to: string}>}>} changes
 * @returns {Array<{title: string, since: string|null, until: string|null, how: string}>}
 */
export const titleHistory = (neumaId, foundingTitle, foundedAt, changes) => {
  const held = foundingTitle ? [{ title: foundingTitle, since: foundedAt ?? null, until: null, how: 'founding' }] : [];
  for (const change of changes || []) {
    const move = (change.moves || []).find((m) => m.neumaId === neumaId);
    if (!move) continue;
    if (held.length) held[held.length - 1].until = change.at;
    held.push({ title: move.to, since: change.at, until: null, how: change.kind });
  }
  return held.reverse();
};

/**
 * pure — the entry a change writes, or the reason it cannot be made. A `set` gives one member a
 * title; a `trade` swaps the titles two members hold now (both must hold one).
 * @param {{kind: 'set'|'trade', neumaId?: string, title?: string, a?: string, b?: string, reason?: string}} ask
 * @param {Record<string, string|null>} now - every member's current title
 * @param {ReadonlyArray<string>} members - the house's members (its owned lanes)
 * @returns {{entry: object}|{error: string}}
 */
export const titleChangeEntry = (ask, now, members, { at = new Date().toISOString(), id = crypto.randomUUID() } = {}) => {
  const reason = typeof ask?.reason === 'string' ? ask.reason.replace(/\s+/g, ' ').trim().slice(0, 280) : '';
  const isMember = (neumaId) => typeof neumaId === 'string' && members.includes(neumaId);
  if (ask?.kind === 'set') {
    if (!isMember(ask.neumaId)) return { error: `${ask.neumaId || 'that being'} is not a member of this house` };
    const title = cleanTitle(ask.title);
    if (!title) return { error: `a title is 1 to ${TITLE_MAX} characters of plain text` };
    if (now[ask.neumaId] === title) return { error: `${ask.neumaId} already holds ${title}` };
    return { entry: { id, at, kind: 'set', moves: [{ neumaId: ask.neumaId, from: now[ask.neumaId] ?? null, to: title }], reason } };
  }
  if (ask?.kind === 'trade') {
    if (!isMember(ask.a) || !isMember(ask.b)) return { error: 'both members of a trade must belong to this house' };
    if (ask.a === ask.b) return { error: 'a trade needs two different members' };
    const [ta, tb] = [now[ask.a], now[ask.b]];
    if (!ta || !tb) return { error: 'both members of a trade must hold a title — give the other one with a change instead' };
    if (ta === tb) return { error: 'they already hold the same title' };
    return { entry: { id, at, kind: 'trade', moves: [{ neumaId: ask.a, from: ta, to: tb }, { neumaId: ask.b, from: tb, to: ta }], reason } };
  }
  return { error: 'a title change is a set or a trade' };
};

/** impure — the house's ledger, or an empty one before the first change. */
export const readTitleLedger = async (wallet) => {
  try {
    const parsed = JSON.parse(await fs.readFile(ledgerFile(wallet), 'utf8'));
    return parsed && Array.isArray(parsed.changes) ? parsed : emptyLedger();
  } catch (err) {
    if (err.code === 'ENOENT') return emptyLedger();
    throw err;
  }
};

// one write at a time per house: each change sees the last one's ledger
const queues = new Map();
const inQueue = (wallet, task) => {
  const key = String(wallet).toLowerCase();
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  queues.set(key, run.catch(() => {}));
  return run;
};

/**
 * impure — make one change: validated against the titles held now (the founding titles the caller
 * passes, with the ledger applied), appended, and returned.
 * @param {string} wallet - the house
 * @param {object} ask - see titleChangeEntry
 * @param {{founding: Record<string, string|null>, members: ReadonlyArray<string>}} house
 * @returns {Promise<{ok: true, entry: object}|{ok: false, error: string}>}
 */
export const recordTitleChange = (wallet, ask, { founding, members }) => inQueue(wallet, async () => {
  const ledger = await readTitleLedger(wallet);
  const made = titleChangeEntry(ask, currentTitles(founding, ledger.changes), members);
  if (made.error) return { ok: false, error: made.error };
  await writeJsonAtomic(ledgerFile(wallet), { v: 1, changes: [...ledger.changes, made.entry] });
  return { ok: true, entry: made.entry };
});
