import { readFileSync } from 'node:fs';
import os from 'node:os';
import { createLogger } from './logger.js';
import {
  checkedByteProduct,
  checkedByteSum,
  nonnegativeByteBigInt,
  safeByteNumber,
} from './refinement-checked-arithmetic.js';

const log = createLogger('RefinementTrainingWatchdog');
const GIBIBYTE = 1024 ** 3;
const DEFAULT_MEMORY_FLOOR_BYTES = 6 * GIBIBYTE;
const DEFAULT_WATCHDOG_POLL_MS = 5_000;
const DEFAULT_FORGE_MEM_FACTOR = 0.8;
const DEFAULT_FORGE_MEM_HEADROOM_BYTES = 8 * GIBIBYTE;

export const FORGE_MAX_DURATION_MS = 6 * 60 * 60 * 1_000;
export const WATCHDOG_MIN_POLL_MS = 25;
export const WATCHDOG_MAX_POLL_MS = 5_000;

/** Resolve a positive forge duration without permitting the hard ceiling to be disabled or raised. Pure. */
export const resolveForgeDurationMs = (value) => {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return FORGE_MAX_DURATION_MS;
  return Math.min(Math.max(1, Math.floor(duration)), FORGE_MAX_DURATION_MS);
};

/** Keep memory sampling frequent enough to protect the rig and sparse enough to stay cheap. Pure. */
export const resolveWatchdogPollMs = (value) => {
  const pollMs = Number(value);
  if (!Number.isFinite(pollMs) || pollMs <= 0) return DEFAULT_WATCHDOG_POLL_MS;
  return Math.min(
    Math.max(WATCHDOG_MIN_POLL_MS, Math.floor(pollMs)),
    WATCHDOG_MAX_POLL_MS,
  );
};
/** Accept only memory factors at least as conservative as the built-in floor. Pure. */
export const resolveForgeMemoryFactor = (value) => {
  const factor = Number(value);
  return Number.isFinite(factor) && factor >= DEFAULT_FORGE_MEM_FACTOR && factor <= 4
    ? factor
    : DEFAULT_FORGE_MEM_FACTOR;
};

/** Accept only headroom at least as conservative as the built-in eight GiB. Pure. */
export const resolveForgeHeadroomBytes = (valueGb) => {
  const gib = Number(valueGb);
  return Number.isFinite(gib) && gib >= 8 && gib <= 128
    ? gib * GIBIBYTE
    : DEFAULT_FORGE_MEM_HEADROOM_BYTES;
};


const decimalRatio = (value, fallback, minimum, maximum, field) => {
  const numeric = value == null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) {
    throw new Error(`${field} must be finite and within the server-owned bounds`);
  }
  const match = numeric.toString().match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu);
  if (!match) throw new Error(`${field} cannot be represented safely`);
  const fraction = match[2] || '';
  const exponent = Number(match[3] || 0) - fraction.length;
  const digits = BigInt(`${match[1]}${fraction}`);
  return exponent >= 0
    ? Object.freeze({ numerator: digits * (10n ** BigInt(exponent)), denominator: 1n })
    : Object.freeze({ numerator: digits, denominator: 10n ** BigInt(-exponent) });
};

const factorRatio = (value) => decimalRatio(
  value,
  DEFAULT_FORGE_MEM_FACTOR,
  DEFAULT_FORGE_MEM_FACTOR,
  4,
  'forge memory factor',
);

const roundedProduct = (bytes, factor) => {
  const { numerator, denominator } = factorRatio(factor);
  const product = checkedByteProduct(
    bytes,
    numerator,
    BigInt(Number.MAX_SAFE_INTEGER) * denominator,
    'scaled checkpoint bytes',
  );
  return (product + (denominator / 2n)) / denominator;
};

