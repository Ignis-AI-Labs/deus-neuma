// THE NETWORK LOG — what this machine was connected to, kept, and what in it is worth the operator's eye.
//
// Design note, 2026-11-22: […]
//
// The watch (network-watch.js) reads what is connected NOW. This keeps it: every few seconds the watch is read, and
// each connection that was not there a moment ago is written down once, with when it was first seen; when it is gone,
// that is written too, with how long it stood. So is every port that starts or stops listening beyond the machine.
// What never leaves the machine (loopback) is not kept: it is most of the table and none of the question.
//
// THE AUDIT reads the log for the things that answer […]:
//   CAME IN      a connection from outside this machine into a port here — each address the first time it is seen
//   OPENED       a port that began listening beyond this machine, and was not open when the log began
//   NO NAME      a connection to the internet whose program the system does not show (another user's, or root's)
//   BRIEF        something from outside that was there for one reading and gone the next
//   NEW PLACE    the platform's OWN process reaching an internet address it had never reached before
// It flags; it stops nothing. A reading every few seconds cannot see a connection that opened and closed between two
// readings: this is a watch of what stands, not a capture of every packet (that needs the kernel's own hooks and root).
// The log is this machine's, on its disk, private to the operator's user, and kept for RETENTION_DAYS.
// What is new between two readings, and the audit, are PURE; the store is impure.

import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataRoot } from '../data-root.js';
import { appendJsonLine, readJsonLines } from '../jsonl-append.js';
import { createWriteChain } from '../write-chain.js';

export const RETENTION_DAYS = 30;
export const BRIEF_SECONDS = 20;
const DAY = 86_400_000;
const serialize = createWriteChain();
export const logDir = () => path.join(getDataRoot(), 'network');
const fileOf = (day) => path.join(logDir(), `network-${day}.jsonl`);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** pure — one connection's or one open port's identity across readings. */
export const flowKey = (dir, r) => `${dir}|${r.proto}|${r.process ?? '?'}|${r.address}|${r.port}`;

/**
 * pure — a reading of the watch as the things worth keeping: what goes out and came in beyond this machine, and
 * what listens beyond it.
 * @returns {Map<string, object>} by flowKey
 */
export const standing = (net) => {
  const now = new Map();
  const add = (dir, r, place) => { if (place !== 'machine') now.set(flowKey(dir, r), { dir, proto: r.proto, process: r.process ?? null, pid: r.pid ?? null, address: r.address, port: r.port, place, ours: Boolean(r.ours), owner: r.owner ?? null }); };
  for (const r of net?.out ?? []) add('out', r, r.place);
  for (const r of net?.in ?? []) add('in', r, r.place);
  for (const l of net?.listening ?? []) add('open', l, l.reach);
  return now;
};

/**
 * pure — what changed between two readings.
 * @param {Map<string, object>} before - what stood, each with `since` (ms)
 * @param {Map<string, object>} now
 * @param {number} at - ms
 * @param {{baseline?: boolean}} [o] - the first reading after the watch began: what stands was there already, not new
 * @returns {{events: object[], next: Map<string, object>}}
 */
export const changes = (before, now, at, { baseline = false } = {}) => {
  const events = [];
  const next = new Map();
  const iso = new Date(at).toISOString();
  for (const [key, row] of now) {
    const held = before.get(key);
    next.set(key, { ...row, since: held?.since ?? at });
    if (!held) events.push({ type: 'seen', key, ...row, ...(baseline ? { baseline: true } : {}), at: iso });
  }
  for (const [key, row] of before) if (!now.has(key)) events.push({ type: 'gone', key, dir: row.dir, at: iso, seconds: Math.max(0, Math.round((at - row.since) / 1000)) });
  return { events, next };
};

/**
 * pure — the log as a history: one line a connection or open port, newest first, with how long it stood.
 * @param {object[]} events - oldest first
 */
export const historyOf = (events) => {
  const open = new Map();
  const rows = [];
  let lastAt = null;
  // The watch stopped (or began again after a stop nobody recorded): what stood is closed at the last moment it was known to stand.
  const closeAll = (at) => { for (const row of open.values()) { row.lastSeen = at; row.there = false; row.seconds = Math.max(0, Math.round((Date.parse(at) - Date.parse(row.firstSeen)) / 1000)); } open.clear(); };
  for (const e of events) {
    if (e?.type === 'seen') { const row = { key: e.key, dir: e.dir, proto: e.proto, process: e.process, pid: e.pid, address: e.address, port: e.port, place: e.place, ours: e.ours, owner: e.owner ?? null, baseline: e.baseline === true, firstSeen: e.at, lastSeen: null, seconds: null, there: true }; open.set(e.key, row); rows.push(row); }
    else if (e?.type === 'gone' && open.has(e.key)) { const row = open.get(e.key); row.lastSeen = e.at; row.seconds = e.seconds; row.there = false; open.delete(e.key); }
    else if (e?.type === 'stopped') closeAll(e.at);
    else if (e?.type === 'began' && open.size) closeAll(lastAt ?? e.at);
    if (e?.at) lastAt = e.at;
  }
  return rows.sort((a, b) => String(b.firstSeen).localeCompare(String(a.firstSeen)));
};

