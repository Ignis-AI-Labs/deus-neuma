/**
 * SERVING FIT — the substrate sized to the machine it runs on: by default up to
 * 90% of the card, because most people want their model's full capacity while
 * the machine stays clean and smooth.
 *
 * At ignition the unified KV pool is sized to the largest that keeps the GPU
 * at or under the operator's share: the card's total, less what other
 * programs hold right now, less what the server itself needs beyond its KV.
 * The cost per pool token is llama.cpp's own projection (`llama-fit-params
 * --fit-print`, no allocation), never a guess. A pool beyond the model's
 * trained window is SHARED room — more chats kept warm, long tasks side by
 * side — capped at every server slot full at that window; one being's window
 * never passes the trained context (model-capabilities.js).
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createLogger } from './logger.js';
import { modelHasMtpHeads, modelTrainContext } from './gguf-mtp.js';
import { SERVING_SERVER_SLOTS, validatedServingLaunchConfig } from './serving-launch-config.js';
import { readClaim } from './substrate-claim-registry.js';

const execFileAsync = promisify(execFile);
const log = createLogger('ServingFit');
const MiB = 1024 * 1024;

/** The share of the GPU the substrate may fill when the operator names none. 85%, not 90%:
 *  on 2026-10-20, at 89% of a 96 GB card the driver refused the desktop its GPU channels
 *  (NV_ERR_STATE_IN_USE) and the operator's screens blanked and redrew; at 84% they did not. */
export const DEFAULT_VRAM_SHARE = 0.85;
/** Kept free below the ceiling: allocator slack and driver growth. */
export const FIT_MARGIN_MIB = 512;
/** The smallest pool worth serving; below it the model does not fit this card. */
export const FIT_MIN_CONTEXT = 8192;

/**
 * pure — the operator's share of the GPU from their saved choice, a percent
 * (50-95); anything else reads as the default. A choice made in the app,
 * never an environment variable.
 */
export const shareFrom = (saved) => {
  const pct = Number(saved?.sharePct);
  return Number.isFinite(pct) && pct >= 50 && pct <= 95 ? pct / 100 : DEFAULT_VRAM_SHARE;
};

/**
 * pure — the linear memory model of one serving from two projections at
 * different pool sizes: MiB = baseMiB + perTokenMiB × pool.
 */
export const linearProjection = (low, high) => {
  if (!(high.ctx > low.ctx) || !(high.totalMiB >= low.totalMiB)) throw new Error('serving fit needs two projections at rising pool sizes');
  const perTokenMiB = (high.totalMiB - low.totalMiB) / (high.ctx - low.ctx);
  return Object.freeze({ perTokenMiB, baseMiB: low.totalMiB - perTokenMiB * low.ctx });
};

/**
 * pure — the pool that fits. `othersMiB` is what other programs hold on the
 * card now; `extraMiB` is what the server holds that the projection does not
 * (the vision projector, the speculative draft).
 * @returns {{fits: boolean, contextLength?: number, ceilingMiB: number, projectedMiB?: number, reason?: string}}
 */
export const planServingPool = ({ totalMiB, othersMiB, share, projection, extraMiB = 0, trainCtx, slots }) => {
  const ceilingMiB = Math.floor(totalMiB * share);
  const budgetMiB = ceilingMiB - othersMiB - extraMiB - FIT_MARGIN_MIB;
  const fitting = Math.floor((budgetMiB - projection.baseMiB) / projection.perTokenMiB);
  const pool = Math.min(fitting, trainCtx * slots);
  const contextLength = pool - (pool % 256);
  if (!(contextLength >= FIT_MIN_CONTEXT)) {
    return Object.freeze({ fits: false, ceilingMiB, reason: `the model and a ${FIT_MIN_CONTEXT}-token pool need ${Math.ceil(projection.baseMiB + projection.perTokenMiB * FIT_MIN_CONTEXT + extraMiB)} MiB; ${Math.max(0, ceilingMiB - othersMiB)} MiB is free under the share` });
  }
  return Object.freeze({
    fits: true,
    contextLength,
    ceilingMiB,
    projectedMiB: Math.ceil(projection.baseMiB + projection.perTokenMiB * contextLength + extraMiB),
  });
};

