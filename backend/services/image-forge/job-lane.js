/**
 * ComfyUI job lane (B-6/B-7) — the completion doctrine and the single-flight
 * job map, over the wire client's primitives.
 *
 * ComfyUI is a single FIFO with one prompt_worker thread — it IS the lock, so
 * NEUMA keeps NO second queue: just a map keyed by our minted prompt_id, and
 * ONE event socket held open under one lane clientId (per-job WS events route
 * only to the submitting client_id). Multi-neuma serialization is free.
 *
 * Completion DOCTRINE (spike item 7, confirmed N=8): a WS terminal event is
 * only the TRIGGER — `executing{node:null}` / `execution_success` /
 * `execution_error` / `execution_interrupted`; the VERDICT + outputs are
 * `GET /history/{prompt_id}` (written BEFORE the terminal event). With no
 * socket, `/api/jobs` + `/history` polling is the fallback (spike item 8).
 *
 * Teardown LAW: every job ends in exactly one terminal outcome and frees its
 * tracking, always — on success, error, interrupt, stall, or socket death.
 * Timeouts are an inactivity watchdog over progress, NEVER a total-job cap (a
 * healthy long render is never killed for being long).
 */
import { randomUUID } from 'crypto';
import { createLogger } from '../logger.js';
import {
  submitPrompt, getHistory, getJob, cancelJob, interruptCurrent, openEventSocket,
} from './comfyui-client.js';

const log = createLogger('ImageForge.JobLane');

const DEFAULT_FIRST_PROGRESS_MS = 60_000; // a job that never starts fails fast
const DEFAULT_INACTIVITY_MS = 120_000;    // silence AFTER progress = a stall
const POLL_INTERVAL_MS = 1000;
const SOCKET_OPEN_TIMEOUT_MS = 5000;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// One clientId + one socket for the whole lane. Lazily opened, reconnected on
// drop while any job is live. jobs: promptId → live job record.
let laneClientId = null;
let socket = null;
let socketOpening = null;
const jobs = new Map();
// The prompt_id the engine reported RUNNING (last `executing` with a node) —
// progress frames that omit a prompt_id belong to it (single-FIFO).
let runningPromptId = null;

// impure — the outputs triples from a history verdict, flattened.
const outputsOf = (verdict) =>
  Object.values(verdict?.outputs || {}).flatMap((o) => o.images || o.gifs || []);

// impure — resolve a job to its terminal outcome exactly once, then free it.
const settle = (job, outcome) => {
  if (job.settled) return;
  job.settled = true;
  clearTimeout(job.watchdog);
  jobs.delete(job.promptId);
  if (runningPromptId === job.promptId) runningPromptId = null;
  job.resolve(outcome);
};

// impure — turn a reached-terminal trigger into the history-verdict outcome.
const finishFromHistory = async (cfg, job, trigger) => {
  const verdict = await getHistory(cfg, job.promptId).catch(() => null);
  if (trigger === 'execution_interrupted' || (verdict && !verdict.completed && (verdict.messages || []).some((m) => m?.[0] === 'execution_interrupted'))) {
    return settle(job, { status: 'interrupted', promptId: job.promptId });
  }
  if (verdict?.completed && verdict.statusStr === 'success') {
    return settle(job, { status: 'ok', promptId: job.promptId, statusStr: verdict.statusStr, outputs: outputsOf(verdict) });
  }
  // Reached terminal but not a clean success: an error (or a history the engine
  // wiped). Honest error, never a false ok.
  return settle(job, {
    status: 'error', promptId: job.promptId,
    detail: verdict ? `render did not complete (${verdict.statusStr ?? 'no status'})` : 'render ended with no history record',
  });
};

// impure — (re)arm the inactivity watchdog. Before first progress: fail-fast if
// the job never starts. After: fail if progress goes silent. A cancel is
// attempted so a stalled job does not hold the FIFO.
const armWatchdog = (cfg, job) => {
  clearTimeout(job.watchdog);
  const ms = job.started ? job.inactivityMs : job.firstProgressMs;
  job.watchdog = setTimeout(async () => {
    log.warn('job watchdog fired', { promptId: job.promptId, phase: job.started ? 'inactivity' : 'first-progress' });
    await cancelJob(cfg, job.promptId).catch(() => {});
    settle(job, {
      status: 'error', promptId: job.promptId,
      detail: job.started ? 'render stalled (no progress)' : 'render never started',
    });
  }, ms);
  job.watchdog.unref?.();
};

