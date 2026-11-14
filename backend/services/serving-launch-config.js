import path from 'node:path';
import { dflashSpeculativeArgs } from './serving-drafter.js';

export const SERVING_CONTEXT_MIN = 512;
/** The largest POOL a launch may ask for: a unified pool sized to the GPU
 *  (serving-fit.js) is shared room, so it may pass one trained window; one
 *  being's window still stops at the model's trained context. */
export const SERVING_CONTEXT_MAX = 4_194_304;
/**
 * The host prompt cache (llama.cpp `--cache-ram`, MiB): OFF (2026-10-13).
 *
 * Measured with scripts/long-session-bench.mjs on this build (745/74ce15741),
 * production argv on a scratch port: with the RAM cache ON, a chat that
 * finished a turn did not keep its slot — its next turn was re-seated in
 * another slot and rebuilt from RAM (GBs copied, one chat after another,
 * every chat's first word held until all were rebuilt: ~5 s per extra chat at
 * 20k tokens, ~14 s at 60k). The server's `cache_idle_slots` (default on)
 * also saved AND CLEARED every idle slot whenever any request started —
 * clearing even when the save failed for size (Founder's 129k chat, 00:25, […], then gone). With
 * the cache OFF every chat is matched to its own slot (LCP), each warm turn
 * starts in ~0.3–0.5 s, alone or together. The cost: no parking in RAM — a
 * chat whose slot a newer chat took re-reads its history.
 *
 * 0 is OFF, never unbounded (-1 was the 116 GB T3 OOM; the default 8192 grows).
 */
export const SERVING_CACHE_RAM_MIB = 0;
/** Standing decode slots over ONE unified KV pool (--kv-unified): slots share
 *  the pool by demand, so a lone being stretches toward the full window and
 *  four working at once divide it — context as a house resource (Founder's ruling
 *  2026-08-15, receipts: docs/work/context-pool-measurement/receipts.jsonl).
 *  Measured cost of 4 slots vs 1 is a flat ~2.4 GB of compute buffers at any
 *  pool size; KV itself scales linearly at 79.1 MiB per 1K pool tokens. */
export const SERVING_PARALLEL_SLOTS = 4;
/** Slots the SERVER holds (--parallel) — more than run at once. The line
 *  (substrate-line.js) still admits SERVING_PARALLEL_SLOTS turns together;
 *  the extra slots only PARK chats: with the RAM cache off, a chat keeps its
 *  history warm only while it holds a slot. Measured 2026-10-14 (6 chats of
 *  30k taking turns 4 at a time, long-session-bench.mjs --rotate): 4 slots
 *  kept 1 of 6 in place — 150k tokens re-read, first word 36 s, 118 s a
 *  round; 6 slots kept all 6 — 234 tokens, 2.5 s, 21 s. Running 5–6 at once
 *  adds no total speed (docs/work/parallel-capacity-truth.md) — 6 hold, 4 run.
 *  Parked chats share the one KV pool; when it fills, llama.cpp clears the
 *  oldest idle slot first. */
export const SERVING_SERVER_SLOTS = 6;
export const SUPERVISED_PROJECTOR_REFUSAL_CODE = 'SUPERVISED_LAUNCH_PROJECTOR_UNATTESTED';

const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;
const CONFIG_FIELDS = Object.freeze([
  'bin',
  'model',
  'mmproj',
  'loras',
  'servingModel',
  'contextLength',
  'host',
  'port',
  'disableCudaGraphs',
  'disableCudaFusion',
  'gpuBinding',
  'placement',
]);
const CHILD_ENV_INPUT_FIELDS = Object.freeze([
  'disableCudaFusion',
  'disableCudaGraphs',
  'gpuBinding',
  'rsReplay',
]);
const CHILD_ENV_FIELDS = Object.freeze([
  'HOME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'CUDA_DEVICE_ORDER',
  'CUDA_VISIBLE_DEVICES',
  'NVIDIA_VISIBLE_DEVICES',
  'GGML_CUDA_DISABLE_GRAPHS',
  'GGML_CUDA_DISABLE_FUSION',
  'LLAMA_RS_REPLAY',
]);