const WHAT = Object.freeze({
  in: (r) => `${r.address} connected IN to port ${r.port}${r.process ? ` (${r.process})` : ''} from ${r.place === 'internet' ? 'the internet' : r.place === 'tailnet' ? 'your tailnet' : 'your network'}`,
  open: (r) => `port ${r.port} began listening beyond this machine${r.process ? ` (${r.process})` : ' (program not shown)'}, bound to ${r.address}`,
  noName: (r) => `a program the system does not show connected OUT to ${r.address}:${r.port}`,
  brief: (r) => `${r.address} was connected IN to port ${r.port} for ${r.seconds} s and gone`,
  newPlace: (r) => `the platform's own ${r.process ?? 'process'} reached ${r.address}:${r.port} for the first time`,
});

/**
 * pure — what in the history is worth the operator's eye, newest first. Each address, port or place is named ONCE,
 * the first time it is seen, with how many times since.
 * @param {object[]} history - historyOf's rows
 * @returns {Array<{kind: string, weight: 'high'|'medium'|'low', what: string, at: string, times: number, key: string, row: object}>}
 */
export const auditOf = (history) => {
  const by = new Map();
  const note = (id, kind, weight, row) => { const f = by.get(id); if (f) { f.times += 1; if (row.firstSeen > f.lastAt) f.lastAt = row.firstSeen; } else by.set(id, { kind, weight, what: WHAT[kind](row), at: row.firstSeen, lastAt: row.firstSeen, times: 1, key: id, row }); };
  // Oldest first, so "the first time" is the first time.
  for (const r of [...history].sort((a, b) => String(a.firstSeen).localeCompare(String(b.firstSeen)))) {
    if (r.dir === 'in') {
      note(`in|${r.address}|${r.port}`, 'in', r.place === 'internet' ? 'high' : 'medium', r);
      if (!r.there && r.seconds != null && r.seconds <= BRIEF_SECONDS && r.place === 'internet') note(`brief|${r.address}|${r.port}`, 'brief', 'high', r);
    } else if (r.dir === 'open') {
      // Open when the watch began: it was there before anyone watched, and says nothing new.
      if (r.baseline) continue;
      note(`open|${r.proto}|${r.port}`, 'open', r.place === 'any' || r.place === 'internet' ? 'high' : 'medium', r);
    } else if (r.dir === 'out' && r.place === 'internet') {
      if (!r.process) note(`noname|${r.address}|${r.port}`, 'noName', 'medium', r);
      else if (r.ours) note(`new|${r.address}`, 'newPlace', 'low', r);
    }
  }
  const order = { high: 0, medium: 1, low: 2 };
  return [...by.values()].sort((a, b) => order[a.weight] - order[b.weight] || String(b.lastAt).localeCompare(String(a.lastAt)));
};

/** Keep what changed. Never throws to its caller's caller: a log that will not write never stops the watch. */
export const keepEvents = (events, at = Date.now()) => serialize(async () => {
  if (!events.length) return;
  await fs.mkdir(logDir(), { recursive: true, mode: 0o700 });
  for (const e of events) await appendJsonLine(fileOf(dayOf(at)), e);
  await fs.chmod(fileOf(dayOf(at)), 0o600).catch(() => {});
}).catch(() => {});

/** Every event kept, oldest first, for the last `days` days. */
export const readEvents = async ({ days = RETENTION_DAYS, now = Date.now() } = {}) => {
  const names = (await fs.readdir(logDir()).catch(() => [])).filter((n) => /^network-\d{4}-\d\d-\d\d\.jsonl$/.test(n)).sort();
  const from = dayOf(now - days * DAY);
  const out = [];
  for (const name of names.filter((n) => n.slice(8, 18) >= from)) out.push(...(await readJsonLines(path.join(logDir(), name)).catch(() => ({ records: [] }))).records);
  return out;
};

/** Drop the days past retention. Returns how many files went. */
export const prune = async (now = Date.now()) => {
  const from = dayOf(now - RETENTION_DAYS * DAY);
  const old = (await fs.readdir(logDir()).catch(() => [])).filter((n) => /^network-\d{4}-\d\d-\d\d\.jsonl$/.test(n) && n.slice(8, 18) < from);
  for (const name of old) await fs.rm(path.join(logDir(), name), { force: true });
  return old.length;
};

/**
 * The history and its audit, as the window reads them.
 * @returns {Promise<{since: ?string, kept: number, retentionDays: number, audit: object[], history: object[]}>}
 */
export const readNetworkHistory = async ({ now = Date.now() } = {}) => {
  const events = await readEvents({ now });
  const since = events[0]?.at ?? null;
  const history = historyOf(events);
  return { since, kept: history.length, retentionDays: RETENTION_DAYS, audit: auditOf(history), history };
};
