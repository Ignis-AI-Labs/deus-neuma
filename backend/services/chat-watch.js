/**
 * CHAT WATCHES — a chat keeps a lens on something long and is told when it
 * ends (Design note, 2026-10-15: […]).
 *
 * A watch belongs to ONE conversation (wallet, lane, session) and names what
 * it watches by kind + ref (kind 'bench', ref = the comparison id a
 * bench_run launched). When that thing settles, its producer fires the watch
 * with a report; the deliverer (portal-watch-delivery.js, set at boot) gives
 * the chat a NEW turn carrying the report, marked as the platform's watch —
 * never mid-turn (the turn ends where the being ends it — 7d99f6b11), never
 * dressed as the operator's words. A chat not open right now holds the fired
 * watch until it is next opened.
 *
 * The registry is kept on disk (data root, watches/watches.json) so a watch
 * outlives a desk restart; delivered watches are kept a day for the record.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDataRoot } from './data-root.js';
import { createLogger } from './logger.js';

const log = createLogger('ChatWatch');
const KEEP_DELIVERED_MS = 24 * 60 * 60 * 1000;

const watchFile = () => join(getDataRoot(), 'watches', 'watches.json');

// impure — the registry, read once and written through
let watches = null;
const load = async () => {
  if (watches) return watches;
  try {
    const parsed = JSON.parse(await readFile(watchFile(), 'utf8'));
    watches = Array.isArray(parsed?.watches) ? parsed.watches : [];
  } catch {
    watches = [];
  }
  return watches;
};
const save = async () => {
  const now = Date.now();
  watches = watches.filter((w) => !w.deliveredAt || now - Date.parse(w.deliveredAt) < KEEP_DELIVERED_MS);
  const file = watchFile();
  await mkdir(join(getDataRoot(), 'watches'), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify({ watches }, null, 1));
  await rename(`${file}.tmp`, file);
};

// impure — the boot wires the deliverer (route layer); none set = fired watches wait
let deliverer = null;
export const setWatchDeliverer = (fn) => { deliverer = fn; };

const attempt = (watch) => {
  if (!deliverer) return;
  Promise.resolve(deliverer(watch)).catch((err) => log.warn('watch delivery failed — held for the next opening', { id: watch.id, error: err?.message }));
};

/**
 * Arm a watch for this conversation. One per (session, kind, ref).
 * @param {{wallet: string, laneId: string, sessionId: string, kind: string, ref: string, label: string}} w
 * @returns {Promise<object|null>} the watch, or null when the chat has no session to be told in
 */
export const armWatch = async ({ wallet, laneId, sessionId, kind, ref, label }) => {
  if (!wallet || !laneId || !sessionId || !kind || !ref) return null;
  const all = await load();
  const same = all.find((w) => w.sessionId === sessionId && w.kind === kind && w.ref === ref && !w.deliveredAt);
  if (same) return same;
  const watch = { id: randomUUID(), wallet: wallet.toLowerCase(), laneId, sessionId, kind, ref, label: label || `${kind} ${ref}`, armedAt: new Date().toISOString() };
  all.push(watch);
  await save();
  log.info('watch armed', { kind, ref, laneId, sessionId });
  return watch;
};

/**
 * The watched thing settled: every watch on it fires with the report, and
 * each is offered to its chat now.
 * @returns {Promise<number>} watches fired
 */
export const fireWatches = async (kind, ref, report) => {
  const all = await load();
  const hit = all.filter((w) => w.kind === kind && w.ref === ref && !w.firedAt);
  if (!hit.length) return 0;
  const at = new Date().toISOString();
  for (const w of hit) Object.assign(w, { firedAt: at, report });
  await save();
  log.info('watch fired', { kind, ref, chats: hit.length });
  hit.forEach(attempt);
  return hit.length;
};

/** Fired, not yet delivered, for one conversation — the opening chat collects them. */
export const pendingFor = async ({ wallet, laneId, sessionId }) =>
  (await load()).filter((w) => w.firedAt && !w.deliveredAt && w.wallet === String(wallet || '').toLowerCase()
    && w.laneId === laneId && w.sessionId === sessionId);

/** Every armed watch not yet fired — what a chat (or the desk) is still watching. */
export const armedWatches = async (filter = {}) => (await load())
  .filter((w) => !w.firedAt && (!filter.laneId || w.laneId === filter.laneId));

/**
 * Claim a fired watch for delivery — SYNCHRONOUS, so the deliverer can claim
 * and start the chat's turn with no await between (a message landing in that
 * gap would start a second turn). The record is written behind it.
 * @returns {boolean} true when this caller took it
 */
export const claimWatch = (id) => {
  const w = (watches || []).find((x) => x.id === id);
  if (!w || !w.firedAt || w.deliveredAt) return false;
  w.deliveredAt = new Date().toISOString();
  save().catch((err) => log.warn('watch record write failed', { id, error: err?.message }));
  return true;
};

/** Offer every held watch of this conversation again (a chat just opened). */
export const offerPending = async (scope) => (await pendingFor(scope)).forEach(attempt);

/** Test seam: forget the in-memory registry so the next read is the disk's. */
export const __resetWatches = () => { watches = null; };
