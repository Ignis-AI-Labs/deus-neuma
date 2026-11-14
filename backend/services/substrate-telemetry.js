/**
 * Substrate telemetry — the aggregated live lens behind the SUBSTRATE HUD.
 *
 * Gathers, in one shot, everything the desk needs to watch the engine room:
 * the active model + its sampling settings, generation throughput, slot/KV
 * state, GPU load, the processes holding VRAM, the supervisor's own state, and
 * the recent failures feed. Nothing here mutates the substrate — it is a lens.
 *
 * Pure parsers (Prometheus/props/slots/gpu text → structured data) are split
 * from the impure fetch/exec boundary (RULE 0): the parsers are unit-provable,
 * the aggregator is proven live against the real server + GPU.
 */
import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import os from 'os';
import { promisify } from 'util';
import { getConfig } from './llm-provider.js';
import { activeLaunchConfig, supervisorStatus } from './llama-server-supervisor.js';
import { substrateModelView } from './substrate-model-view.js';
import { getRecentIssues } from './logger.js';
import { readClaim } from './substrate-claim-registry.js';
import { createRateLens, lifetimeRates } from './token-throughput.js';
import { replyPerformance } from './reply-meter.js';

const execFileAsync = promisify(execFile);
const rateLens = createRateLens(); // impure — the previous /slots read, for the live rates
// No logger here by design: every probe degrades to null/[] (a dead source is
// an honest "not serving" snapshot, not an error), so there is nothing to log.
const PROBE_MS = 2500;

// --- pure parsers ---

/** Prometheus text-exposition → { metricName: number } (labels stripped). Pure. */
export const parsePrometheus = (text) => {
  const out = Object.create(null);
  if (!text) return out;
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    const key = line.slice(0, sp).replace(/\{.*\}/, '');
    const val = Number(line.slice(sp + 1));
    if (Number.isFinite(val)) out[key] = val;
  }
  return out;
};

/**
 * llama.cpp metric map + the live rates → the activity numbers the HUD shows.
 * The rates are token-throughput.js's, measured between reads — never the
 * server's *_tokens_seconds gauges, which move only when a request finishes
 * and reset on every read (they read 0.0 through a whole reply). Pure.
 * @param {Object<string, number>} m
 * @param {{genTokPerSec: number, promptTokPerSec: number}|null} [live]
 */
export const summarizeActivity = (m, live = null) => Object.freeze({
  genTokPerSec: live?.genTokPerSec ?? null,
  promptTokPerSec: live?.promptTokPerSec ?? null,
  kvUsage: m['llamacpp:kv_cache_usage_ratio'] ?? null,
  kvTokens: m['llamacpp:kv_cache_tokens'] ?? null,
  requestsProcessing: m['llamacpp:requests_processing'] ?? null,
  requestsDeferred: m['llamacpp:requests_deferred'] ?? null,
  promptTokensTotal: m['llamacpp:prompt_tokens_total'] ?? null,
  predictedTokensTotal: m['llamacpp:tokens_predicted_total'] ?? null,
});

/**
 * Fill kvUsage/kvTokens from slot state when the running llama.cpp build omits
 * the kv_cache gauges from /metrics (verified live 2026-07-10: this rig's
 * build-cuda exposes neither kv_cache_usage_ratio nor kv_cache_tokens — the
 * HUD's KV meter would be dead forever without this). Slot fill (last prompt
 * tokens over per-slot ctx) is the honest stand-in for context pressure. Pure.
 * @param {ReturnType<typeof summarizeActivity>} activity
 * @param {ReturnType<typeof summarizeSlots>} slots
 */
export const withKvFromSlots = (activity, slots) => {
  if (activity.kvUsage != null || !slots.total) return activity;
  const ctx = slots.slots.reduce((n, s) => n + (s.ctx ?? 0), 0);
  const used = slots.slots.reduce((n, s) => n + s.used, 0);
  return Object.freeze({ ...activity, kvTokens: used, kvUsage: ctx > 0 ? used / ctx : null });
};

/** /props default_generation_settings → active sampling settings. Pure. */
export const parseSampling = (props) => {
  const p = props?.default_generation_settings?.params;
  if (!p) return null;
  return Object.freeze({
    temperature: p.temperature ?? null,
    topP: p.top_p ?? null,
    topK: p.top_k ?? null,
    minP: p.min_p ?? null,
    repeatPenalty: p.repeat_penalty ?? null,
    maxTokens: p.n_predict ?? null,
  });
};

