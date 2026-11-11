/**
 * User vitals — the witness's body log, kept in their realm beside chats and
 * tasks at:
 *   <realmRoot>/<wallet>/vitals.jsonl
 *
 * Append-only and plaintext: the witness's own readable record of their
 * vessel's maintenance. Writers are the witness (UI) and beings (vessel_log,
 * add-only). Shape, validation, and aggregates live in core/vessel/vitals.js
 * (pure); this is only the wallet-scoped IO and the append queue.
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { walletDir } from './user-realm.js';
import {
  appendEntry, prsByLift, bodyweightTrend, sessionsSummary, streakDays, markersToday,
} from '../../core/vessel/vitals.js';
import { dailiesTodayView, dailyStreakDays } from '../../core/vessel/dailies.js';

const vitalsFile = (wallet) => path.join(walletDir(wallet), 'vitals.jsonl');

/** Read the log (record order); a missing file is an empty log. */
// impure
export const readVitals = async (wallet, { limit } = {}) => {
  try {
    const raw = await fs.readFile(vitalsFile(wallet), 'utf8');
    const entries = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return limit ? entries.slice(-limit) : entries;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

// impure — per-wallet append queue: appends are
// read-free single lines, but racing appends must not interleave a write.
const appendQueues = new Map();
const withAppendQueue = (wallet, task) => {
  const key = String(wallet).toLowerCase();
  const tail = appendQueues.get(key) ?? Promise.resolve();
  const run = tail.then(task, task);
  appendQueues.set(key, run.catch(() => {}));
  return run;
};

/**
 * Append one validated entry to the witness's log. Validation corrections
 * from the pure module surface as thrown errors (the route maps them to 400s).
 * @returns {Promise<Object>} the stored entry
 */
// impure
export const appendVital = (wallet, args) => withAppendQueue(wallet, async () => {
  // The dailies lane needs the log in hand: a completion resolves against the
  // current definition, a new snapshot's fresh items get their ids minted
  // here (existing items keep theirs, so completions stay linked across
  // edits), and a rest-day claim is judged against the allowance and spacing
  // law of the day it claims. Every other kind stays the read-free
  // single-line append it was.
  const needsLog = args?.kind === 'daily' || args?.kind === 'dailies-set' || args?.kind === 'rest-day';
  const prior = needsLog ? await readVitals(wallet) : [];
  const shaped = args?.kind === 'dailies-set'
    ? {
      ...args,
      items: (Array.isArray(args?.items) ? args.items : []).map((item) => (
        typeof item?.id === 'string' && item.id.trim()
          ? item : { ...item, id: crypto.randomUUID() })),
    }
    : args;
  const { entry } = appendEntry(prior, shaped, { id: crypto.randomUUID(), now: new Date().toISOString() });
  const file = vitalsFile(wallet);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(entry) + '\n');
  return entry;
});

/**
 * The aggregates over the full log — PR board, bodyweight trend, sessions,
 * streak, today's markers.
 * @returns {Promise<Object>}
 */
// impure
export const vitalsSummary = async (wallet) => {
  const entries = await readVitals(wallet);
  const now = new Date().toISOString();
  const dailies = dailiesTodayView(entries, now);
  return {
    total: entries.length,
    prs: prsByLift(entries),
    bodyweight: bodyweightTrend(entries, now),
    sessions: sessionsSummary(entries, now),
    // With dailies defined the streak IS the all-dailies law (each day judged
    // by the definition in force that day; pre-dailies history keeps the
    // session law). Without them, the number is exactly what it always was.
    streakDays: dailies ? dailyStreakDays(entries, now) : streakDays(entries, now),
    markersToday: markersToday(entries, now),
    dailies,
  };
};