export const SERVING_GPU_BINDING = Object.freeze({
  cudaVisibleDevices: '0',
  nvidiaVisibleDevices: '0',
});
const GPU_UUID = /^GPU-[A-F0-9-]{8,80}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

const exactFields = (value, fields, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...fields].sort().join('\0')) {
    throw new Error(`${label} has unknown or missing fields`);
  }
};

const boundedAbsolutePath = (value, field, { optional = false } = {}) => {
  if (optional && value === '') return '';
  if (typeof value !== 'string' || !value || value !== value.trim()
    || Buffer.byteLength(value, 'utf8') > 4096 || /[\u0000-\u001f\u007f]/u.test(value)
    || !path.isAbsolute(value) || path.normalize(value) !== value) {
    throw new Error(`${field} must be a canonical absolute path`);
  }
  return value;
};

const canonicalInteger = (value, field, minimum, maximum) => {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`${field} must be a canonical decimal integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} is outside its fixed bounds`);
  }
  return parsed;
};

const presentString = (env, field, fallback) => {
  if (env[field] === undefined) return fallback;
  if (typeof env[field] !== 'string' || !env[field]) {
    throw new Error(`${field} must be a non-empty string when present`);
  }
  return env[field];
};

const canonicalFlag = (env, field, fallback) => {
  if (env[field] === undefined) return fallback;
  if (env[field] === '0') return false;
  if (env[field] === '1') return true;
  throw new Error(`${field} must be canonical 0 or 1 when present`);
};

const loopbackEndpoint = (value) => {
  const match = /^http:\/\/(localhost|127\.0\.0\.1):([1-9]\d{0,4})\/?$/u.exec(value);
  if (!match) {
    throw new Error('LLAMA_SERVER_URL must be an exact loopback HTTP endpoint with a port');
  }
  return Object.freeze({
    host: '127.0.0.1',
    port: canonicalInteger(match[2], 'LLAMA_SERVER_URL port', 1, 65_535),
  });
};

const exactGpuBinding = (value) => {
  exactFields(value, ['cudaVisibleDevices', 'nvidiaVisibleDevices'], 'serving GPU binding');
  if (value.cudaVisibleDevices !== SERVING_GPU_BINDING.cudaVisibleDevices
    || value.nvidiaVisibleDevices !== SERVING_GPU_BINDING.nvidiaVisibleDevices) {
    throw new Error('serving GPU binding differs from the scheduled device');
  }
  return SERVING_GPU_BINDING;
};
const physicalGpuBinding = (value) => {
  exactFields(value, [
    'schemaVersion',
    'gpuUuid',
    'cudaVisibleDevices',
    'nvidiaVisibleDevices',
    'deviceDescriptorsSha256',
    'gpuBindingSha256',
  ], 'physical serving GPU binding');
  if (value.schemaVersion !== 1 || !GPU_UUID.test(String(value.gpuUuid || ''))
    || value.cudaVisibleDevices !== value.gpuUuid
    || value.nvidiaVisibleDevices !== value.gpuUuid
    || !SHA256.test(String(value.deviceDescriptorsSha256 || ''))
    || !SHA256.test(String(value.gpuBindingSha256 || ''))) {
    throw new Error('physical serving GPU binding is invalid');
  }
  return value;
};

/**
 * Where the model's layers go: null = every layer on the card (`-ngl 999`); a placement = llama.cpp's
 * own fit (`--fit on`) leaves `fitTargetMiB` free on the card and runs what does not fit from system
 * RAM, never shrinking the pool below `minCtx` (memory-plan.js, docs/work/ram-offload.md). Pure.
 */