/** impure — the card's total and used MiB (nvidia-smi), or null where it cannot answer. */
export const readGpuMemory = async (index = 0) => {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['-i', String(index), '--query-gpu=memory.total,memory.used', '--format=csv,noheader,nounits'], { timeout: 10_000 });
    const [totalMiB, usedMiB] = stdout.trim().split(',').map((v) => Number(v.trim()));
    return Number.isFinite(totalMiB) && Number.isFinite(usedMiB) ? Object.freeze({ totalMiB, usedMiB }) : null;
  } catch {
    return null;
  }
};

/** pure — llama-fit-params beside the server binary, or null. */
export const fitParamsBinFor = (serverBin) => {
  if (typeof serverBin !== 'string' || !serverBin) return null;
  const bin = join(dirname(serverBin), 'llama-fit-params');
  return existsSync(bin) ? bin : null;
};

/**
 * pure — the GPU MiB from `llama-fit-params --fit-print on` (rows: device, model,
 * context, compute — e.g. `CUDA0 28159 17313 558`); the Host row is system RAM.
 */
export const projectedGpuMiB = (stdout) => {
  const rows = String(stdout).trim().split('\n').map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length === 4 && cols[0] !== 'Host' && cols.slice(1).every((v) => Number.isFinite(Number(v))));
  if (rows.length === 0) throw new Error('llama-fit-params printed no device rows');
  return rows.reduce((sum, cols) => sum + cols.slice(1).reduce((a, v) => a + Number(v), 0), 0);
};

/** impure — llama.cpp's projection of this serving at one pool size, in MiB. */
const projectAt = async (bin, model, slots, ctx) => {
  // Total KV is the pool either way, so the unified layout projects as its partitioned twin.
  const { stdout } = await execFileAsync(bin, ['-m', model, '-c', String(ctx), '--parallel', String(slots), '-ngl', '999', '--fit-print', 'on'], { timeout: 120_000, maxBuffer: 4 * MiB });
  return Object.freeze({ ctx, totalMiB: projectedGpuMiB(stdout) });
};

/**
 * What the server holds beyond llama.cpp's projection: the vision projector,
 * the speculative draft's context and CUDA's own. Measured on this rig
 * (2026-10-20, Qwen3.8-27B Q8 + BF16 projector + MTP draft, 262k pool): the
 * live server held 52,496 MiB against a 46,030 MiB projection. A first boot
 * estimates it; after a boot the measured excess is recorded and used.
 * @returns {number} MiB
 */
export const estimatedExtraMiB = ({ mmprojMiB = 0, mtp = false }) => mmprojMiB + 1536 + (mtp ? 4096 : 0);

// The machine's serving choices and measurements, beside its model selection
// (~/.neuma/substrate-selection.json): { sharePct, calibration: { [launch]: {extraMiB, at} } }.
const FIT_FILE = () => join(process.env.NEUMA_SUBSTRATE_CLAIM_DIR || join(homedir(), '.neuma'), 'serving-fit.json');
const calibrationKey = (launch) => `${launch.model}|${launch.mmproj || ''}`;