/** /slots array → { total, busy, slots:[{id, ctx, used, processing}] }. Pure. */
export const summarizeSlots = (slots) => {
  const arr = Array.isArray(slots) ? slots : [];
  return Object.freeze({
    total: arr.length,
    busy: arr.filter((s) => s.is_processing).length,
    slots: Object.freeze(arr.map((s) => Object.freeze({
      id: s.id,
      ctx: s.n_ctx ?? null,
      used: s.n_prompt_tokens ?? 0,
      processing: Boolean(s.is_processing),
    }))),
  });
};

/** nvidia-smi --query-gpu csv row → gpu load. Pure. Null on missing input. */
// One nvidia-smi field, or null — unified-memory silicon (GB10, Jetson,
// DGX Spark) answers "[N/A]" for the VRAM trio while util/temp/power are
// real. A field the DRIVER cannot state is null, never NaN, and never
// reason to discard the fields it CAN state.
const smiNum = (s) => {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/** nvidia-smi --query-gpu csv row → gpu load. Pure. Null on missing input. */
export const parseGpu = (csv) => {
  if (!csv || !csv.trim()) return null;
  const [used, total, util, temp, power] = csv.trim().split('\n')[0].split(',').map((s) => s.trim());
  const usedMB = smiNum(used);
  const totalMB = smiNum(total);
  return Object.freeze({
    usedMB,
    totalMB,
    freeMB: usedMB !== null && totalMB !== null ? totalMB - usedMB : null,
    utilPct: smiNum(util),
    tempC: smiNum(temp),
    powerW: smiNum(power),
    unified: false,
  });
};

/**
 * Fill unified-memory silicon's missing VRAM trio from the machine's own
 * memory truth (/proc/meminfo text): on a GB10 the GPU's memory IS system
 * memory. Applied only when the driver declined to state the trio — a
 * discrete card's real numbers are never overwritten. Pure.
 * @param {ReturnType<typeof parseGpu>} gpu
 * @param {string|null} meminfoText
 */
export const withUnifiedMemory = (gpu, meminfoText) => {
  if (!gpu || gpu.totalMB !== null || !meminfoText) return gpu;
  const kb = (key) => {
    const m = meminfoText.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return m ? Number(m[1]) : null;
  };
  const totalKB = kb('MemTotal');
  const availKB = kb('MemAvailable');
  if (totalKB === null || availKB === null) return gpu;
  const totalMB = Math.round(totalKB / 1024);
  const usedMB = Math.round((totalKB - availKB) / 1024);
  return Object.freeze({
    ...gpu, totalMB, usedMB, freeMB: totalMB - usedMB, unified: true,
  });
};

/**
 * The machine's RAM from /proc/meminfo text — used is what the kernel cannot
 * hand back (MemTotal - MemAvailable), so page cache never reads as pressure.
 * Falls back to Node's own totals where /proc is absent (macOS, Windows). Pure.
 * @param {string|null} meminfoText
 * @param {{ totalBytes?: number, freeBytes?: number }} [fallback]
 */
export const parseRam = (meminfoText, { totalBytes = null, freeBytes = null } = {}) => {
  const kb = (key) => {
    const m = meminfoText?.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return m ? Number(m[1]) : null;
  };
  const mb = (k) => (k === null ? null : Math.round(k / 1024));
  const totalMB = mb(kb('MemTotal')) ?? (Number.isFinite(totalBytes) ? Math.round(totalBytes / 1048576) : null);
  const availMB = mb(kb('MemAvailable')) ?? (Number.isFinite(freeBytes) ? Math.round(freeBytes / 1048576) : null);
  const swapTotalMB = mb(kb('SwapTotal'));
  const swapFreeMB = mb(kb('SwapFree'));
  return Object.freeze({
    totalMB,
    usedMB: totalMB !== null && availMB !== null ? totalMB - availMB : null,
    availableMB: availMB,
    swapTotalMB,
    swapUsedMB: swapTotalMB !== null && swapFreeMB !== null ? swapTotalMB - swapFreeMB : null,
  });
};

/**
 * The model server's own RAM from /proc/<pid>/status and its command line.
 * `anonMB` is the memory the server itself allocated — the parked prompt cache
 * lives there — not the mapped model file the kernel can drop. `cacheLimitMB` is
 * the --cache-ram the RUNNING server was started with (a changed setting reaches
 * it only at its next start). Pure.
 * @param {string|null} statusText
 * @param {string|null} cmdline - NUL- or space-separated argv
 */
export const parseServerRam = (statusText, cmdline) => {
  const kb = (key) => {
    const m = statusText?.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return m ? Number(m[1]) : null;
  };
  const anon = kb('RssAnon');
  const argv = String(cmdline || '').split(/[\0\s]+/);
  const at = argv.indexOf('--cache-ram');
  const limit = at >= 0 ? Number(argv[at + 1]) : NaN;
  return Object.freeze({
    anonMB: anon === null ? null : Math.round(anon / 1024),
    cacheLimitMB: Number.isFinite(limit) ? limit : null,
  });
};

/** The binary basename from a full process command string. Pure. */
export const shortProcessName = (raw) => {
  const first = (raw || '').trim().split(/\s+/)[0];
  return first.split('/').pop() || first || 'unknown';
};

/** nvidia-smi --query-compute-apps csv → [{pid, name, memMB}] on-GPU procs. Pure. */
export const parseComputeApps = (csv) => {
  if (!csv || !csv.trim()) return [];
  return csv.trim().split('\n').map((row) => {
    const [pid, name, mem] = row.split(',').map((s) => s.trim());
    return Object.freeze({ pid: Number(pid), name: shortProcessName(name), memMB: Number(mem) || 0 });
  }).filter((p) => Number.isFinite(p.pid));
};

// --- impure boundary ---

const fetchText = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_MS) });
    return res.ok ? await res.text() : null;
  } catch { return null; }
};
const fetchJson = async (url) => {
  const text = await fetchText(url);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
};

