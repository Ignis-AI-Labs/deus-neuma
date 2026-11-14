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
import { drafterFor, engineSupportsReplay, speculativePlan } from './serving-drafter.js';
import { SERVING_SERVER_SLOTS, validatedServingLaunchConfig } from './serving-launch-config.js';
import { readClaim } from './substrate-claim-registry.js';
import { probeEnvironment } from './agent-terminal-environment.js';
import { SPILL_POOL, fitTargetMiB, parseMeminfo, ramBudgetMiB, ramShareFrom, spillPlan } from './memory-plan.js';

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
 * (the vision projector, the speculative draft), and `extraPerTokenMiB` the
 * part of it that grows with the pool (the MTP draft's own attention layer).
 * @returns {{fits: boolean, contextLength?: number, ceilingMiB: number, projectedMiB?: number, reason?: string}}
 */
export const planServingPool = ({ totalMiB, othersMiB, share, projection, extraMiB = 0, extraPerTokenMiB = 0, trainCtx, slots }) => {
  const ceilingMiB = Math.floor(totalMiB * share);
  const budgetMiB = ceilingMiB - othersMiB - extraMiB - FIT_MARGIN_MIB;
  const perTokenMiB = projection.perTokenMiB + extraPerTokenMiB;
  const fitting = Math.floor((budgetMiB - projection.baseMiB) / perTokenMiB);
  const pool = Math.min(fitting, trainCtx * slots);
  const contextLength = pool - (pool % 256);
  if (!(contextLength >= FIT_MIN_CONTEXT)) {
    return Object.freeze({ fits: false, ceilingMiB, reason: `the model and a ${FIT_MIN_CONTEXT}-token pool need ${Math.ceil(projection.baseMiB + perTokenMiB * FIT_MIN_CONTEXT + extraMiB)} MiB; ${Math.max(0, ceilingMiB - othersMiB)} MiB is free under the share` });
  }
  return Object.freeze({
    fits: true,
    contextLength,
    ceilingMiB,
    projectedMiB: Math.ceil(projection.baseMiB + perTokenMiB * contextLength + extraMiB),
  });
};

/**
 * pure — when the model and the smallest pool do not fit the card's share, the serving that spills:
 * a SPILL_POOL pool (never past every slot at the trained window), what does not fit the card's room
 * in system RAM, inside the RAM budget. llama.cpp places the layers itself (`--fit on`), told to
 * leave free everything above the operator's ceiling plus what it does not count (the excess: the
 * projector, the draft's own buffers) — counted once more than strictly needed, so the card stays
 * under the share and the spill is a little larger, never the other way round.
 * @returns {{fits: true, spill: true, contextLength: number, ceilingMiB: number, projectedMiB: number,
 *   cardMiB: number, ramMiB: number, placement: {fitTargetMiB: number, minCtx: number}}|{fits: false, ceilingMiB: number, reason: string}}
 */
export const planSpill = ({ totalMiB, othersMiB, share, projection, extraMiB = 0, extraPerTokenMiB = 0, trainCtx, slots, ramBudget }) => {
  const ceilingMiB = Math.floor(totalMiB * share);
  const pool = Math.min(SPILL_POOL, trainCtx * slots);
  const contextLength = pool - (pool % 256);
  const needMiB = Math.ceil(projection.baseMiB + (projection.perTokenMiB + extraPerTokenMiB) * contextLength + extraMiB);
  const spill = spillPlan({ needMiB, cardRoomMiB: ceilingMiB - othersMiB - FIT_MARGIN_MIB, ramBudgetMiB: ramBudget });
  if (!spill.fits) return Object.freeze({ fits: false, ceilingMiB, reason: spill.reason });
  return Object.freeze({
    fits: true,
    spill: true,
    contextLength,
    ceilingMiB,
    projectedMiB: needMiB,
    cardMiB: spill.cardMiB,
    ramMiB: spill.ramMiB,
    placement: Object.freeze({ fitTargetMiB: fitTargetMiB({ totalMiB, ceilingMiB, marginMiB: FIT_MARGIN_MIB, uncountedMiB: extraMiB }), minCtx: contextLength }),
  });
};

/** impure — the machine's total and available RAM (MiB), or null where it cannot be read. */
export const readRamMemory = () => {
  try {
    return parseMeminfo(readFileSync('/proc/meminfo', 'utf8'));
  } catch {
    return null;
  }
};

/** impure — the card's total and used MiB (nvidia-smi), or null where it cannot answer. */
export const readGpuMemory = async (index = 0) => {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['-i', String(index), '--query-gpu=memory.total,memory.used', '--format=csv,noheader,nounits'], { timeout: 10_000, env: probeEnvironment() });
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
  const { stdout } = await execFileAsync(bin, ['-m', model, '-c', String(ctx), '--parallel', String(slots), '-ngl', '999', '--fit-print', 'on'], { timeout: 120_000, maxBuffer: 4 * MiB, env: probeEnvironment() });
  return Object.freeze({ ctx, totalMiB: projectedGpuMiB(stdout) });
};