// impure — a life sign for a job: flip `started` and RE-ARM the watchdog so its
// delay switches from first-progress to inactivity, and every subsequent sign
// resets the clock. BOTH completion paths (WS + polling) route life signs
// through here so the watchdog-timing can never drift between them again
// (echo r1 finding: the polling path used to flip the flag without re-arming,
// so a long poll-mode render died at firstProgressMs while still progressing).
const markStarted = (cfg, job) => {
  job.started = true;
  armWatchdog(cfg, job);
};

// impure — a single WS event, demultiplexed to its job by prompt_id.
const routeEvent = (cfg, ev) => {
  const pid = ev.data?.prompt_id ?? null;
  // `executing` with a non-null node names the running job; null node on our
  // job is a terminal trigger.
  if (ev.type === 'executing') {
    if (ev.data?.node && pid) { runningPromptId = pid; }
    const job = pid ? jobs.get(pid) : null;
    if (job) {
      markStarted(cfg, job);
      if (ev.data?.node === null) finishFromHistory(cfg, job, 'executing_null');
    }
    return;
  }
  if (ev.type === 'progress') {
    const job = pid ? jobs.get(pid) : (runningPromptId ? jobs.get(runningPromptId) : null);
    if (job) {
      markStarted(cfg, job);
      job.onProgress?.({ value: ev.data?.value ?? 0, max: ev.data?.max ?? 0 });
    }
    return;
  }
  if (ev.type === 'execution_success' || ev.type === 'execution_error' || ev.type === 'execution_interrupted') {
    const job = pid ? jobs.get(pid) : null;
    if (job) finishFromHistory(cfg, job, ev.type);
  }
};

// impure — ensure the lane socket is open; resolves true when ready, false if
// it could not open (caller falls back to polling). Reconnect on drop while
// jobs remain.
const ensureSocket = async (cfg) => {
  if (socket && socket.readyState === socket.OPEN) return true;
  if (socketOpening) return socketOpening;
  if (!laneClientId) laneClientId = randomUUID();
  socketOpening = new Promise((resolve) => {
    const ws = openEventSocket(cfg, laneClientId, {
      onOpen: () => { socket = ws; socketOpening = null; resolve(true); },
      onEvent: (ev) => routeEvent(cfg, ev),
      onClose: () => {
        if (socket === ws) socket = null;
        // Reconnect only if work remains; otherwise stay quiet. Deliberate
        // scope (echo r2 RQ): a mid-render socket drop relies on reconnect to
        // resume event delivery; if reconnect keeps failing, the inactivity
        // watchdog settles the job as a named error rather than silently
        // falling through to polling — an in-flight job does not switch
        // completion strategies mid-flight (kept simple; a rare case).
        if (jobs.size > 0) ensureSocket(cfg).catch(() => {});
      },
      onError: () => {},
    });
    const t = setTimeout(() => { if (socketOpening) { socketOpening = null; resolve(false); } }, SOCKET_OPEN_TIMEOUT_MS);
    t.unref?.();
  });
  return socketOpening;
};

// impure — the no-socket completion path (spike item 8): poll /api/jobs for the
// terminal status, then /history for the verdict/outputs.
const pollToCompletion = async (cfg, job) => {
  const deadlineFirst = Date.now() + job.firstProgressMs;
  let sawActive = false;
  while (!job.settled) {
    if (job.signal?.aborted) { await cancelJob(cfg, job.promptId).catch(() => {}); }
    const j = await getJob(cfg, job.promptId).catch(() => null);
    const status = j?.status ?? null;
    // Every active poll is a life sign — re-arm so a poll-mode render longer
    // than inactivityMs is not false-stalled (polling has no mid-render
    // granularity, so we trust in_progress until a terminal status).
    if (status === 'in_progress') { sawActive = true; markStarted(cfg, job); }
    if (status === 'completed') return finishFromHistory(cfg, job, 'execution_success');
    if (status === 'cancelled') return settle(job, { status: 'interrupted', promptId: job.promptId });
    if (status === 'failed') return finishFromHistory(cfg, job, 'execution_error');
    if (!sawActive && Date.now() > deadlineFirst) {
      return settle(job, { status: 'error', promptId: job.promptId, detail: 'render never started' });
    }
    await delay(POLL_INTERVAL_MS);
  }
};