const configuredHeadroomBytes = (headroomBytes) => {
  if (headroomBytes != null) return nonnegativeByteBigInt(headroomBytes, 'headroomBytes');
  const configured = process.env.NEUMA_FORGE_MEM_HEADROOM_GB;
  if (configured == null || configured === '') return BigInt(DEFAULT_FORGE_MEM_HEADROOM_BYTES);
  const { numerator, denominator } = decimalRatio(
    configured,
    8,
    8,
    128,
    'forge memory headroom',
  );
  const product = checkedByteProduct(
    GIBIBYTE,
    numerator,
    BigInt(Number.MAX_SAFE_INTEGER) * denominator,
    'forge memory headroom',
  );
  if (product % denominator !== 0n) {
    throw new Error('forge memory headroom must resolve to an exact byte count');
  }
  return product / denominator;
};


/** Can this machine hold the forge right now? Pure. */
export const forgeMemoryVerdict = ({
  checkpointBytes,
  availableBytes,
  factor = process.env.NEUMA_FORGE_MEM_FACTOR,
  headroomBytes,
}) => {
  const checkpoint = nonnegativeByteBigInt(checkpointBytes, 'checkpointBytes');
  const available = nonnegativeByteBigInt(availableBytes, 'availableBytes');
  const headroom = configuredHeadroomBytes(headroomBytes);
  if (headroom < BigInt(DEFAULT_FORGE_MEM_HEADROOM_BYTES)
    || headroom > BigInt(128 * GIBIBYTE)) {
    throw new Error('headroomBytes must stay within the server-owned bounds');
  }
  const scaledCheckpoint = roundedProduct(checkpoint, factor);
  const required = checkedByteSum(
    scaledCheckpoint,
    headroom,
    Number.MAX_SAFE_INTEGER,
    'forge required memory',
  );
  const shortfall = required > available ? required - available : 0n;
  return Object.freeze({
    fits: shortfall === 0n,
    requiredBytes: safeByteNumber(required, 'requiredBytes'),
    shortfallBytes: safeByteNumber(shortfall, 'shortfallBytes'),
  });
};

/** Parse the kernel's exact kB counter without lossy Number arithmetic. Pure. */
export const parseAvailableMemoryBytes = (meminfo) => {
  if (typeof meminfo !== 'string') throw new Error('MemAvailable input must be text');
  const raw = meminfo.match(/^MemAvailable:\s+(\d+) kB$/m)?.[1];
  if (raw == null || raw.length > 16) throw new Error('MemAvailable is absent or malformed');
  const kb = BigInt(raw);
  return safeByteNumber(
    checkedByteProduct(kb, 1024n, Number.MAX_SAFE_INTEGER, 'MemAvailable'),
    'MemAvailable',
  );
};

/** Read the memory the kernel says is actually reclaimable. impure. */
export const availableMemoryBytes = () => {
  let meminfo = null;
  try {
    meminfo = readFileSync('/proc/meminfo', 'utf8');
  } catch { /* non-Linux hosts use the portable reading below */ }
  if (meminfo !== null) return parseAvailableMemoryBytes(meminfo);
  const portable = os.freemem();
  return safeByteNumber(portable, 'available memory');
};

/** Resolve the memory floor; only the server-owned direct probe override may lower it. Pure. */
export const resolveMemoryFloorBytes = (override, envValue = process.env.NEUMA_FORGE_MEM_FLOOR_GB) => {
  if (Number.isFinite(override) && override > 0) return override;
  const configuredGb = Number(envValue);
  return Number.isFinite(configuredGb) && configuredGb >= 6 && configuredGb <= 256
    ? configuredGb * GIBIBYTE
    : DEFAULT_MEMORY_FLOOR_BYTES;
};

const abortReason = (code, observed, requestedReason) => Object.freeze({
  code,
  message: code === 'MEMORY_PRESSURE'
    ? `The forge stopped itself: available memory fell to ${(observed.lowWaterBytes / GIBIBYTE).toFixed(1)} GB, `
      + `below the ${(observed.floorBytes / GIBIBYTE).toFixed(1)} GB safety floor.`
    : code === 'TRAINING_TIMEOUT'
      ? `The forge stopped itself after ${Math.ceil(observed.elapsedMs / 1_000)} seconds: `
        + `training reached its ${Math.ceil(observed.durationMs / 1_000)}-second wall-clock limit.`
      : requestedReason?.message || 'The operator cancelled this refinement training.',
  observed: Object.freeze(observed),
});

