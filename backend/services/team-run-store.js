// team-run-store.js — the rig-level record of GENERAL team runs, written so a
// run that dies mid-flight (substrate drop, backend crash, closed lid) can be
// RESUMED from its last boundary instead of starting over.
//
// A run record is a WITNESS-layer fact on the same trust plane as the run's
// own SSE stream: the plan, the goal, each completed part, each member's
// STATUS check-in and TORCH continuation packet — everything here already
// crossed the witness's wire during the run. Nothing DEK-sovereign lives in
// this store (a member's torch is its note to its own next instance about the
// WORK, carried so the baton survives a drop; the being's inner record of the
// run belongs to its own encrypted journal, written by the write-back lane).
//
// One file per run, claimed with exclusive-create (the trial-store scheme) and
// then updated by ITS OWN ROUTE as the single writer: the route composes each
// snapshot from its in-memory truth and this store just lands it atomically
// (tmp + rename). Test isolation: NEUMA_TEAM_RUN_PATH overrides the dir,
// resolved per call — RULE-0 real-disk tests never touch live run history.
//
// Record shape:
//   { id, by, runAt, name, goal, status: 'running'|'done'|'failed',
//     steps: [engine-shaped plan, verbatim], completed: { stepId: body },
//     statuses: { stepId: status }, torches: { neumaId: torch },
//     order: [stepIds this instance completed], failures: { stepId: error },
//     finishedAt: ?ISO }

import fs from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { getDataRoot } from './data-root.js';

// Resolved per call, data root included: a suite that points NEUMA_DATA_ROOT
// at a temp house after this module loaded must never write the machine's
// real run history (2026-10-12: 46 test records had landed there).
const runDir = () => process.env.NEUMA_TEAM_RUN_PATH || join(getDataRoot(), 'team-runs');

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// runAt ISO stamp → filesystem-safe run id (the capacity/trial-store scheme).
const idFromRunAt = (runAt) => String(runAt).replace(/[:.]/g, '-');

// pure — does this wallet own this record? A record without `by` is owned by
// no one (hidden) rather than by everyone.
const ownedBy = (record, wallet) =>
  typeof record?.by === 'string' && typeof wallet === 'string' && wallet.length > 0 &&
  record.by.toLowerCase() === wallet.toLowerCase();