const nvidiaSmi = async (args) => {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', args, { timeout: PROBE_MS, encoding: 'utf8' });
    return stdout;
  } catch { return null; }
};

/**
 * One aggregated telemetry snapshot for the SUBSTRATE HUD. Impure — probes the
 * live server + GPU. Every field degrades to null/[] when a source is down, so
 * a dead substrate yields an honest "not serving" snapshot, never a throw.
 */
export const getSubstrateTelemetry = async () => {
  const cfg = getConfig();
  const launchCfg = activeLaunchConfig(process.env);
  const base = `http://${launchCfg.host}:${launchCfg.port}`;

  const [props, metricsText, slots, gpuCsv, appsCsv, sup, modelView, meminfo] = await Promise.all([
    fetchJson(`${base}/props`),
    fetchText(`${base}/metrics`),
    fetchJson(`${base}/slots`),
    nvidiaSmi(['--query-gpu=memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw', '--format=csv,noheader,nounits']),
    nvidiaSmi(['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits']),
    supervisorStatus(launchCfg).catch(() => null),
    substrateModelView(process.env).catch(() => null),
    // Unified-memory silicon's VRAM truth lives in the machine's own memory
    // accounting — read alongside, used only when the driver said [N/A].
    readFile('/proc/meminfo', 'utf8').catch(() => null),
  ]);
  // The server's own memory, by the pid its claim names — null off Linux or when
  // no NEUMA server is up.
  const pid = readClaim()?.pid;
  const [serverStatus, serverCmdline] = pid
    ? await Promise.all([
      readFile(`/proc/${pid}/status`, 'utf8').catch(() => null),
      readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => null),
    ])
    : [null, null];

  const metrics = parsePrometheus(metricsText);
  return Object.freeze({
    provider: cfg.provider,
    endpoint: base,
    serving: Boolean(sup?.serving),
    owned: Boolean(sup?.owned),
    model: modelView?.name || modelView?.served || modelView?.active || null,
    contextLength: launchCfg.contextLength,
    adapters: launchCfg.loras,
    sampling: parseSampling(props),
    activity: withKvFromSlots(summarizeActivity(metrics, rateLens(slots, performance.now())), summarizeSlots(slots)),
    // Every token rate the panel can show: per reply by phase, the last few, and since the server started.
    tokens: Object.freeze({ ...replyPerformance(performance.now()), lifetime: lifetimeRates(metrics) }),
    slots: summarizeSlots(slots),
    gpu: withUnifiedMemory(parseGpu(gpuCsv), meminfo),
    processes: parseComputeApps(appsCsv),
    ram: Object.freeze({
      ...parseRam(meminfo, { totalBytes: os.totalmem(), freeBytes: os.freemem() }),
      server: parseServerRam(serverStatus, serverCmdline),
    }),
    supervisor: sup ? { startedAt: sup.startedAt, lastError: sup.lastError, launch: sup.launch } : null,
    failures: getRecentIssues(30),
    at: new Date().toISOString(),
  });
};