/** impure — the saved serving choices, or {} . */
export const readServingFit = () => {
  try {
    const saved = JSON.parse(readFileSync(FIT_FILE(), 'utf8'));
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
};

const writeServingFit = (saved) => {
  mkdirSync(dirname(FIT_FILE()), { recursive: true });
  writeFileSync(FIT_FILE(), JSON.stringify(saved, null, 2));
};

/** impure — save the operator's share of the GPU (a percent, 50-95); the next ignition fits to it. */
export const saveServingShare = (sharePct) => {
  const pct = Number(sharePct);
  if (!Number.isInteger(pct) || pct < 50 || pct > 95) throw new Error('the GPU share is a whole percent from 50 to 95');
  writeServingFit({ ...readServingFit(), sharePct: pct });
  return pct;
};

/** impure — the measured excess for this launch, or null. */
const calibratedExtraMiB = (launch) => {
  const value = readServingFit().calibration?.[calibrationKey(launch)]?.extraMiB;
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/** impure — record what a healthy server really holds beyond the projection (the next fit uses it). */
export const recordServingExcess = (launch, { actualMiB, projectedMiB }) => {
  if (!Number.isFinite(actualMiB) || !Number.isFinite(projectedMiB)) return;
  const saved = readServingFit();
  const calibration = { ...saved.calibration, [calibrationKey(launch)]: { extraMiB: Math.max(0, Math.round(actualMiB - projectedMiB)), at: new Date().toISOString() } };
  writeServingFit({ ...saved, calibration });
};

/**
 * impure — size the pool for this launch: null when this machine cannot be
 * measured (no NVIDIA card, no llama-fit-params) — the configured pool stands.
 * @param {{bin: string, model: string, mmproj?: string}} launch
 */
export const fitServingPool = async (launch, { slots, trainCtx, mtp = false, gpuIndex = 0 }) => {
  const bin = fitParamsBinFor(launch.bin);
  const gpu = await readGpuMemory(gpuIndex);
  if (!bin || !gpu || !launch.model) return null;
  const projection = linearProjection(await projectAt(bin, launch.model, slots, FIT_MIN_CONTEXT), await projectAt(bin, launch.model, slots, trainCtx));
  const mmprojMiB = launch.mmproj && existsSync(launch.mmproj) ? Math.ceil(statSync(launch.mmproj).size / MiB) : 0;
  const extraMiB = calibratedExtraMiB(launch) ?? estimatedExtraMiB({ mmprojMiB, mtp });
  const plan = planServingPool({ totalMiB: gpu.totalMiB, othersMiB: gpu.usedMiB, share: shareFrom(readServingFit()), projection, extraMiB, trainCtx, slots });
  return plan.fits ? Object.freeze({ ...plan, projection, extraMiB }) : plan;
};

/** The last fit made on this machine (saved, so any process can report it), or null. */
export const lastServingFit = () => readServingFit().lastFit ?? null;
const saveLastFit = (fit) => writeServingFit({ ...readServingFit(), lastFit: fit });

/** impure — the MiB a process holds on the GPU (nvidia-smi), or null. */
const gpuMiBOfPid = async (pid) => {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'], { timeout: 10_000 });
    const row = stdout.trim().split('\n').map((l) => l.split(',').map((v) => Number(v.trim()))).find(([p]) => p === pid);
    return row ? row[1] : null;
  } catch {
    return null;
  }
};

/**
 * impure — once the fitted server is up, measure what it really holds and
 * record the excess over the projection, so the next fit lands exactly.
 */
const calibrateWhenServing = (launch, plan) => {
  let tries = 0;
  const tick = async () => {
    tries += 1;
    const pid = readClaim()?.pid;
    const healthy = await fetch(`http://${launch.host}:${launch.port}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
    const actualMiB = healthy && pid ? await gpuMiBOfPid(pid) : null;
    if (actualMiB) {
      const projectedMiB = plan.projection.baseMiB + plan.projection.perTokenMiB * plan.contextLength;
      recordServingExcess(launch, { actualMiB, projectedMiB });
      saveLastFit({ ...lastServingFit(), actualMiB, measuredAt: new Date().toISOString() });
      log.info('serving fit measured', { pool: plan.contextLength, actualMiB, projectedMiB: Math.round(projectedMiB), plannedMiB: plan.projectedMiB });
      return;
    }
    if (tries < 40) setTimeout(tick, 15_000).unref?.();
  };
  setTimeout(tick, 15_000).unref?.();
};

/**
 * impure — the launch with its pool fitted to this machine, every launch: the
 * size follows the hardware and the operator's saved share, never an
 * environment variable. Never fails a launch: a machine that cannot be
 * measured keeps the configured pool, said in the log.
 */
export const fittedLaunch = async (launch) => {
  if (!launch?.model) return launch;
  try {
    const trainCtx = await modelTrainContext(launch.model);
    const plan = trainCtx ? await fitServingPool(launch, { slots: SERVING_SERVER_SLOTS, trainCtx, mtp: await modelHasMtpHeads(launch.model) }) : null;
    if (!plan?.fits) {
      const reason = plan?.reason ?? 'this machine cannot be measured (no NVIDIA card or llama-fit-params)';
      saveLastFit({ fitted: false, reason, pool: launch.contextLength, model: launch.model, at: new Date().toISOString() });
      log.warn('serving pool not fitted — the configured pool stands', { reason, pool: launch.contextLength });
      return launch;
    }
    const fit = { pool: plan.contextLength, trainCtx, slots: SERVING_SERVER_SLOTS, ceilingMiB: plan.ceilingMiB, plannedMiB: plan.projectedMiB, sharePct: Math.round(shareFrom(readServingFit()) * 100), model: launch.model, at: new Date().toISOString() };
    saveLastFit(fit);
    log.info('serving pool fitted to the machine', fit);
    calibrateWhenServing(launch, plan);
    return validatedServingLaunchConfig({ ...launch, contextLength: plan.contextLength });
  } catch (error) {
    log.warn('serving pool fit failed — the configured pool stands', { error: error.message, pool: launch.contextLength });
    return launch;
  }
};

/** impure — the pool (-c) a running server was launched with, read from its own argv, or null. */
const launchedPool = (pid) => {
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    const at = argv.indexOf('-c');
    const pool = at >= 0 ? Number(argv[at + 1]) : NaN;
    return Number.isSafeInteger(pool) && pool > 0 ? pool : null;
  } catch {
    return null;
  }
};

/**
 * impure — the serving's status as it stands NOW, for the desk: the saved
 * share, the live server's pool and slots, one being's window (the model's
 * trained context), the card's use and the server's part of it, and the last
 * fit (planned against measured). Every field reads live or from the saved
 * record; nothing is remembered in this process.
 * @param {{host: string, port: number, bin?: string}} launch
 */
export const servingFitStatus = async (launch, { gpuIndex = 0 } = {}) => {
  const saved = readServingFit();
  const base = `http://${launch.host}:${launch.port}`;
  const read = (path) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(3000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [props, models, gpu] = await Promise.all([read('/props'), read('/v1/models'), readGpuMemory(gpuIndex)]);
  // llama-server reports each SLOT's window here (it caps a slot at the trained
  // context); the shared pool is the -c the running server was launched with.
  const slotWindow = props?.default_generation_settings?.n_ctx ?? null;
  const trainCtx = models?.data?.[0]?.meta?.n_ctx_train ?? null;
  const pid = readClaim()?.pid ?? null;
  const pool = slotWindow ? (launchedPool(pid) ?? slotWindow) : null;
  const serverMiB = pool && pid ? await gpuMiBOfPid(pid) : null;
  return Object.freeze({
    sharePct: Math.round(shareFrom(saved) * 100),
    shareSaved: Number.isFinite(saved.sharePct),
    measurable: Boolean(fitParamsBinFor(launch.bin)) && Boolean(gpu),
    serving: pool !== null,
    pool,
    slots: props?.total_slots ?? null,
    beingWindow: slotWindow && trainCtx ? Math.min(slotWindow, trainCtx) : slotWindow,
    trainCtx,
    gpu: gpu ? { totalMiB: gpu.totalMiB, usedMiB: gpu.usedMiB, pct: Math.round((gpu.usedMiB / gpu.totalMiB) * 1000) / 10 } : null,
    serverMiB,
    lastFit: saved.lastFit ?? null,
  });
};
