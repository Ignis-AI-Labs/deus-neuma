// managed-stt — dictation on an installed app: whisper.cpp on the processor, set up and run by the
// platform (managed-stt-plan.js decides; this does). impure (network, fs, child processes).
//
// One setup job at a time, polled by the dictation card (the same status shape the old downloader
// answered). THE SERVER STAYS UP, the way ears does (2026-11-12: a held key that waits for a model
// to load is the slowest part of dictation): it starts with the backend once dictation is set up, or when setup finishes, and runs
// until the backend stops, so a held key never waits for a model to load. The base model holds
// about 200 MB of memory. Everything lives under <dataRoot>/speech, never inside the install, which
// is read-only once installed.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getDataRoot } from './data-root.js';
import { obtainArchive, installArchive } from './managed-ollama-download.js';
import { plainFailure } from './managed-ollama-errors.js';
import { probeEnvironment } from './agent-terminal-environment.js';
import { createLogger } from './logger.js';
import { STT_GPU_MODEL, STT_MODEL, WHISPER_CPP_BUILD, sttEngineFor, sttGpuEngineFor, sttPlan, sttServerArgs, sttThreads } from './managed-stt-plan.js';
import { sttDeviceFor } from './managed-stt-device.js';
import { readSttMachine } from './managed-stt-probe.js';

const log = createLogger('ManagedSTT');
const START_MS = 60_000;
// on the card the processor does little: a few threads, never its share
const GPU_THREADS = 4;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Does this machine take the processor engine? Yes wherever the repo's Python speech server is not on
 * disk: every installed app (it ships only engines.json). The house and any dev checkout keep the
 * sidecar, unless NEUMA_STT_ENGINE=managed asks a checkout for the installed app's engine (to try
 * what an installed app does). impure (fs, env)
 */
export const usesManagedStt = () => process.env.NEUMA_STT_ENGINE === 'managed'
  || !fs.existsSync(path.join(REPO_ROOT, 'voice-engines', 'whisper', 'server.py'));

const home = () => path.join(getDataRoot(), 'speech');
const engineDir = () => path.join(home(), `whisper.cpp-${WHISPER_CPP_BUILD}`);
const gpuEngineDir = () => path.join(home(), `whisper.cpp-${WHISPER_CPP_BUILD}-cuda13`);
const cores = () => os.availableParallelism?.() ?? os.cpus().length;

/** One engine and its model: where they are, and whether both are whole on disk. impure */
const fileSet = (engine, dir, m) => {
  const bin = engine ? path.join(dir, engine.bin) : null;
  const modelPath = path.join(home(), 'models', m.name);
  let modelPresent = false;
  try { modelPresent = fs.statSync(modelPath).size === m.size; } catch { /* absent */ }
  return { engine, dir, bin, modelPath, model: m, installed: Boolean(bin && fs.existsSync(bin)), modelPresent };
};

/** The processor's engine and model. impure */
export const sttFiles = () => fileSet(sttEngineFor(process.platform, process.arch), engineDir(), STT_MODEL);

/** The graphics card's engine and model, or null where there is no build for this system. impure */
export const sttGpuFiles = () => {
  const engine = sttGpuEngineFor(process.platform, process.arch);
  return engine ? fileSet(engine, gpuEngineDir(), STT_GPU_MODEL) : null;
};

/** Where dictation runs here and why (managed-stt-device.js), with the CUDA folder it borrows. impure */
export const currentSttDevice = async () => {
  const build = Boolean(sttGpuEngineFor(process.platform, process.arch));
  const machine = build ? await readSttMachine() : { gpu: null, cudaLibDir: null, houseBytes: null };
  return Object.freeze({ ...sttDeviceFor({ build, ...machine }), cudaLibDir: machine.cudaLibDir });
};

/** What setting up dictation here takes. impure */
export const currentSttPlan = async () => {
  const f = sttFiles();
  const g = sttGpuFiles();
  const device = await currentSttDevice();
  let freeBytes = null;
  try {
    let dir = home();
    while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
    const s = await fsp.statfs(dir);
    freeBytes = s.bavail * s.bsize;
  } catch { /* unmeasurable: the job finds out */ }
  const plan = sttPlan({
    platform: process.platform, arch: process.arch, cores: cores(), installed: f.installed, modelPresent: f.modelPresent, freeBytes,
    device: device.device, gpuInstalled: Boolean(g?.installed), gpuModelPresent: Boolean(g?.modelPresent),
  });
  return Object.freeze({ ...plan, why: device.reason });
};