const validatedPlacement = (value) => {
  if (value === null) return null;
  exactFields(value, ['fitTargetMiB', 'minCtx'], 'serving placement');
  if (!Number.isSafeInteger(value.fitTargetMiB) || value.fitTargetMiB < 0 || value.fitTargetMiB > 1_048_576
    || !Number.isSafeInteger(value.minCtx) || value.minCtx < SERVING_CONTEXT_MIN || value.minCtx > SERVING_CONTEXT_MAX) {
    throw new Error('serving placement is outside its fixed bounds');
  }
  return Object.freeze({ fitTargetMiB: value.fitTargetMiB, minCtx: value.minCtx });
};

/** Validate and freeze the only configuration shape accepted by args and spawn. Pure. */
export const validatedServingLaunchConfig = (value) => {
  exactFields(value, CONFIG_FIELDS, 'serving launch configuration');
  if (!Number.isSafeInteger(value.contextLength)
    || value.contextLength < SERVING_CONTEXT_MIN || value.contextLength > SERVING_CONTEXT_MAX) {
    throw new Error('serving context length is outside its fixed bounds');
  }
  if (value.host !== '127.0.0.1'
    || !Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65_535
    || typeof value.disableCudaGraphs !== 'boolean'
    || typeof value.disableCudaFusion !== 'boolean'
    || (value.servingModel !== null && (typeof value.servingModel !== 'string'
      || !SAFE_MODEL.test(value.servingModel)))) {
    throw new Error('serving launch identity or endpoint is invalid');
  }
  if (!Array.isArray(value.loras) || value.loras.length > 64) {
    throw new Error('serving adapter paths exceed the fixed bound');
  }
  const loras = Object.freeze(value.loras.map((entry) =>
    boundedAbsolutePath(entry, 'serving adapter path')));
  return Object.freeze({
    bin: boundedAbsolutePath(value.bin, 'LLAMA_SERVER_BIN', { optional: true }),
    model: boundedAbsolutePath(value.model, 'LLAMA_SERVER_MODEL', { optional: true }),
    mmproj: boundedAbsolutePath(value.mmproj, 'LLAMA_SERVER_MMPROJ', { optional: true }),
    loras,
    servingModel: value.servingModel,
    contextLength: value.contextLength,
    host: value.host,
    port: value.port,
    disableCudaGraphs: value.disableCudaGraphs,
    disableCudaFusion: value.disableCudaFusion,
    gpuBinding: exactGpuBinding(value.gpuBinding),
    placement: validatedPlacement(value.placement),
  });
};

/** Resolve one immutable snapshot without permissive numeric or URL fallback. Pure. */
export const resolveServingLaunchConfig = (env) => {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new Error('serving launch environment is invalid');
  }
  const endpoint = loopbackEndpoint(presentString(
    env,
    'LLAMA_SERVER_URL',
    'http://127.0.0.1:8089',
  ));
  // The pool is fitted to the machine at every boot (serving-fit.js); this number is only the
  // fallback for a machine the fit cannot measure ('auto' or unset reads as the default).
  const contextLength = env.SUBSTRATE_CONTEXT_LENGTH === undefined || String(env.SUBSTRATE_CONTEXT_LENGTH).trim().toLowerCase() === 'auto'
    ? 65_536
    : canonicalInteger(
      env.SUBSTRATE_CONTEXT_LENGTH,
      'SUBSTRATE_CONTEXT_LENGTH',
      SERVING_CONTEXT_MIN,
      SERVING_CONTEXT_MAX,
    );
  const servingModel = env.SUBSTRATE_MODEL === undefined ? null : env.SUBSTRATE_MODEL;
  if (servingModel !== null && (typeof servingModel !== 'string' || !SAFE_MODEL.test(servingModel))) {
    throw new Error('SUBSTRATE_MODEL must be a bounded model identity');
  }
  return validatedServingLaunchConfig({
    bin: presentString(env, 'LLAMA_SERVER_BIN', ''),
    model: presentString(env, 'LLAMA_SERVER_MODEL', ''),
    mmproj: presentString(env, 'LLAMA_SERVER_MMPROJ', ''),
    loras: [],
    servingModel,
    contextLength,
    ...endpoint,
    disableCudaGraphs: canonicalFlag(env, 'GGML_CUDA_DISABLE_GRAPHS', true),
    disableCudaFusion: canonicalFlag(env, 'GGML_CUDA_DISABLE_FUSION', true),
    gpuBinding: SERVING_GPU_BINDING,
    // every layer on the card until the fit finds the card too small (serving-fit.js)
    placement: null,
  });
};

