// titling-jobs — naming chats in batch as a job the desk can watch and stop (deus-neuma #28).
//
// A batch used to be one request that answered only when every chat was named: on a local model
// that is minutes of a static "NAMING…", no way to stop it, and a failure read as "nothing to name".
// A job starts at once with its total, counts each chat as it lands (the label is already kept),
// and stops between chats when cancelled. One running job per wallet; a finished one is kept
// ten minutes for the desk to read its end. impure (module state, the titler).
import crypto from 'node:crypto';
import { autotitleCouncils, autotitleSessions, pendingCouncils, pendingSessions } from './chat-titler.js';
import { createLogger } from './logger.js';

const log = createLogger('TitlingJobs');
const KEEP_MS = 10 * 60_000;
const jobs = new Map(); // wallet → job

/** What the desk reads of a job: no handles, no wallet. Pure. */
const jobView = (job) => Object.freeze({
  id: job.id,
  kind: job.kind,
  state: job.state,
  done: job.done,
  total: job.total,
  titled: job.titled,
  failed: job.failed,
  skipped: job.skipped,
  skipReason: job.skipReason,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  error: job.error,
});

const count = (job) => (result) => {
  job.done += 1;
  if (result.status === 'titled') job.titled += 1;
  else if (result.status === 'failed') job.failed += 1;
  else {
    job.skipped += 1;
    if (result.reason) job.skipReason = result.reason;
  }
};

/**
 * Start a batch: one-on-ones of one or more neuma (`neumaIds`, each named through its own route),
 * or councils. Answers { job } at once, or { running } when this wallet already has one going.
 * @param {{wallet: string, kind: 'chats'|'councils', neumaIds?: string[], sessionIds?: ?string[],
 *   councilIds?: ?string[], force?: boolean}} request
 */
export const startTitlingJob = async ({ wallet, kind, neumaIds = [], sessionIds = null, councilIds = null, force = false }) => {
  const current = jobs.get(wallet);
  if (current?.state === 'running') return { running: jobView(current) };
  // the batch's whole list first, so the desk can say "n of total" from the start
  const plan = kind === 'councils'
    ? [{ councilIds: await pendingCouncils({ wallet, councilIds, force }) }]
    : await Promise.all(neumaIds.map(async (neumaId) => ({
      neumaId, sessionIds: await pendingSessions({ wallet, neumaId, sessionIds: neumaIds.length === 1 ? sessionIds : null, force }),
    })));
  const job = {
    id: crypto.randomBytes(8).toString('hex'),
    kind,
    state: 'running',
    done: 0,
    total: plan.reduce((n, p) => n + (p.sessionIds ?? p.councilIds).length, 0),
    titled: 0,
    failed: 0,
    skipped: 0,
    skipReason: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    abort: new AbortController(),
  };
  jobs.set(wallet, job);
  const onEach = count(job);
  const signal = job.abort.signal;
  (async () => {
    // the pending lists are exactly what to name, so each runs forced: nothing is filtered twice
    for (const step of plan) {
      if (signal.aborted) break;
      if (step.councilIds) await autotitleCouncils({ wallet, councilIds: step.councilIds, force: true, onEach, signal });
      else if (step.sessionIds.length) await autotitleSessions({ wallet, neumaId: step.neumaId, sessionIds: step.sessionIds, force: true, onEach, signal });
    }
  })().then(() => {
    job.state = signal.aborted ? 'cancelled' : 'done';
  }).catch((err) => {
    job.state = 'failed';
    job.error = err.message;
    log.warn('a titling job stopped', { kind, error: err.message });
  }).finally(() => {
    job.finishedAt = new Date().toISOString();
    setTimeout(() => { if (jobs.get(wallet) === job) jobs.delete(wallet); }, KEEP_MS).unref?.();
  });
  return { job: jobView(job) };
};

/** This wallet's job by id, or null. impure (module state) */
export const titlingJob = (wallet, id) => {
  const job = jobs.get(wallet);
  return job && job.id === id ? jobView(job) : null;
};

/** Stop this wallet's job between chats; what it named stays. Answers the job, or null. impure */
export const cancelTitlingJob = (wallet, id) => {
  const job = jobs.get(wallet);
  if (!job || job.id !== id) return null;
  if (job.state === 'running') job.abort.abort();
  return jobView(job);
};
