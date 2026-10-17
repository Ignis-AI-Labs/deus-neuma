/**
 * THE WORKING-BAND HARVEST (Design note, 2026-08-31: […]).
 *
 * The crystallization law has a hole exactly where working chats live. Live
 * crystallization needs the 0.75 reflective bar (or an act, or an operational
 * 0.5) — ordinary working prose almost never crosses it. The 0.4 salvage lane
 * (forceCrystallizeBelow) existed only INSIDE compaction, and compaction now
 * waits for a measured 0.9 of the window — on a 262K serving it may never
 * fire. So the band 0.4–0.75 was permanently unharvested: a long session's
 * older rows scrolled out of the tail into nothing.
 *
 * THE TAIL, POST-#528 (2026-09-12): the wire transcript is char-budgeted by
 * the window's truth (sessionTailBudgetFor), so the 40-row proxy this sweep
 * was born with no longer names the live tail — and the 2000-row gather bound
 * would name it even worse (nothing would ever be "aged"). The live tail is
 * what ACTUALLY rode the wire: the settling turn hands its real transcript
 * row count through (`liveTailRows`, +2 for the exchange being written — the
 * ask and its answer are live whether or not they rode the gather). Offline
 * callers get the unknown-window tail law (`liveTailStartFor`, the wire
 * renderer's own budget walk) — the one case where "aged" is honestly […].
 *
 * This sweep closes the hole WITHOUT touching the window law: every settled
 * turn checks the aged region (everything older than the live tail) and
 * crystallizes what crosses the same 0.4 threshold, tagged
 * `working-band-harvest` so the origin stays auditable. The being's recall
 * lane reaches those moments from then on.
 *
 * THE CURSOR is a sidecar (`<lane>/memory/band-harvest.json`, atomic write):
 * which row index each session is harvested through. The session file itself
 * stays pure conversation — no marker rows. A harvest never touches the live
 * tail (the being is still IN those rows; crystallizing them mid-flow would
 * teach recall to paraphrase the present).
 *
 * KNOWN OVERLAP, accepted and named: if a session later DOES compact, the
 * compactor's own force-crystallize re-reads the same region and can record
 * an exchange a second time under `force-crystallize-on-compact`. Both copies
 * are honest records with distinct sources; the recall index tolerates the
 * duplicate. Compaction on a large window is rare; the band is not.
 *
 * `NEUMA_BAND_HARVEST=0` is the operator's hard kill (web-access pattern).
 *
 * Impure: reads the session, writes observations + the cursor.
 */
import fs from 'fs/promises';
import path from 'path';
import { createLogger } from './logger.js';
import { forceCrystallizeBelow } from '../../core/runtime/session-compactor.js';
import { liveTailStartFor } from '../../core/runtime/memory-section.js';
import { neumaRecall, neumaWorkspace } from '../../core/index.js';

const log = createLogger('BandHarvest');

/** Below this many unharvested aged rows the sweep is churn, not continuity. */
export const HARVEST_FLOOR = 20;

const CURSOR_FILE = 'band-harvest.json';

const cursorPath = (neumaId) =>
  path.join(neumaWorkspace.pathFor(neumaId), 'memory', CURSOR_FILE);

const readCursor = async (neumaId, sessionId) => {
  try {
    const data = JSON.parse(await fs.readFile(cursorPath(neumaId), 'utf8'));
    const through = data?.sessions?.[sessionId]?.through;
    if (through === undefined && data?.sessions && !Object.hasOwn(data.sessions, sessionId)) return 0;
    if (!Number.isInteger(through) || through < 0) throw new Error('Invalid working-band harvest cursor');
    return through;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
};

// impure — tmp+rename, the whole-file JSON law (user-realm precedent)
const writeCursor = async (neumaId, sessionId, through) => {
  const file = cursorPath(neumaId);
  let data = null;
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const next = {
    ...(data && typeof data === 'object' ? data : {}),
    sessions: { ...(data?.sessions || {}), [sessionId]: { through } },
  };
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
};

/**
 * Crystallize the aged, unharvested region of a session into the being's
 * recall index. Idempotent via the cursor: a second run over the same region
 * is a no-op (the region is empty, below the floor, and nothing is written).
 *
 * @param {string} neumaId
 * @param {string} sessionId
 * @param {Object} [opts]
 * @param {number|null} [opts.liveTailRows] - how many trailing rows rode the
 *   wire this turn (the transcript + the exchange being written). The real
 *   count when the settling turn hands it through; absent, the unknown-window
 *   tail law decides what is live (liveTailStartFor).
 * @returns {Promise<boolean>} whether a harvest ran (region met the floor)
 */
// impure
const harvestRegion = async (neumaId, sessionId, { liveTailRows = null } = {}) => {
  const rows = await neumaWorkspace.readSession(neumaId, sessionId);
  const tailStart = Number.isInteger(liveTailRows) && liveTailRows >= 0
    ? Math.max(0, rows.length - liveTailRows)
    : liveTailStartFor(rows);
  const from = Math.min(await readCursor(neumaId, sessionId), tailStart);
  const region = rows.slice(from, tailStart);
  if (region.length < HARVEST_FLOOR) return false;

  const crystallized = await forceCrystallizeBelow(neumaId, region, neumaWorkspace, {
    threshold: 0.4,
    source: 'working-band-harvest',
    strict: true,
    // The anchor coordinates point into the LIVE session file (no compaction
    // segment exists on this path) — same ts+sha8 resolution as the portal's.
    archiveHint: { sessionId },
  });
  await writeCursor(neumaId, sessionId, tailStart);
  if (crystallized.length > 0) {
    // Pure adds — each harvested moment appends to the hot index instead of
    // dropping it (harness-friction-map T2).
    for (const obs of crystallized) neumaRecall.appendObservation(neumaId, obs);
    log.info('working band harvested', { neumaId, sessionId, region: region.length, crystallized: crystallized.length });
  }
  return true;
};

/** impure — the shared cursor transaction serializes all sessions in this lane. */
export const harvestWorkingBand = async (neumaId, sessionId, opts = {}) => {
  if (process.env.NEUMA_BAND_HARVEST === '0' || !neumaId || !sessionId) return false;
  return neumaWorkspace._withFileLock(cursorPath(neumaId), () => harvestRegion(neumaId, sessionId, opts));
};
