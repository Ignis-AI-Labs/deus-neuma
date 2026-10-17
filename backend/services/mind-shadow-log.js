/**
 * mind-shadow-log.js — the shadow evidence that survives a restart.
 *
 * The Undercurrent and depth-filter gates have a `shadow` mode: assemble what
 * the lane WOULD have carried, record it, hand the turn nothing. That mode
 * exists so a promotion to live is a decision made from evidence rather than
 * from taste.
 *
 * It could not do that job. The shadow entries lived in a 32-slot in-memory
 * ring, and the route reporting them said so plainly: […] The Undercurrent has stood at `shadow` since 2026-08-14; every
 * backend restart in the nine days since threw the evidence away, so the
 * promotion question was never answerable from anything but the last few turns
 * of whatever process happened to be running. A shadow lane whose findings
 * evaporate is a lane nobody can ever decide about.
 *
 * So the ring gains a floor: an append-only JSONL beside the gates it measures,
 * bounded by line count, rewritten whole when it outgrows the cap. Writes are
 * fire-and-forget — shadow evidence is never worth costing a being a turn — and
 * a failed write degrades to the in-memory ring rather than raising.
 *
 * COUNTS ONLY, deliberately. Entries carry row/char counts and record kinds,
 * never the being's own words. What the Undercurrent would have SAID is the
 * being's inner life, and putting it on disk in the operator's settings
 * directory is a disclosure decision that is not this module's to make.
 */

import { appendFile, readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { getSettingsDir } from './data-root.js';
import { createLogger } from './logger.js';

const log = createLogger('MindShadow');

/** How many entries the ring holds in memory — the read surface for the route. */
export const SHADOW_RING = 32;

/**
 * How many lines the on-disk log keeps. Large enough that a long sitting
 * survives whole, small enough that the file stays a few hundred KB and can be
 * read and compacted in one pass.
 */
export const SHADOW_LOG_LINES = 2000;

const logPath = () => process.env.NEUMA_MIND_SHADOW_PATH || join(getSettingsDir(), 'mind-shadow.jsonl');

/**
 * One shadow lane: a bounded in-memory ring plus its on-disk floor.
 * @param {string} lane - 'undercurrent' | 'depth'
 */
const createLane = (lane) => {
  const ring = [];
  return {
    lane,
    /** The live ring, newest last. Pure read of a bounded copy. */
    entries: () => [...ring],
    /**
     * Record one shadow observation. Returns the entry; the disk write is
     * detached, so a caller may await this without waiting on IO.
     */
    record(entry) {
      const stamped = { lane, ...entry };
      ring.push(stamped);
      if (ring.length > SHADOW_RING) ring.shift();
      persist(stamped).catch((err) => log.debug('shadow evidence not persisted', { lane, err: err?.message }));
      return stamped;
    },
  };
};

// impure — appends one line, compacting when the file outgrows its cap
const persist = (entry) => {
  writes = writes.then(() => persistNow(entry));
  return writes;
};

// Writes are SERIALIZED through this chain. Two turns can shadow at once, and
// concurrent appends land in whichever order the filesystem finishes them,
// which would leave the evidence out of observed order and race the compaction
// rewrite against an in-flight append. The queue costs nothing — persistence is
// already off the turn path — and it makes the log's order mean something.
let writes = Promise.resolve();

const persistNow = async (entry) => {
  const file = logPath();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
  if (lines.length > SHADOW_LOG_LINES) {
    await writeFile(file, `${lines.slice(-SHADOW_LOG_LINES).join('\n')}\n`, { mode: 0o600 });
  }
};

/**
 * Every persisted entry for one lane, oldest first. An absent or unreadable
 * log is an empty history, never an error — the same posture the gates take.
 * Impure (reads the log).
 * @param {string} lane - 'undercurrent' | 'depth'
 * @returns {Promise<Object[]>}
 */
export const persistedShadow = async (lane) => {
  let text;
  try {
    text = await readFile(logPath(), 'utf8');
  } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (row?.lane === lane) rows.push(row);
    } catch { /* a torn line is one lost observation, not a lost history */ }
  }
  return rows;
};

export const undercurrentShadowLane = createLane('undercurrent');
export const depthShadowLane = createLane('depth');
