// results-store — what the house's posts did, as read back from each
// platform by the stats sweep (campaign plan §3.1 Result, §4.3), kept per
// house: `<realm>/<wallet>/offices/marketing/post-results.json`.
//
//   results     [{entryId, accountId, channelId, postId, at, metrics, source}]
//               appended, never edited — a trend is the series, never a
//               maintained number; a metric not reported is ABSENT, never 0
//   pulls       entryId → when it was last read (the decaying schedule's clock)
//   backoff     key → {until, reason}: an account, or a whole app (`app:youtube`)
//   unavailable accountId → {reason, at}: what this access cannot read (shown as —)
//   spend       {youtube: {day, units}} — the shared project quota's daily use
//   links       {at, counts: [{code, kind, day, count}]} — the site counter's
//               aggregates for the house's own codes, as last read
//
// impure — disk.

import fs from 'fs/promises';
import { dirname } from 'path';
import { officeFile } from '../house-office.js';
import { withFileLock } from '../file-lock.js';
import { createWriteChain } from '../write-chain.js';

const FILE = 'post-results.json';
const PER_POST_KEPT = 64;
const chain = createWriteChain();

const empty = () => ({ v: 1, results: [], pulls: {}, backoff: {}, unavailable: {}, spend: {}, links: null });

/** The house's results file. */
export const resultsPath = (wallet) => officeFile(wallet, 'marketing', FILE);

/** The house's results, an empty record when none. impure. */
export const loadResults = async (wallet) => {
  let raw;
  try { raw = await fs.readFile(resultsPath(wallet), 'utf8'); } catch (err) { if (err.code === 'ENOENT') return empty(); throw err; }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.results)) throw new Error('results-store: not a results record');
  return { ...empty(), ...parsed };
};

// Keep each post's newest PER_POST_KEPT reads; the oldest fall away.
const capped = (results) => {
  const seen = new Map();
  const keep = [];
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const n = (seen.get(results[i].entryId) || 0) + 1;
    seen.set(results[i].entryId, n);
    if (n <= PER_POST_KEPT) keep.push(results[i]);
  }
  return keep.reverse();
};

/**
 * Change the house's record under its lock: fn(record) returns the next. impure.
 * @param {string} wallet
 * @param {(record: object) => object} fn
 */
export const changeResults = (wallet, fn) => {
  const file = resultsPath(wallet);
  return chain(() => withFileLock(`${file}.lock`, async () => {
    const next = fn(await loadResults(wallet));
    next.results = capped(next.results);
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    await fs.chmod(file, 0o600);
    return next;
  }));
};

/**
 * Each post's series, oldest first, and its latest read. Pure.
 * @param {object} record - loadResults output
 * @returns {Map<string, {series: object[], latest: object}>}
 */
export const seriesByPost = (record) => {
  const out = new Map();
  for (const r of record?.results || []) {
    const s = out.get(r.entryId) || { series: [], latest: null };
    s.series.push(r);
    s.latest = r;
    out.set(r.entryId, s);
  }
  return out;
};