/** The readiness the dictation card reads: ready, or the one thing missing and its size. impure */
export const sttReadiness = async () => {
  const plan = await currentSttPlan();
  if (!plan.supported) return Object.freeze({ ready: false, missing: Object.freeze(['unsupported']), engine: 'whisper.cpp', reason: plan.reason });
  // what answers a held key: the card's pair once it is there, else the processor's; before any setup,
  // what the setup brings
  const onCard = plan.cardReady || (!plan.ready && plan.device === 'gpu');
  const model = onCard ? STT_GPU_MODEL : STT_MODEL;
  return Object.freeze({
    ready: plan.ready,
    missing: Object.freeze(plan.ready ? [] : ['weights']),
    engine: 'whisper.cpp',
    label: `${model.label.toUpperCase()} — RUNS ON YOUR ${onCard ? 'GRAPHICS CARD' : 'PROCESSOR'}`,
    device: onCard ? 'gpu' : 'processor',
    why: plan.why,
    serving: sttServerDevice(),
    bytes: plan.downloadBytes,
    // dictating on the processor while the card has room: the card's pair is offered, never forced
    ...(plan.ready && plan.device === 'gpu' && !plan.cardReady ? {
      upgrade: Object.freeze({ label: `${STT_GPU_MODEL.label.toUpperCase()} — RUNS ON YOUR GRAPHICS CARD`, bytes: plan.downloadBytes, why: plan.why }),
    } : {}),
  });
};

// ── the setup job ────────────────────────────────────────────────────────────
let job = Object.freeze({ state: 'idle' });
const update = (patch) => { job = Object.freeze({ ...job, ...patch, at: new Date().toISOString() }); };

/** The setup job as the card polls it: idle, running, succeeded or failed. impure (module state) */
export const sttJob = () => job;

const run = async ({ processor = false } = {}) => {
  const plan = await currentSttPlan();
  if (!plan.supported) throw Object.assign(new Error(plan.reason), { code: 'UNSUPPORTED' });
  if (!plan.enoughDisk) throw Object.assign(new Error(`need ${plan.needBytes} bytes free`), { code: 'DISK_SPACE' });
  const f = sttFiles();
  await fsp.mkdir(path.join(home(), 'models'), { recursive: true });
  if (!f.installed) {
    update({ step: 'download', completed: 0, total: f.engine.size });
    const archive = path.join(home(), f.engine.name);
    await obtainArchive(f.engine, archive, { onBytes: (n) => update({ completed: n }) });
    await installArchive(f.engine, archive, engineDir());
  }
  if (!f.modelPresent) {
    update({ step: 'pull', completed: 0, total: f.model.size });
    await obtainArchive(f.model, f.modelPath, { onBytes: (n) => update({ completed: n }) });
  }
  const g = plan.device === 'gpu' && !processor ? sttGpuFiles() : null;
  if (g && !g.installed) {
    update({ step: 'download-gpu', completed: 0, total: g.engine.size });
    const archive = path.join(home(), g.engine.name);
    await obtainArchive(g.engine, archive, { onBytes: (n) => update({ completed: n }) });
    await installArchive(g.engine, archive, g.dir);
  }
  if (g && !g.modelPresent) {
    update({ step: 'pull-gpu', completed: 0, total: g.model.size });
    await obtainArchive(g.model, g.modelPath, { onBytes: (n) => update({ completed: n }) });
  }
};

/**
 * Start the setup, or answer with the one already running. `processor` sets up the processor's pair
 * only, and starts the server there: what hearing a recording in a checkout asks for (it never puts
 * a model on the graphics card on its own). impure
 */
export const startSttJob = ({ processor = false } = {}) => {
  if (job.state === 'running') return job;
  update({ state: 'running', step: 'check', completed: 0, total: 0, error: null, detail: null });
  run({ processor }).then(() => {
    update({ state: 'succeeded', step: 'done' });
    log.info('dictation set up', { build: WHISPER_CPP_BUILD, model: STT_MODEL.name });
    // set up means ready to speak: the server loads now, not at the first held key, and one already
    // running on the processor moves to the card if the card's pair just landed
    stopSttServer();
    ensureSttServer({ processor }).catch((err) => log.warn('the speech server did not start after setup', { error: err.message }));
  }).catch((err) => {
    log.warn('dictation setup stopped', { error: err.message, code: err.code });
    update({ state: 'failed', ...plainFailure(err) });
  });
  return job;
};

// ── the server ───────────────────────────────────────────────────────────────
let server = null; // { child, port, ready: Promise, device }
let starting = null; // the start in flight: two holds at once share it

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

const answers = async (port) => {
  try { const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }); return r.status < 500; } catch { return false; }
};

/** Stop the server this process started (the backend going away). impure */
export const stopSttServer = () => {
  if (server?.child && server.child.exitCode === null) server.child.kill();
  server = null;
};