/** Would this validated snapshot launch the same server as that one? Identity
 *  over every field that changes what spawns. Pure. */
export const sameServingLaunch = (a, b) => {
  const identity = (c) => JSON.stringify([
    c.model, c.mmproj, c.loras, c.servingModel, c.contextLength, c.host, c.port,
    c.disableCudaGraphs, c.disableCudaFusion, c.gpuBinding, c.placement,
  ]);
  return identity(a) === identity(b);
};

/** Does the route name this launch — the same llama-server loopback host and
 *  port? The attestation reads it as […].
 *  Pure. */
export const routeNamesLaunch = (route, launch) => {
  const endpoint = /^http:\/\/(?:localhost|127\.0\.0\.1):([1-9]\d{0,4})\/?$/u
    .exec(route?.endpoint);
  if (route?.provider !== 'llama-server' || !endpoint || !launch) return false;
  const port = Number(endpoint[1]);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535
    && launch.host === '127.0.0.1' && launch.port === port;
};

/**
 * Speculative decoding from the model's OWN multi-token-prediction heads —
 * set only when the file carries them (gguf-mtp.js reads the fact); on a
 * model without the heads the flag would fail the launch. Measured on this
 * rig 2026-09-25 at the production slot flags: ~38 → 57–73 tok/s.
 * THREE drafted tokens per step (2026-10-05): acceptance falls as the draft
 * grows, but THROUGHPUT is what a reader feels — natural prompts at
 * temperature 0.6, qwen3.8-27B Q8: 1 slot 75.2 → 81.7 tok/s; production
 * layout (4 slots, --kv-unified) 77.8 → 81.7, faster on every prompt. Four
 * won on one slot (84.9) but fell to 66 on a prompt under the production
 * layout; five and six lose.
 */
export const MTP_SPECULATIVE_ARGS = Object.freeze(['--spec-type', 'draft-mtp', '--spec-draft-n-max', '3']);

/**
 * Build native argv from only the validated immutable launch snapshot. Pure.
 * A drafter (serving-drafter.js speculativePlan: present beside the model AND
 * a replay-capable engine) takes the speculative slot; else the MTP heads.
 * @param {Object} config
 * @param {{mtp?: boolean, drafter?: string|null}} [facts] facts read at launch
 */
