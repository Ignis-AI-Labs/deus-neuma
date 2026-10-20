/**
 * THE MACHINE LANE — a heavy job gets the machine to itself.
 *
 * Whatever the size of the GPU, while a clip renders every other process waits:
 * heavy work queues for the machine, the hardware decides how the room is
 * made, and models are neither reloaded needlessly nor run on top of each
 * other.
 *
 * The lane rides the one substrate line (substrate-line.js, kind 'machine'):
 * while a machine lease waits nothing new is admitted, so the turns already
 * speaking finish their reply and the line drains; then the job runs ALONE and
 * every waiter is told what is ahead of it. The hardware decides the rest:
 *   · the job fits beside the mind (forge-capacity engine budget) → the mind
 *     stays resident and simply waits its turn — no reload;
 *   · it does not (a 16-24 GB card the mind fills) → the mind PARKS (stopped)
 *     and relights after, its engine room freed first.
 * Back-to-back heavy jobs keep a parked mind parked until none is waiting — one
 * relight for the batch, never one per job.
 *
 * impure (the process's one parked state; drives the supervisors).
 */
import { substrateLine, linePlace } from './substrate-lease.js';
import { probeMachine } from './machine-probe.js';
import { forgeCapacity } from './image-forge/forge-capacity.js';
import { activeLaunchConfig, ensureServing, stopSupervised } from './llama-server-supervisor.js';
import { isServing } from './served-health-cache.js';
import { freeComfy } from './image-forge/comfyui-supervisor.js';
import { resolveComfyConfig } from './image-forge/comfyui-config.js';
import { createLogger } from './logger.js';

const log = createLogger('MachineLane');

/**
 * Does the mind stay, or step aside? Pure.
 * @param {{ mindServing: boolean, engineGB: number|null, needGB: number }} s
 * @returns {'clear'|'beside'|'park'} clear = no mind on the card to move
 */
export const parkDecision = ({ mindServing, engineGB, needGB }) => {
  if (!mindServing) return 'clear';
  return Number.isFinite(engineGB) && engineGB >= needGB ? 'beside' : 'park';
};

// The mind this lane parked, and the promise every would-be relight waits on.
let parked = null;

/** Resolves once no machine job holds the mind parked (llm-provider waits on it before relighting). */
export const whenMachineFree = () => parked?.free ?? Promise.resolve();

// impure — make the room the job needs: park the mind when it does not fit beside.
const makeRoom = async (needGB, label) => {
  if (parked) return; // the last job left it parked for this one
  const cfg = activeLaunchConfig(process.env);
  const mindServing = await isServing(cfg.port).catch(() => false);
  const machine = mindServing ? await probeMachine({ fresh: true }) : null;
  const d = parkDecision({ mindServing, engineGB: machine ? forgeCapacity(machine).engineGB : null, needGB });
  if (d !== 'park') return;
  let release;
  parked = { since: Date.now(), free: new Promise((r) => { release = r; }), release };
  log.info('the mind steps aside for a heavy job', { label, needGB });
  const stopped = await stopSupervised().catch((err) => ({ status: 'error', error: err.message }));
  if (stopped.status !== 'stopped') log.warn('the mind could not be parked; the job runs beside it', { stopped });
};

// impure — give the room back, unless another heavy job is already waiting for it.
const giveRoomBack = async () => {
  if (!parked) return;
  if (substrateLine.snapshot().waiting.some((w) => w.kind === 'machine')) return;
  const p = parked;
  try {
    await freeComfy(resolveComfyConfig(process.env)).catch(() => {});
    await ensureServing(activeLaunchConfig(process.env));
    log.info('the mind is back', { parkedMs: Date.now() - p.since });
  } catch (err) {
    log.error('the mind did not relight after a heavy job; the next request relights it', { error: err.message });
  } finally {
    parked = null;
    p.release();
  }
};

/**
 * Run a heavy job with the machine to itself. The caller's own place in line
 * (a turn filing an image, a wake) steps out first — the job must never wait
 * behind the very turn that asked for it — and steps back in after.
 * @param {{ label: string, needGB: number, signal?: AbortSignal, onWait?: Function }} who
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export const withMachine = async ({ label, needGB, signal = null, onWait = null }, fn) => {
  const place = linePlace();
  const stepped = Boolean(place && !place.away());
  if (stepped) place.stepOut();
  try {
    const lease = await substrateLine.acquire({ kind: 'machine', label, signal, onWait });
    try {
      await makeRoom(needGB, label);
      return await fn();
    } finally {
      await giveRoomBack();
      lease.release();
    }
  } finally {
    if (stepped) await place.stepBackIn();
  }
};