/** Preserve a watchdog abort as a coded error after its child process rejects. Pure. */
const watchdogFailure = (reason) => {
  const error = new Error(reason.message);
  error.code = reason.code;
  error.observed = reason.observed;
  return error;
};

/** Map an aborted child rejection before it can hide the watchdog's coded reason. impure. */
export const runWatchdogStep = async (watchdog, work) => {
  if (watchdog.reason) throw watchdogFailure(watchdog.reason);
  try {
    await work(watchdog.signal);
  } catch (error) {
    if (watchdog.reason) throw watchdogFailure(watchdog.reason);
    throw error;
  }
  if (watchdog.reason) throw watchdogFailure(watchdog.reason);
};

/**
 * Abort one forge signal on either memory pressure or its non-bypassable wall clock.
 * The first reason and its observed state are frozen for failure reporting. impure.
 */
export const startMemoryWatchdog = (options = {}) => {
  const durationMs = resolveForgeDurationMs(
    options.durationMs ?? process.env.NEUMA_FORGE_MAX_DURATION_MS,
  );
  const pollMs = resolveWatchdogPollMs(options.pollMs);
  const floorBytes = resolveMemoryFloorBytes(options.floorBytes);
  const cancellationSignal = options.cancellationSignal;
  const controller = new AbortController();
  const startedAtMs = Date.now();
  const initialAvailableBytes = availableMemoryBytes();
  const state = {
    lastAvailableBytes: initialAvailableBytes,
    lowWaterBytes: initialAvailableBytes,
    reason: null,
    stopped: false,
  };

  const observed = (elapsedMs = Date.now() - startedAtMs) => Object.freeze({
    elapsedMs: Math.max(0, elapsedMs),
    durationMs,
    floorBytes,
    pollMs,
    lastAvailableBytes: state.lastAvailableBytes,
    lowWaterBytes: state.lowWaterBytes,
  });
  const trip = (code, requestedReason) => {
    if (state.reason || state.stopped) return;
    state.reason = abortReason(code, observed(), requestedReason);
    log.error('forge watchdog aborting', {
      code,
      availableBytes: state.reason.observed.lastAvailableBytes,
      floorBytes,
      elapsedMs: state.reason.observed.elapsedMs,
      durationMs,
    });
    controller.abort(state.reason);
  };

  const memoryTimer = setInterval(() => {
    const availableBytes = availableMemoryBytes();
    state.lastAvailableBytes = availableBytes;
    state.lowWaterBytes = Math.min(state.lowWaterBytes, availableBytes);
    if (availableBytes < floorBytes) trip('MEMORY_PRESSURE');
  }, pollMs);
  const durationTimer = setTimeout(() => trip('TRAINING_TIMEOUT'), durationMs);
  const onCancellation = () => trip('TRAINING_CANCELLED', cancellationSignal.reason);
  if (cancellationSignal) {
    if (cancellationSignal.aborted) onCancellation();
    else cancellationSignal.addEventListener('abort', onCancellation, { once: true });
  }
  memoryTimer.unref?.();
  durationTimer.unref?.();

  return Object.freeze({
    signal: controller.signal,
    stop: () => {
      if (state.stopped) return;
      state.stopped = true;
      clearInterval(memoryTimer);
      clearTimeout(durationTimer);
      cancellationSignal?.removeEventListener?.('abort', onCancellation);
    },
    get tripped() { return Boolean(state.reason); },
    get reason() { return state.reason; },
    get observed() { return state.reason?.observed ?? observed(); },
    get lowWater() { return state.lowWaterBytes; },
  });
};