/**
 * Run one graph to a terminal outcome. ALWAYS resolves (never rejects) with one
 * of: `{status:'ok', outputs}` · `{status:'error', detail}` ·
 * `{status:'interrupted'}`. The caller's AbortSignal is barge-in: it cancels
 * the job atomically (a normal edge into interrupted). Impure.
 * @param {object} cfg resolved comfy config
 * @param {{graph: object, promptId?: string, signal?: AbortSignal,
 *   onProgress?: (p:{value:number,max:number}) => void,
 *   firstProgressMs?: number, inactivityMs?: number, noSocket?: boolean}} req
 *   noSocket forces the polling completion path (the spike-item-8 fallback) —
 *   the seam its integration test drives on a live engine.
 */
export const runJob = async (cfg, req) => {
  const promptId = req.promptId ?? randomUUID();
  if (jobs.has(promptId)) return { status: 'error', promptId, detail: 'duplicate prompt_id in flight' };

  // ensureSocket mints laneClientId when it opens; on the noSocket / failed-open
  // path we mint it here so POST /prompt always carries a client_id.
  const socketReady = req.noSocket ? false : await ensureSocket(cfg);
  if (!laneClientId) laneClientId = randomUUID();

  return new Promise((resolve) => {
    const job = {
      promptId, resolve, settled: false, started: false, watchdog: null,
      signal: req.signal ?? null, onProgress: req.onProgress ?? null,
      firstProgressMs: req.firstProgressMs ?? DEFAULT_FIRST_PROGRESS_MS,
      inactivityMs: req.inactivityMs ?? DEFAULT_INACTIVITY_MS,
    };
    jobs.set(promptId, job);

    // A signal already aborted at call time settles interrupted WITHOUT ever
    // enqueueing — both completion paths honor a pre-aborted signal identically
    // (echo r2 finding: the WS path used to submit anyway and run to 'ok'
    // because cancelJob on an unknown id is a no-op).
    if (job.signal?.aborted) { settle(job, { status: 'interrupted', promptId }); return; }

    // Barge-in: an abort during the render cancels the job; the terminal
    // arrives as interrupted (the poll path also re-checks the flag per loop).
    if (job.signal) {
      job.signal.addEventListener('abort', () => { cancelJob(cfg, promptId).catch(() => {}); }, { once: true });
    }

    (async () => {
      const ack = await submitPrompt(cfg, { prompt: req.graph, promptId, clientId: laneClientId });
      if (!ack.ok) {
        return settle(job, {
          status: 'error', promptId,
          // The engine's own words first. An object-shaped error carries a
          // `message` (e.g. invalid_prompt_id), and `node_errors` arrives as an
          // EMPTY OBJECT when nothing was wrong with any node — reading that as
          // truthy reported every rejection as "graph validation failed" and
          // hid the real cause (found while wiring the being-tools, 2026-07-29).
          detail: typeof ack.error === 'string'
            ? ack.error
            : (ack.error?.message
              ?? (Object.keys(ack.nodeErrors || {}).length > 0 ? 'graph validation failed' : `enqueue refused (${ack.status})`)),
          nodeErrors: ack.nodeErrors ?? null,
        });
      }
      armWatchdog(cfg, job);
      // No socket ⇒ the polling fallback drives completion.
      if (!socketReady) pollToCompletion(cfg, job).catch((err) => settle(job, { status: 'error', promptId, detail: err.message }));
    })().catch((err) => settle(job, { status: 'error', promptId, detail: err.message }));
  });
};

/**
 * Barge-in an in-flight job by prompt_id — the direct cancel (atomic,
 * idempotent). Falls back to interrupting the running prompt if the jobs API
 * refuses AND this job is the one running. Impure.
 * @param {object} cfg
 * @param {string} promptId
 */
export const cancel = async (cfg, promptId) => {
  const res = await cancelJob(cfg, promptId);
  if (res.cancelled) return { cancelled: true, via: 'jobs-api' };
  if (runningPromptId === promptId) {
    const i = await interruptCurrent(cfg);
    return { cancelled: i.ok, via: 'interrupt' };
  }
  return { cancelled: false, via: 'none' };
};

// Test/shutdown seam: drop all tracking + close the socket. Impure.
export const _resetLane = () => {
  for (const job of jobs.values()) { clearTimeout(job.watchdog); }
  jobs.clear();
  runningPromptId = null;
  if (socket) { try { socket.close(); } catch { /* already gone */ } socket = null; }
  socketOpening = null;
  laneClientId = null;
};