/**
 * What the server holds beyond llama.cpp's projection, measured part by part
 * (2026-11-09, neuma-research inference-speed/runs/fitprobe-*: T4-IQ3_M, the
 * production argv, 16K and 64K pools; each part switched on alone, and the
 * parts add up): ~230 MiB on its own; the vision projector its file + ~250;
 * the MTP draft ~3.3 GB fixed (its own compute) plus ~4.4 KiB per pool token
 * (its one attention layer, estimatedExtraPerTokenMiB). The guess it replaces
 * (projector + 1,536 + 4,096, read off one 262k house boot) overstated a small
 * card by ~2 GB, so a 24 or 32 GB card "did not fit" and fell back to the
 * configured pool, which no longer fit at all. A first boot estimates; after a
 * boot the measured excess is recorded and used.
 * @returns {number} MiB, the part that does not grow with the pool
 */
export const estimatedExtraMiB = ({ mmprojMiB = 0, mtp = false, drafterMiB = 0 }) =>
  256 + (mmprojMiB > 0 ? mmprojMiB + 256 : 0) + (mtp ? 3328 : 0) + (drafterMiB > 0 ? drafterMiB + 2048 : 0);

/**
 * The part of the excess that grows with the pool, per token: ~0.9 KiB on its
 * own, ~4.4 KiB more with the MTP draft (measured as above). Pure.
 * @returns {number} MiB per pool token
 */
export const estimatedExtraPerTokenMiB = ({ mtp = false }) => (0.9 + (mtp ? 4.4 : 0)) / 1024;

// The machine's serving choices and measurements, beside its model selection
// (~/.neuma/substrate-selection.json): { sharePct, calibration: { [launch]: {extraMiB, at} } }.
const FIT_FILE = () => join(process.env.NEUMA_SUBSTRATE_CLAIM_DIR || join(homedir(), '.neuma'), 'serving-fit.json');
// A DFlash launch holds a different set of buffers, so it calibrates under its
// own key; MTP and plain launches keep the original key (no recalibration).
const calibrationKey = (launch, speculative = 'mtp') =>
  `${launch.model}|${launch.mmproj || ''}${speculative === 'dflash' ? '|dflash' : ''}`;

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

/** impure — save the operator's share of system RAM a spilled model may take (a percent, 20-80). */
export const saveServingRamShare = (ramSharePct) => {
  const pct = Number(ramSharePct);
  if (!Number.isInteger(pct) || pct < 20 || pct > 80) throw new Error('the RAM share is a whole percent from 20 to 80');
  writeServingFit({ ...readServingFit(), ramSharePct: pct });
  return pct;
};