/** Start one server on one engine and model, and wait until it answers. impure */
const startServer = async ({ files, gpu, libDir }) => {
  const port = await freePort();
  const threads = gpu ? GPU_THREADS : sttThreads(cores());
  const base = probeEnvironment();
  // the CUDA 13 runtime is borrowed (managed-stt-probe.js), so the card's server is told where it is
  const env = gpu ? { ...base, LD_LIBRARY_PATH: [libDir, base.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter) } : base;
  const child = spawn(files.bin, sttServerArgs({ modelPath: files.modelPath, threads, port, gpu }), {
    cwd: path.dirname(files.bin), env, stdio: 'ignore', windowsHide: true,
  });
  const ready = (async () => {
    for (let t = Date.now(); Date.now() - t < START_MS; await new Promise((r) => setTimeout(r, 300))) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`the speech server stopped while starting (exit ${child.exitCode})`);
      if (await answers(port)) return;
    }
    throw new Error('the speech server did not answer within a minute');
  })();
  const device = gpu ? 'gpu' : 'processor';
  server = { child, port, ready, device };
  child.once('exit', () => { if (server?.child === child) server = null; });
  try {
    await ready;
  } catch (err) {
    stopSttServer();
    throw err;
  }
  log.info('speech server ready', { port, device, threads, model: files.model.name });
  return port;
};

/**
 * The running server's port: started once and kept, on the graphics card where it has room for the
 * model (and the card's files are set up), else on the processor; a card server that cannot start
 * leaves the processor to answer. Started again if it died. impure
 */
export const ensureSttServer = async ({ processor = false } = {}) => {
  if (server) { await server.ready; return server.port; }
  if (starting) return starting;
  starting = (async () => {
    const cpu = sttFiles();
    if (!cpu.installed || !cpu.modelPresent) throw Object.assign(new Error('dictation is not set up on this machine'), { code: 'STT_COMPONENTS_MISSING' });
    const device = await currentSttDevice();
    const card = device.device === 'gpu' && !processor ? sttGpuFiles() : null;
    if (card?.installed && card.modelPresent) {
      try {
        return await startServer({ files: card, gpu: true, libDir: device.cudaLibDir });
      } catch (err) {
        log.warn('the speech server could not start on the graphics card; the processor answers', { error: err.message });
      }
    }
    return startServer({ files: cpu, gpu: false });
  })().finally(() => { starting = null; });
  return starting;
};

/** Where the running speech server runs ('gpu' | 'processor'), or null when none runs. impure */
export const sttServerDevice = () => server?.device ?? null;

/**
 * At boot: an installed app with dictation set up starts its speech server now, so the first held
 * key is answered as quickly as every later one. Nothing is downloaded here; a machine not set up
 * starts nothing. impure
 * @param {{managed?: boolean}} [opts] - whether this is an installed app (decided once, from disk)
 * @returns {Promise<number|null>|null} the server's port once ready (null if it failed), or null when nothing starts
 */
export const startSttAtBoot = ({ managed = usesManagedStt() } = {}) => {
  if (!managed) return null;
  const f = sttFiles();
  if (!f.installed || !f.modelPresent) return null;
  return ensureSttServer().catch((err) => {
    log.warn('the speech server did not start at boot', { error: err.message });
    return null;
  });
};

// pure — the server's timed segments (verbose_json), in seconds from the recording's start
const segmentsOf = (body) => (Array.isArray(body.segments) ? body.segments : [])
  .map((s) => ({ start: Number(s.start ?? (s.t0 ?? 0) / 100), end: Number(s.end ?? (s.t1 ?? 0) / 100), text: String(s.text ?? '').trim() }))
  .filter((s) => Number.isFinite(s.start) && s.text);

/**
 * One transcription: 16 kHz WAV in, { text, language, durationSeconds, segments } out (segments: the
 * timed pieces, for a recording a neuma watches). The vocabulary rides as the initial prompt, so
 * domain words are heard rather than repaired later. impure
 * @param {Buffer} wav
 * @param {{prompt?: string}} [opts]
 */
export const transcribeWav = async (wav, { prompt = '', processor = false } = {}) => {
  const port = await ensureSttServer({ processor });
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0.0');
  if (prompt) form.append('prompt', prompt);
  const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(180_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.text !== 'string') throw new Error(body.error || `the speech server answered ${res.status}`);
  return Object.freeze({ text: body.text.trim(), language: body.language ?? null, durationSeconds: body.duration ?? null, segments: segmentsOf(body) });
};

process.once('exit', () => { try { server?.child?.kill(); } catch { /* gone */ } });
