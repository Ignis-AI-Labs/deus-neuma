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
import { STT_MODEL, WHISPER_CPP_BUILD, sttEngineFor, sttPlan, sttServerArgs, sttThreads } from './managed-stt-plan.js';

const log = createLogger('ManagedSTT');
const START_MS = 60_000;

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
const cores = () => os.availableParallelism?.() ?? os.cpus().length;

/** Where the server binary and the model are, and whether both are whole on disk. impure */
export const sttFiles = () => {
  const engine = sttEngineFor(process.platform, process.arch);
  const m = STT_MODEL;
  const bin = engine ? path.join(engineDir(), engine.bin) : null;
  const modelPath = path.join(home(), 'models', m.name);
  let modelPresent = false;
  try { modelPresent = fs.statSync(modelPath).size === m.size; } catch { /* absent */ }
  return { engine, bin, modelPath, model: m, installed: Boolean(bin && fs.existsSync(bin)), modelPresent };
};

/** What setting up dictation here takes. impure */
export const currentSttPlan = async () => {
  const f = sttFiles();
  let freeBytes = null;
  try {
    let dir = home();
    while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
    const s = await fsp.statfs(dir);
    freeBytes = s.bavail * s.bsize;
  } catch { /* unmeasurable: the job finds out */ }
  return sttPlan({ platform: process.platform, arch: process.arch, cores: cores(), installed: f.installed, modelPresent: f.modelPresent, freeBytes });
};

/** The readiness the dictation card reads: ready, or the one thing missing and its size. impure */
export const sttReadiness = async () => {
  const plan = await currentSttPlan();
  if (!plan.supported) return Object.freeze({ ready: false, missing: Object.freeze(['unsupported']), engine: 'whisper.cpp', reason: plan.reason });
  return Object.freeze({
    ready: plan.ready,
    missing: Object.freeze(plan.ready ? [] : ['weights']),
    engine: 'whisper.cpp',
    label: `${plan.model.label.toUpperCase()} — RUNS ON YOUR PROCESSOR`,
    bytes: plan.downloadBytes,
  });
};

// ── the setup job ────────────────────────────────────────────────────────────
let job = Object.freeze({ state: 'idle' });
const update = (patch) => { job = Object.freeze({ ...job, ...patch, at: new Date().toISOString() }); };

/** The setup job as the card polls it: idle, running, succeeded or failed. impure (module state) */
export const sttJob = () => job;

const run = async () => {
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
};

/** Start the setup, or answer with the one already running. impure */
export const startSttJob = () => {
  if (job.state === 'running') return job;
  update({ state: 'running', step: 'check', completed: 0, total: 0, error: null, detail: null });
  run().then(() => {
    update({ state: 'succeeded', step: 'done' });
    log.info('dictation set up', { build: WHISPER_CPP_BUILD, model: STT_MODEL.name });
    // set up means ready to speak: the server loads now, not at the first held key
    ensureSttServer().catch((err) => log.warn('the speech server did not start after setup', { error: err.message }));
  }).catch((err) => {
    log.warn('dictation setup stopped', { error: err.message, code: err.code });
    update({ state: 'failed', ...plainFailure(err) });
  });
  return job;
};

// ── the server ───────────────────────────────────────────────────────────────
let server = null; // { child, port, ready: Promise }

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

/** The running server's port: started once, on the processor's share; started again if it died. impure */
export const ensureSttServer = async () => {
  if (server) { await server.ready; return server.port; }
  const f = sttFiles();
  if (!f.installed || !f.modelPresent) throw Object.assign(new Error('dictation is not set up on this machine'), { code: 'STT_COMPONENTS_MISSING' });
  const port = await freePort();
  const child = spawn(f.bin, sttServerArgs({ modelPath: f.modelPath, threads: sttThreads(cores()), port }), {
    cwd: path.dirname(f.bin), env: probeEnvironment(), stdio: 'ignore', windowsHide: true,
  });
  const ready = (async () => {
    for (let t = Date.now(); Date.now() - t < START_MS; await new Promise((r) => setTimeout(r, 300))) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`the speech server stopped while starting (exit ${child.exitCode})`);
      if (await answers(port)) return;
    }
    throw new Error('the speech server did not answer within a minute');
  })();
  server = { child, port, ready };
  child.once('exit', () => { if (server?.child === child) server = null; });
  try {
    await ready;
  } catch (err) {
    stopSttServer();
    throw err;
  }
  log.info('speech server ready', { port, threads: sttThreads(cores()), model: f.model.name });
  return port;
};

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

/**
 * One transcription: 16 kHz WAV in, { text, language, durationSeconds } out. The vocabulary rides as
 * the initial prompt, so domain words are heard rather than repaired later. impure
 * @param {Buffer} wav
 * @param {{prompt?: string}} [opts]
 */
export const transcribeWav = async (wav, { prompt = '' } = {}) => {
  const port = await ensureSttServer();
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0.0');
  if (prompt) form.append('prompt', prompt);
  const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(180_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.text !== 'string') throw new Error(body.error || `the speech server answered ${res.status}`);
  return Object.freeze({ text: body.text.trim(), language: body.language ?? null, durationSeconds: body.duration ?? null });
};

process.once('exit', () => { try { server?.child?.kill(); } catch { /* gone */ } });