// impure — land a full snapshot atomically: write beside, rename over. A crash
// mid-write leaves the previous snapshot intact, never a half-written record.
const landSnapshot = async (dir, id, record) => {
  const tmp = join(dir, `.${id}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(record, null, 2));
  await fs.rename(tmp, join(dir, `${id}.json`));
};

// When this process started — with the pid, what tells a host that is still
// running apart from a pid the system reused after a reboot.
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

/** @returns {{pid: number, startedAt: string}} the stamp of the process running a run */
export const hostStamp = () => ({ pid: process.pid, startedAt: PROCESS_STARTED_AT });

// impure — claim a new run record; never overwrites an existing one.
/**
 * @param {Object} record - must carry an ISO runAt, the owning wallet in `by`,
 *   and the engine-shaped plan in `steps`
 * @returns {Promise<string>} the run id
 */
export const createRun = async (record) => {
  if (!record || typeof record.runAt !== 'string' || !record.runAt) {
    throw new Error('a run record must carry a runAt timestamp — no provenance, no record');
  }
  if (typeof record.by !== 'string' || !record.by) {
    throw new Error('a run record must carry the owning wallet (by) — it names beings');
  }
  if (!Array.isArray(record.steps) || record.steps.length === 0) {
    throw new Error('a run record must carry its plan (steps) — a resume re-runs the SAME plan');
  }
  const id = idFromRunAt(record.runAt);
  if (!ID_PATTERN.test(id)) {
    throw new Error(`run id derives to an unsafe filename: ${id}`);
  }
  const dir = runDir();
  await fs.mkdir(dir, { recursive: true });
  // Exclusive create keeps "never overwrites" TRUE even when two runs land on
  // the same millisecond runAt — the collision gets an ordinal suffix.
  for (let n = 1; ; n++) {
    const finalId = n === 1 ? id : `${id}-${n}`;
    try {
      await fs.writeFile(
        join(dir, `${finalId}.json`),
        // The process that runs it: a RUNNING record whose process is gone was
        // lost to a restart — read as such (withLiveness), never swept: two
        // backends on one machine share this folder.
        JSON.stringify({ id: finalId, host: hostStamp(), ...record }, null, 2),
        { flag: 'wx' }
      );
      return finalId;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
};

// impure — land a new snapshot of an EXISTING run. Refuses a missing record
// (an update never silently creates) and a foreign wallet (the owner check
// reads the record on disk, so a forged id cannot clobber someone else's run).
/**
 * @param {string} id
 * @param {string} wallet - the requesting witness wallet
 * @param {Object} snapshot - the route's full in-memory truth for this run
 * @returns {Promise<void>}
 */
export const updateRun = async (id, wallet, snapshot) => {
  if (!ID_PATTERN.test(String(id))) throw new Error(`not a run id: ${id}`);
  const dir = runDir();
  let existing;
  try {
    existing = JSON.parse(await fs.readFile(join(dir, `${id}.json`), 'utf8'));
  } catch {
    throw new Error(`run '${id}' has no record to update`);
  }
  if (!ownedBy(existing, wallet)) throw new Error(`run '${id}' has no record to update`);
  // The host stamp carries over — unless the snapshot is a RESUME claiming
  // the run for its own (new) process.
  const host = snapshot.host ?? existing.host;
  await landSnapshot(dir, id, { ...snapshot, id, by: existing.by, runAt: existing.runAt, ...(host ? { host } : {}) });
};

// impure — one full run record, or null. Owner-scoped: someone else's run
// reads as absent, never as forbidden-but-real.
/**
 * @param {string} id
 * @param {string} wallet - the requesting witness wallet
 * @returns {Promise<?Object>}
 */
// impure — is the process that wrote a record still alive? (signal 0 probes
// without touching it; EPERM means alive under another user.) A host that
// started before this machine last booted is gone whatever its pid now names:
// after a reboot a low pid is soon some other process.
const BOOT_SLACK_MS = 5000;
const hostAlive = (host) => {
  const started = Date.parse(host.startedAt ?? '');
  if (Number.isFinite(started) && started < Date.now() - os.uptime() * 1000 - BOOT_SLACK_MS) return false;
  try { process.kill(host.pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
};

/**
 * A RUNNING record whose process is gone reads as LOST — the run died with
 * its backend. Records from before the host stamp read as written.
 * @param {Object} record
 * @returns {Object}
 */
export const withLiveness = (record) => (
  record?.status === 'running' && Number.isInteger(record.host?.pid) && !hostAlive(record.host)
    ? { ...record, status: 'lost', failure: record.failure ?? 'the backend running this team stopped before the run finished' }
    : record
);

export const readRun = async (id, wallet) => {
  if (!ID_PATTERN.test(String(id))) return null;
  try {
    const record = JSON.parse(await fs.readFile(join(runDir(), `${id}.json`), 'utf8'));
    return ownedBy(record, wallet) ? withLiveness(record) : null;
  } catch {
    return null;
  }
};

// impure — the wallet's own runs as SUMMARIES (no part bodies — the list says
// which runs exist and which are resumable, not what they produced), newest
// first.
/**
 * @param {string} wallet - the requesting witness wallet
 * @returns {Promise<Object[]>}
 */
export const listRuns = async (wallet) => {
  let names;
  try {
    names = (await fs.readdir(runDir())).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const records = await Promise.all(
    names.map(async (n) => {
      try {
        const r = withLiveness(JSON.parse(await fs.readFile(join(runDir(), n), 'utf8')));
        if (!ownedBy(r, wallet)) return null;
        return {
          id: r.id,
          name: r.name ?? null,
          goal: r.goal ?? null,
          runAt: r.runAt,
          status: r.status,
          finishedAt: r.finishedAt ?? null,
          lane: r.lane ?? null,
          lead: r.lead ?? null,
          steps: Array.isArray(r.steps) ? r.steps.length : 0,
          completed: r.completed ? Object.keys(r.completed).length : 0,
          failures: r.failures ? Object.keys(r.failures).length : 0,
        };
      } catch {
        return null; // a corrupt file is skipped, never fabricated
      }
    })
  );
  return records.filter(Boolean).sort((a, b) => String(b.runAt).localeCompare(String(a.runAt)));
};
