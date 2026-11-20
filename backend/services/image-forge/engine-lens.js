/**
 * ENGINE LENS — the image engine read whole: is it up, what it holds on the
 * card and in memory, which models it last loaded, what it is running and what
 * waits, when it will unload by itself, and what this machine can make.
 *
 * Why the loaded models come from the engine's LOG (found 2026-11-20): ComfyUI
 * 0.41 has no call that lists what it has loaded. /system_stats gives only how
 * much memory its models hold. The engine's own log, served at
 * /internal/logs/raw, names every model as it is staged, with its size and the
 * file it was read from. So "what is loaded" is two honest facts side by side:
 * how much is on the card NOW (measured), and which models the engine last
 * loaded (its recent log, which keeps only its latest lines). When nothing is
 * on the card, the list is what WAS loaded, and says so.
 *
 * Pure parsing and shaping here; one impure read at the foot.
 */
import { readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { comfySupervisorStatus } from './comfyui-supervisor.js';
import { activitySnapshot, isLive } from './forge-activity.js';
import { forgeCapacity } from './forge-capacity.js';
import { probeMachine } from '../machine-probe.js';

const execFileAsync = promisify(execFile);
const MIB = 1048576;
/** Under this much model memory on the card, the engine is holding nothing worth unloading. */
export const HOLDING_MB = 512;

const ROLE_BY_FOLDER = Object.freeze({
  diffusion_models: 'model', checkpoints: 'model', unet: 'model', text_encoders: 'text encoder', clip: 'text encoder',
  vae: 'image decoder', loras: 'lora', controlnet: 'control', clip_vision: 'vision encoder', model_patches: 'patch', upscale_models: 'upscaler',
});
// What a model class is, when its name says so; everything else is the picture model itself.
const roleOfClass = (name) => (/TE|Clip|T5|Text|Encoder/i.test(name) && !/Autoencoder/i.test(name) ? 'text encoder'
  : /Autoencoder|VAE/i.test(name) ? 'image decoder' : 'model');
const plain = (m) => String(m || '').replace(/\u001b\[[0-9;]*m/g, '').replace(/^\[\w+\]\s*/, '').trim();

/**
 * The models the engine staged, read from its own log entries (oldest first).
 * A model staged again replaces its earlier line. Each is paired with the most
 * recent file of the same kind the engine opened before it — a pairing by
 * kind, stated as such by the reader. Pure.
 * @param {Array<{t?:string, m?:string}>} entries - /internal/logs/raw entries
 * @returns {{models:Array<{name:string, role:string, stagedMB:(number|null), file:(string|null), at:(string|null)}>,
 *   lastJobAt:(string|null), lines:number}}
 */
export const parseEngineLoads = (entries) => {
  const files = new Map(); // role → latest file opened
  const models = new Map();
  let pending = null;
  let lastJobAt = null;
  for (const entry of entries || []) {
    const line = plain(entry?.m);
    const at = typeof entry?.t === 'string' ? entry.t : null;
    const opened = /Model storage policy:.*paths=\[(.+)\]/.exec(line);
    if (opened) {
      for (const quoted of opened[1].matchAll(/'([^']+)'/g)) {
        const parts = quoted[1].split('/');
        const role = ROLE_BY_FOLDER[parts[parts.length - 2]] || 'model';
        files.set(role, parts[parts.length - 1]);
      }
      continue;
    }
    const asked = /^Requested to load (\S+)/.exec(line);
    if (asked) { pending = asked[1]; continue; }
    const staged = /^Model (\S+) prepared for dynamic VRAM loading\. (\d+)MB Staged/.exec(line);
    const whole = pending ? /^loaded (?:completely|partially)[^\d]*[\d.e+]+\s+([\d.]+)/.exec(line) : null;
    if (staged || whole) {
      const name = staged ? staged[1] : pending;
      const role = roleOfClass(name);
      models.delete(name);
      models.set(name, { name, role, stagedMB: Math.round(Number(staged ? staged[2] : whole[1])), file: files.get(role) ?? null, at });
      pending = null;
      continue;
    }
    if (/^Prompt executed in/.test(line)) lastJobAt = at;
  }
  return { models: [...models.values()], lastJobAt, lines: (entries || []).length };
};

/** The engine's /queue body → who is running and who waits, by job id. Pure. */
export const parseEngineQueue = (body) => {
  const ids = (rows) => (Array.isArray(rows) ? rows.map((row) => String(row?.[1] ?? '')).filter(Boolean) : []);
  return { running: ids(body?.queue_running), waiting: ids(body?.queue_pending) };
};

/** /system_stats → what the engine's models hold on the card, and the card's own figures. Pure. */
export const parseEngineMemory = (stats) => {
  const device = (stats?.devices || []).find((d) => d?.type === 'cuda') || (stats?.devices || [])[0] || null;
  const mb = (n) => (Number.isFinite(n) ? Math.round(n / MIB) : null);
  return {
    version: stats?.system?.comfyui_version ?? null,
    device: device?.name ?? null,
    modelsOnCardMB: mb(device?.torch_vram_total),
    cardFreeMB: mb(device?.vram_free),
    cardTotalMB: mb(device?.vram_total),
  };
};

const getJson = async (cfg, route) => {
  const res = await fetch(`http://${cfg.host}:${cfg.port}${route}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${route} answered ${res.status}`);
  return res.json();
};
const soft = (promise, fallback = null) => promise.catch(() => fallback);

// impure — what the engine's own process holds: the card memory the driver counts to it, and its system memory.
const processFootprint = async (pid) => {
  if (!Number.isInteger(pid)) return { cardMB: null, ramMB: null };
  const [apps, status] = await Promise.all([
    soft(execFileAsync('nvidia-smi', ['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits'], { timeout: 4000, encoding: 'utf8' }).then((r) => r.stdout), ''),
    soft(readFile(`/proc/${pid}/status`, 'utf8'), ''),
  ]);
  const row = apps.split('\n').map((r) => r.split(',').map((c) => c.trim())).find((c) => Number(c[0]) === pid);
  const rss = /^VmRSS:\s+(\d+)/m.exec(status);
  return { cardMB: row ? Number.parseInt(row[1], 10) : null, ramMB: rss ? Math.round(Number(rss[1]) / 1024) : null };
};

/**
 * Read the engine. Never throws for an engine that is down — that is a state,
 * and it is returned as one. impure.
 * @param {ReturnType<import('./comfyui-config.js').resolveComfyConfig>} cfg
 * @returns {Promise<Object>}
 */
export const readEngineLens = async (cfg, { now = Date.now() } = {}) => {
  const status = await comfySupervisorStatus(cfg);
  const machine = await soft(probeMachine());
  const capacity = machine ? forgeCapacity(machine) : null;
  const base = {
    readAt: new Date(now).toISOString(),
    installed: Boolean(status.install?.installed),
    state: status.state, serving: status.serving,
    owned: status.owned, adopted: status.adopted, foreign: status.foreign,
    port: status.port, pid: status.pid, startedAt: status.startedAt, lastError: status.lastError ?? null,
    ceilings: { cardKeptFreeGB: status.vramHeadroomGb, ramGB: status.ramCeilingGb },
    capacity,
  };
  if (!status.serving) return base;
  const [stats, queue, logs, footprint] = await Promise.all([
    soft(getJson(cfg, '/system_stats')),
    soft(getJson(cfg, '/queue')),
    soft(getJson(cfg, '/internal/logs/raw')),
    processFootprint(status.pid),
  ]);
  const memory = parseEngineMemory(stats);
  const idleFrom = Math.max(status.lastActivityAt ?? 0, status.readySince ?? 0) || null;
  return {
    ...base,
    memory: { ...memory, ...footprint, holding: (memory.modelsOnCardMB ?? 0) >= HOLDING_MB },
    loads: logs ? parseEngineLoads(logs.entries) : null,
    queue: queue ? parseEngineQueue(queue) : null,
    jobs: activitySnapshot().records,
    idle: status.owned && idleFrom ? {
      since: new Date(idleFrom).toISOString(),
      unloadsAt: cfg.idleTtlMs > 0 ? new Date(idleFrom + cfg.idleTtlMs).toISOString() : null,
      stopsAt: cfg.reapTtlMs > 0 ? new Date(idleFrom + cfg.reapTtlMs).toISOString() : null,
      lastUnloadAt: status.lastFreeAt ? new Date(status.lastFreeAt).toISOString() : null,
    } : null,
  };
};

const gb = (mb) => (Number.isFinite(mb) ? `${(mb / 1024).toFixed(1)} GB` : 'unread');
const clock = (iso) => (typeof iso === 'string' ? iso.slice(11, 16) : '—');
const inMinutes = (iso, now) => {
  const m = Math.round((Date.parse(iso) - now) / 60000);
  return m <= 0 ? 'due now' : `in ${m} min`;
};

/**
 * The lens as a being reads it. `full` shows each job on the engine; without
 * it (a house that does not own this computer) only the counts show. Pure.
 * @param {Object} lens - readEngineLens output
 * @param {{full?:boolean, now?:number}} [opts]
 * @returns {string}
 */
export const shapeEngineLens = (lens, { full = true, now = Date.now() } = {}) => {
  if (!lens.installed) return 'IMAGE ENGINE — not installed on this computer. Nothing can be rendered until it is.';
  const out = [];
  if (!lens.serving) {
    out.push(`IMAGE ENGINE — ${lens.state === 'launching' ? 'starting' : 'stopped'}. It holds nothing on the card or in memory.`);
    if (lens.lastError) out.push(`Its last start failed: ${typeof lens.lastError === 'string' ? lens.lastError : lens.lastError.message ?? JSON.stringify(lens.lastError)}`);
    out.push('It starts by itself when a render is filed (image/generate), or now with forge_control {act: "start"}.');
  } else {
    const whose = lens.owned ? 'started by this platform' : lens.adopted ? 'started by hand, watched by this platform' : 'started outside this platform and not under its control';
    out.push(`IMAGE ENGINE — ready (${whose}) on port ${lens.port}${lens.pid ? `, pid ${lens.pid}` : ''}${lens.memory?.version ? `, ComfyUI ${lens.memory.version}` : ''}.`);
    const m = lens.memory || {};
    out.push(`ON THE CARD — its models hold ${gb(m.modelsOnCardMB)}${Number.isFinite(m.cardMB) ? `; the whole engine process holds ${gb(m.cardMB)}` : ''}. The card has ${gb(m.cardFreeMB)} free of ${gb(m.cardTotalMB)}.`);
    out.push(`IN MEMORY — ${gb(m.ramMB)} of system memory${lens.ceilings.ramGB ? ` (it is stopped if it passes ${lens.ceilings.ramGB} GB)` : ''}.`);
    const loads = lens.loads?.models || [];
    if (lens.loads === null) out.push('LOADED — the engine\'s log could not be read, so its models cannot be named.');
    else if (loads.length === 0) out.push(m.holding ? 'LOADED — models are on the card, but the engine\'s recent log no longer names them.' : 'LOADED — nothing: no model has been loaded since the engine\'s recent log began.');
    else {
      out.push(m.holding
        ? 'LOADED — on the card now. Named from the engine\'s own recent log (it has no call that lists them); each file is matched to its model by kind:'
        : 'LOADED — nothing is on the card now. These were the last loaded, and load again on the next render that needs them:');
      for (const model of loads) out.push(`- ${model.name} (${model.role}) — ${model.stagedMB?.toLocaleString('en-US') ?? '?'} MB${model.file ? ` — ${model.file}` : ''} — at ${clock(model.at)}`);
    }
    const q = lens.queue;
    out.push(q ? `QUEUE — ${q.running.length} rendering, ${q.waiting.length} waiting.` : 'QUEUE — could not be read.');
    if (lens.idle) {
      const parts = [
        lens.idle.unloadsAt && m.holding ? `unloads its models by itself ${inMinutes(lens.idle.unloadsAt, now)}` : null,
        lens.idle.stopsAt ? `stops by itself ${inMinutes(lens.idle.stopsAt, now)}` : null,
        lens.idle.lastUnloadAt ? `last unloaded at ${clock(lens.idle.lastUnloadAt)}` : null,
      ].filter(Boolean);
      if (parts.length) out.push(`WHEN IDLE — ${parts.join('; ')}. A render or a waiting job starts the count again.`);
    }
  }
  const jobs = lens.jobs || [];
  if (full && jobs.length) {
    out.push('JOBS (newest first):');
    for (const job of jobs.slice(0, 8)) {
      const pct = isLive(job) && Number.isFinite(job.percent) ? ` ${job.percent}%` : '';
      out.push(`- ${job.jobId} · ${job.phase}${pct}${job.pipelineId ? ` · ${job.pipelineId}` : ''}${job.beingName ? ` · ${job.beingName}` : ''}${job.detail ? ` · ${job.detail}` : ''} · ${clock(new Date(job.updatedAt ?? job.startedAt ?? now).toISOString())}`);
    }
  } else if (!full && jobs.some(isLive)) {
    out.push(`JOBS — ${jobs.filter(isLive).length} in progress. Their detail is shown to the house that owns this computer.`);
  }
  if (lens.capacity) {
    out.push(`THIS MACHINE CAN MAKE — stills: ${lens.capacity.image.ok ? 'yes' : 'no'} (${lens.capacity.image.why}); video: ${lens.capacity.video.ok ? 'yes' : 'no'} (${lens.capacity.video.why}).`);
  }
  out.push(full
    ? 'CONTROL — forge_control {act}: "unload" returns its models\' card memory and keeps the engine up · "stop" ends the engine · "start" brings it up · "cancel" with {job} stops one job · "clear" drops every waiting job. machine_map shows everything else on the card.'
    : 'CONTROL — starting, stopping and unloading the engine belong to the house that owns this computer.');
  return out.join('\n');
};