/** impure — the measured excess for this launch, or null. */
const calibratedExtraMiB = (launch, speculative) => {
  const value = readServingFit().calibration?.[calibrationKey(launch, speculative)]?.extraMiB;
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/** impure — record what a healthy server really holds beyond the projection (the next fit uses it). */
export const recordServingExcess = (launch, { actualMiB, projectedMiB, speculative }) => {
  if (!Number.isFinite(actualMiB) || !Number.isFinite(projectedMiB)) return;
  const saved = readServingFit();
  const calibration = { ...saved.calibration, [calibrationKey(launch, speculative)]: { extraMiB: Math.max(0, Math.round(actualMiB - projectedMiB)), at: new Date().toISOString() } };
  writeServingFit({ ...saved, calibration });
};

/**
 * impure — size the pool for this launch: null when this machine cannot be
 * measured (no NVIDIA card, no llama-fit-params) — the configured pool stands.
 * @param {{bin: string, model: string, mmproj?: string}} launch
 */
export const fitServingPool = async (launch, { slots, trainCtx, mtp = false, drafterMiB = 0, speculative = 'mtp', gpuIndex = 0 }) => {
  const bin = fitParamsBinFor(launch.bin);
  const gpu = await readGpuMemory(gpuIndex);
  if (!bin || !gpu || !launch.model) return null;
  const projection = linearProjection(await projectAt(bin, launch.model, slots, FIT_MIN_CONTEXT), await projectAt(bin, launch.model, slots, trainCtx));
  const mmprojMiB = launch.mmproj && existsSync(launch.mmproj) ? Math.ceil(statSync(launch.mmproj).size / MiB) : 0;
  // a calibrated excess was measured whole at this machine's own pool; an estimate grows with the pool
  const calibrated = calibratedExtraMiB(launch, speculative);
  const extraMiB = calibrated ?? estimatedExtraMiB({ mmprojMiB, mtp, drafterMiB });
  const extraPerTokenMiB = calibrated === null ? estimatedExtraPerTokenMiB({ mtp }) : 0;
  const saved = readServingFit();
  const inputs = { totalMiB: gpu.totalMiB, othersMiB: gpu.usedMiB, share: shareFrom(saved), projection, extraMiB, extraPerTokenMiB, trainCtx, slots };
  const plan = planServingPool(inputs);
  if (plan.fits) return Object.freeze({ ...plan, projection, extraMiB });
  // The card cannot hold it: the rest from system RAM, inside the RAM share (memory-plan.js).
  const ram = readRamMemory();
  if (!ram) return plan;
  const spill = planSpill({ ...inputs, ramBudget: ramBudgetMiB(ram, ramShareFrom(saved)) });
  return spill.fits ? Object.freeze({ ...spill, projection, extraMiB }) : Object.freeze({ ...plan, reason: `${plan.reason}; ${spill.reason}` });
};

/** The last fit made on this machine (saved, so any process can report it), or null. */
export const lastServingFit = () => readServingFit().lastFit ?? null;
const saveLastFit = (fit) => writeServingFit({ ...readServingFit(), lastFit: fit });

/** impure — the MiB a process holds on the GPU (nvidia-smi), or null. */
const gpuMiBOfPid = async (pid) => {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'], { timeout: 10_000, env: probeEnvironment() });
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
const calibrateWhenServing = (launch, plan, speculative) => {
  let tries = 0;
  const tick = async () => {
    tries += 1;
    const pid = readClaim()?.pid;
    const healthy = await fetch(`http://${launch.host}:${launch.port}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
    const actualMiB = healthy && pid ? await gpuMiBOfPid(pid) : null;
    if (actualMiB) {
      const projectedMiB = plan.projection.baseMiB + plan.projection.perTokenMiB * plan.contextLength;
      recordServingExcess(launch, { actualMiB, projectedMiB, speculative });
      saveLastFit({ ...lastServingFit(), actualMiB, measuredAt: new Date().toISOString() });
      log.info('serving fit measured', { pool: plan.contextLength, actualMiB, projectedMiB: Math.round(projectedMiB), plannedMiB: plan.projectedMiB });
      return;
    }
    if (tries < 40) setTimeout(tick, 15_000).unref?.();
  };
  setTimeout(tick, 15_000).unref?.();
};

/**
 * impure — the speculative facts the fit needs: the same plan the spawn takes
 * (serving-drafter.js), with the drafter's size when DFlash is chosen.
 * @param {{bin: string, model: string}} launch
 */
const launchSpeculation = async (launch) => {
  const mtp = await modelHasMtpHeads(launch.model);
  const drafter = await drafterFor(launch.model);
  const plan = speculativePlan({ mtp, drafter, replay: (mtp || drafter !== null) && await engineSupportsReplay(launch.bin) });
  const drafterMiB = plan.kind === 'dflash' && existsSync(plan.drafter) ? Math.ceil(statSync(plan.drafter).size / MiB) : 0;
  return { mtp: plan.kind === 'mtp', drafterMiB, speculative: plan.kind };
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
    const spec = await launchSpeculation(launch);
    const plan = trainCtx ? await fitServingPool(launch, { slots: SERVING_SERVER_SLOTS, trainCtx, ...spec }) : null;
    if (!plan?.fits) {
      const reason = plan?.reason ?? 'this machine cannot be measured (no NVIDIA card or llama-fit-params)';
      saveLastFit({ fitted: false, reason, pool: launch.contextLength, model: launch.model, at: new Date().toISOString() });
      log.warn('serving pool not fitted — the configured pool stands', { reason, pool: launch.contextLength });
      return launch;
    }
    const fit = { pool: plan.contextLength, trainCtx, slots: SERVING_SERVER_SLOTS, ceilingMiB: plan.ceilingMiB, plannedMiB: plan.projectedMiB, sharePct: Math.round(shareFrom(readServingFit()) * 100), model: launch.model, at: new Date().toISOString(),
      ...(plan.spill ? { spill: true, cardMiB: plan.cardMiB, ramMiB: plan.ramMiB, ramSharePct: Math.round(ramShareFrom(readServingFit()) * 100) } : {}) };
    saveLastFit(fit);
    if (plan.spill) {
      // the excess is measured against a whole-card projection; a spilled serving would record nonsense
      log.info('serving spills to system RAM — the card cannot hold it', fit);
      return validatedServingLaunchConfig({ ...launch, contextLength: plan.contextLength, placement: plan.placement });
    }
    log.info('serving pool fitted to the machine', fit);
    calibrateWhenServing(launch, plan, spec.speculative);
    return validatedServingLaunchConfig({ ...launch, contextLength: plan.contextLength, placement: null });
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
  const ram = readRamMemory();
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
    ramSharePct: Math.round(ramShareFrom(saved) * 100),
    ram: ram ? { totalMiB: ram.totalMiB, availableMiB: ram.availableMiB, budgetMiB: ramBudgetMiB(ram, ramShareFrom(saved)) } : null,
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