export const servingLaunchArguments = (config, { mtp = false, drafter = null } = {}) => {
  const cfg = validatedServingLaunchConfig(config);
  const args = ['--model', cfg.model];
  if (cfg.mmproj) args.push('--mmproj', cfg.mmproj);
  args.push(
    '-c', String(cfg.contextLength),
    // every layer on the card, or llama.cpp's own fit spilling the rest to system RAM
    ...(cfg.placement
      ? ['--fit', 'on', '--fit-target', String(cfg.placement.fitTargetMiB), '--fit-ctx', String(cfg.placement.minCtx)]
      : ['-ngl', '999']),
    // Host prompt-cache law: OFF (0) — it re-seated every warm chat through
    // RAM (see SERVING_CACHE_RAM_MIB); never the default (8192, grows) and
    // never -1 (unlimited).
    '--cache-ram', String(SERVING_CACHE_RAM_MIB),
    // One unified KV pool, drawn by demand across the standing slots —
    // without --kv-unified, -np would PARTITION the window into fixed
    // per-slot quarters instead of sharing it. The server holds
    // SERVING_SERVER_SLOTS; the line runs SERVING_PARALLEL_SLOTS of them.
    '--parallel', String(SERVING_SERVER_SLOTS),
    '--kv-unified',
    '--host', cfg.host,
    '--port', String(cfg.port),
    '--metrics',
    // Founder's law 2026-08-15: reasoning a model has is ON by default — the
    // platform never pins a capable model silent. 'auto' (llama.cpp's own
    // default) lets the model's template decide: a thinking model thinks,
    // a plain one is untouched. Thoughts land in reasoning_content, never
    // in the content the stream parses.
    '--jinja', '--reasoning', 'auto',
  );
  if (drafter !== null) {
    args.push(...dflashSpeculativeArgs(boundedAbsolutePath(drafter, 'serving drafter')));
  } else if (mtp === true) {
    args.push(...MTP_SPECULATIVE_ARGS);
  }
  return Object.freeze(args);
};

/** Validate the exact secret-free environment accepted by the native child. Pure. */
const validatedServingChildEnvironment = (value) => {
  exactFields(value, CHILD_ENV_FIELDS, 'serving child environment');
  const gpuUuid = value.CUDA_VISIBLE_DEVICES;
  if (value.HOME !== '/nonexistent' || value.LANG !== 'C.UTF-8'
    || value.LC_ALL !== 'C.UTF-8' || value.TMPDIR !== '/tmp'
    || value.CUDA_DEVICE_ORDER !== 'PCI_BUS_ID'
    || !GPU_UUID.test(String(gpuUuid || ''))
    || value.NVIDIA_VISIBLE_DEVICES !== gpuUuid
    || !['0', '1'].includes(value.GGML_CUDA_DISABLE_GRAPHS)
    || !['0', '1'].includes(value.GGML_CUDA_DISABLE_FUSION)
    || !['0', '1'].includes(value.LLAMA_RS_REPLAY)) {
    throw new Error('serving child environment differs from its physical device authority');
  }
  return Object.freeze({ ...value });
};

/** Minimal exact environment visible to the native model child. Pure. */
export const servingChildEnvironment = (input) => {
  exactFields(input, CHILD_ENV_INPUT_FIELDS, 'serving child environment input');
  if (typeof input.disableCudaGraphs !== 'boolean'
    || typeof input.disableCudaFusion !== 'boolean'
    || typeof input.rsReplay !== 'boolean') {
    throw new Error('serving child environment flags must be boolean');
  }
  const gpu = physicalGpuBinding(input.gpuBinding);
  return validatedServingChildEnvironment({
    HOME: '/nonexistent',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TMPDIR: '/tmp',
    CUDA_DEVICE_ORDER: 'PCI_BUS_ID',
    CUDA_VISIBLE_DEVICES: gpu.cudaVisibleDevices,
    NVIDIA_VISIBLE_DEVICES: gpu.nvidiaVisibleDevices,
    GGML_CUDA_DISABLE_GRAPHS: input.disableCudaGraphs ? '1' : '0',
    GGML_CUDA_DISABLE_FUSION: input.disableCudaFusion ? '1' : '0',
    // Recurrent replay instead of snapshot rollback (llama.cpp PR #31669);
    // engines without it ignore the variable. serving-drafter.js decides.
    LLAMA_RS_REPLAY: input.rsReplay ? '1' : '0',
  });
};

/** Refinement/assent authority is text-only until projector lineage exists. Pure. */
export const assertTextOnlySupervisedLaunch = (config) => {
  const validated = validatedServingLaunchConfig(config);
  if (validated.mmproj) {
    const error = new Error('supervised refinement routes do not have projector authority');
    error.code = SUPERVISED_PROJECTOR_REFUSAL_CODE;
    throw error;
  }
  return validated;
};
