// managed-ollama — set up a local model server for a person who has none, and keep it running.
// impure (network, fs, child processes). The decisions are in managed-ollama-plan.js (pure); the
// archive is fetched and unpacked by managed-ollama-download.js; the words are managed-ollama-errors.js.
//
// One job at a time, observed by polling (GET /api/v1/model-server/status):
//   check    → the plan, read from this machine
//   download → the pinned Ollama build, resumable, SHA-256 checked on disk before anything runs it
//   unpack   → under <home>/ollama (no admin rights, nothing system-wide)
//   start    → `ollama serve` on its own loopback port, models kept under <home>/models
//   pull     → the model the capacity check recommends, straight from Hugging Face
//   verify   → the model answers a real message (it is loaded, and it speaks)
//   adopt    → the platform's mind becomes that server and model, persisted (provider-choice.js)
// A step that fails is tried again by the job itself before a person is told (one sentence, one act).
// An Ollama already on the machine is used as it is when it is new enough: started if it is
// installed but not running, never downloaded twice. A server the setup started is started again at
// every boot (startManagedAtBoot) and stopped with the backend.
//
// ONE JOB, EVEN AT TWO PRESSES (2026-10-23): the job used to be marked running only after the plan
// was read, so two presses started two jobs: one .part written twice (the […] a person saw), a twin that finished behind a "failed" screen, and one
// record tmp renamed by both ("ENOENT … managed.json.<pid>.tmp"). The job is now running from the
// instant it is asked for.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { getDataRoot } from './data-root.js';
import { readManagedRecord, servedOllamaWindow, writeManagedRecord } from './managed-ollama-record.js';
import { obtainArchive, installArchive } from './managed-ollama-download.js';
import { isFinal, plainFailure, setupFailure } from './managed-ollama-errors.js';
import { createLogger } from './logger.js';
import { withoutBackendSecrets } from './agent-terminal-environment.js';
import { getSetupStatus } from './substrate-setup.js';
import { loadProviderChoice, saveProviderChoice } from './provider-choice.js';
import { getConfig, setConfig } from './llm-provider.js';
import { sameEndpoint } from './provider-discovery.js';
import { currentDriverGuard, fitManagedWindow, saveGpuAnyway } from './managed-ollama-gpu.js';
import { _resetCapsCache } from './llm-runtime-cache.js';
import {
  MIN_OLLAMA_VERSION, OLLAMA_VERSION, installPlan, managedEndpoints, managedServeEnv, ollamaAssetFor, pullProgress, setupDoneLine, versionAtLeast,
} from './managed-ollama-plan.js';

export { obtainArchive } from './managed-ollama-download.js';

const log = createLogger('ManagedOllama');
// the whole job, tried again once by itself (a download inside it is tried three times on its own)
const JOB_TRIES = 2;
// a port the platform's own server may move to when its own is held by another server
const PORT_STEPS = 10;

// impure — the platform's own endpoints, read at call time: 127.0.0.1:11434 unless
// NEUMA_OLLAMA_ENDPOINT moves the platform's server to a port of its own
const endpoints = () => managedEndpoints(process.env.NEUMA_OLLAMA_ENDPOINT);

// impure — read at call time (packaged vs dev data roots)
const root = () => path.join(getDataRoot(), 'model-server');
// Where the server and the models are kept: the folder the person chose in the installer (kept in
// the record), else beside the record. Models are large, so this is the person's choice.
let chosenHome = null;
const serverHome = () => chosenHome || readManagedRecord()?.home || root();
const modelsDir = () => path.join(serverHome(), 'models');
const managedBin = () => {
  const asset = ollamaAssetFor(process.platform, process.arch);
  return asset ? path.join(serverHome(), 'ollama', asset.bin) : null;
};

/** The record of what the platform set up, or null. impure */
export const readRecord = readManagedRecord;

/** An Ollama installed on this machine outside the platform, or null. impure */
export const findSystemOllama = () => {
  const candidates = ['ollama'];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
  }
  for (const bin of candidates) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (r.status === 0) return { bin, version: (`${r.stdout}${r.stderr}`.match(/(\d+\.\d+\.\d+)/) || [])[1] || null };
  }
  return null;
};

/** What answers at an Ollama endpoint: up, its version, the models it holds. impure */
export const serverState = async (endpoint = endpoints().usual) => {
  try {
    const v = await fetch(`${endpoint}/api/version`, { signal: AbortSignal.timeout(2000) });
    if (!v.ok) return { up: false, version: null, models: [] };
    const { version = null } = await v.json().catch(() => ({}));
    const t = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    const models = t?.ok ? ((await t.json().catch(() => ({}))).models || []).map((m) => m.name) : [];
    return { up: true, version, models };
  } catch { return { up: false, version: null, models: [] }; }
};

/** Is an Ollama answering at this endpoint? impure */
export const ollamaUp = async (endpoint = endpoints().usual) => (await serverState(endpoint)).up;
const usable = (state) => state.up && versionAtLeast(state.version, MIN_OLLAMA_VERSION);

/** Free bytes on the disk that holds the server's home. impure */
const freeBytes = async () => {
  let dir = serverHome();
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  try { const s = await fsp.statfs(dir); return s.bavail * s.bsize; } catch { return null; }
};

/** What setting up a server here would take, read from this machine now. impure */
export const currentPlan = async ({ verify = true } = {}) => {
  const setup = await getSetupStatus();
  const record = readRecord();
  const own = record?.managed && record.endpoint ? { endpoint: record.endpoint, ...(await serverState(record.endpoint)) } : null;
  const bin = managedBin();
  return installPlan({
    platform: process.platform,
    arch: process.arch,
    recommendation: setup.recommendation,
    running: await serverState(endpoints().usual),
    own,
    endpoints: endpoints(),
    system: findSystemOllama(),
    managedInstalled: Boolean(bin && fs.existsSync(bin)),
    freeBytes: await freeBytes(),
    gpuGuard: await currentDriverGuard(),
    verify,
  });
};

// ── the job ──────────────────────────────────────────────────────────────────
let job = Object.freeze({ state: 'idle' });
let abort = null;
let child = null;
const update = (patch) => { job = Object.freeze({ ...job, ...patch, at: new Date().toISOString() }); };

/** The setup job as the screen shows it. impure (reads module state) */
export const jobStatus = () => job;

/** Stop a running setup; what finished stays (a download resumes where it stopped). impure */
export const cancelJob = () => {
  if (job.state !== 'running' || !abort) return false;
  abort.abort();
  return true;
};

/**
 * Start setting up a model server, or return the job already running: the job is running from
 * this call's first line, so a second press can never start a second job. The route passes
 * nothing (the plan is read from this machine); a proof run may pass a plan of its own.
 * loadModel false is the installer's job: download the server and the model, start the server
 * with the card hidden from it, and never load the model (no window fit, no answer check); the
 * first load is the app's own first check of it (GET /api/v1/preflight/mind). impure
 */
export const startJob = async ({ plan: given, home, loadModel = true } = {}) => {
  if (job.state === 'running') return job;
  if (home) chosenHome = path.resolve(home);
  abort = new AbortController();
  const { signal } = abort;
  update({ state: 'running', plan: null, step: 'check', completed: 0, total: 0, error: null, detail: null, line: 'Reading what this computer needs' });
  runJob(given, signal, loadModel).catch((err) => {
    const cancelled = signal.aborted;
    log.warn('model server setup stopped', { error: err.message, code: err.code, cancelled });
    update(cancelled
      ? { state: 'cancelled', error: 'Stopped. Press TRY AGAIN to pick up where it left off.', detail: null }
      : { state: 'failed', ...plainFailure(err) });
  });
  return job;
};

/** The job: a plan read fresh for every try, and the work, tried again by itself once. impure */
const runJob = async (given, signal, loadModel) => {
  let last = null;
  for (let n = 1; n <= JOB_TRIES; n += 1) {
    const plan = n === 1 && given ? given : await currentPlan({ verify: loadModel });
    update({ plan });
    if (!plan.supported) throw setupFailure('UNSUPPORTED', plan.reason, plan.reason);
    if (!plan.enoughDisk) {
      const words = `This disk needs about ${(plan.needBytes / 1e9).toFixed(1)} GB free and has ${(plan.freeBytes / 1e9).toFixed(1)} GB. Free some space, then press TRY AGAIN.`;
      throw setupFailure('DISK_SPACE', `need ${plan.needBytes} bytes, ${plan.freeBytes} free`, words);
    }
    try {
      await run(plan, signal, loadModel);
      return;
    } catch (err) {
      if (signal.aborted || isFinal(err)) throw err;
      last = err;
      if (n < JOB_TRIES) {
        log.warn('model server setup try failed; trying again', { attempt: n, error: err.message, code: err.code });
        update({ step: 'check', completed: 0, total: 0, line: 'One step did not finish; trying it again' });
      }
    }
  }
  throw last;
};

/**
 * Fit the window to the card, then have the model answer once: the first time it is loaded.
 * Fitted before the load, so the card's free memory is the truth. impure
 */
const loadAndAnswer = async (plan, signal, { bin, endpoint, started, guard, startedWindow }) => {
  const fit = await fitManagedWindow(endpoint, plan.model.ref, { onGpu: !guard.hold });
  await keepWindow(fit.window);
  let at = endpoint;
  if (started && fit.window !== startedWindow) at = await restartServer(bin, plan.managed, endpoint, { window: fit.window, holdGpu: guard.hold });
  update({ step: 'verify', completed: 0, total: 0, line: `Checking that ${plan.model.name} answers` });
  await modelAnswers(at, plan.model.ref, signal, fit.window);
  return Object.freeze({ fit, endpoint: at });
};

const run = async (plan, signal, loadModel) => {
  const { managed } = plan;
  let bin = null;
  if (plan.server === 'download' || plan.server === 'managed') bin = await ensureManagedServer(signal);
  else if (plan.server === 'installed') bin = findSystemOllama()?.bin;
  else if (managed) bin = readRecord()?.bin || managedBin();
  let { endpoint } = plan;
  let started = false;
  const guard = await currentDriverGuard();
  const startedWindow = servedOllamaWindow();
  if (plan.server !== 'running') {
    update({ step: 'start', completed: 0, total: 0, line: 'Starting the model server' });
    // a download needs no graphics card: an install starts the server with the card hidden from it
    ({ endpoint, started } = await startServer(bin, managed, endpoint, { window: startedWindow, holdGpu: guard.hold || !loadModel }));
  }
  // Recorded the moment it runs: a try after this one, and the next boot, know the server is the
  // platform's own and where it answers, even if the model never finished downloading
  const record = { managed, bin, endpoint, ...(managed ? { home: serverHome(), modelsDir: modelsDir() } : {}) };
  if (managed) await writeManagedRecord({ ...readRecord(), ...record });
  const state = await serverState(endpoint);
  if (!usable(state)) {
    throw setupFailure('SERVER_OLD', `the model server answering at ${endpoint} is Ollama ${state.version || '(unknown)'}, older than ${MIN_OLLAMA_VERSION}`);
  }
  // what the server holds now, never what the plan saw: a models folder removed since is pulled again
  const has = state.models.some((m) => m.toLowerCase() === plan.model.ref.toLowerCase());
  if (!has) await pullModel(plan.model.ref, signal, endpoint, plan.model.name);
  const loaded = loadModel ? await loadAndAnswer(plan, signal, { bin, endpoint, started, guard, startedWindow }) : null;
  if (loaded) endpoint = loaded.endpoint;
  update({ step: 'adopt', line: 'Making it the platform\'s model server' });
  const choice = { provider: 'ollama', endpoint, model: plan.model.ref };
  setConfig(choice);
  await saveProviderChoice(choice, { chosenBy: 'operator' });
  await writeManagedRecord({ version: state.version, ...record, endpoint, model: plan.model.ref, ...(loaded ? { window: loaded.fit.window } : {}), installedAt: new Date().toISOString() });
  update({ state: 'done', step: 'done', line: setupDoneLine({ name: plan.model.name, version: state.version, loaded: Boolean(loaded), notes: [loaded?.fit.line, guard.line] }) });
  log.info('model server set up', { model: plan.model.ref, server: plan.server, endpoint, window: loaded?.fit.window ?? null, onGpu: loaded?.fit.onGpu ?? null, gpuHeld: guard.hold, loaded: Boolean(loaded) });
};

/** The platform's own server on disk: kept if it is there, else downloaded, checked and unpacked. impure */
const ensureManagedServer = async (signal) => {
  const asset = ollamaAssetFor(process.platform, process.arch);
  const bin = managedBin();
  if (fs.existsSync(bin)) return bin;
  await fsp.mkdir(serverHome(), { recursive: true });
  const archive = path.join(serverHome(), asset.name);
  update({ step: 'download', completed: 0, total: asset.size, line: `Downloading Ollama ${OLLAMA_VERSION}` });
  const onBytes = (have) => {
    if (Math.abs(have - (job.completed || 0)) > 8_000_000 || have === asset.size) update({ completed: have });
  };
  await obtainArchive(asset, archive, { signal, onBytes, onLine: (line) => update({ line }) });
  update({ step: 'unpack', completed: 0, total: 0, line: 'Unpacking' });
  return installArchive(asset, archive, path.join(serverHome(), 'ollama'));
};

// ── serve + pull + answer ────────────────────────────────────────────────────
/** Is nothing listening on this loopback port? impure */
const portFree = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});

/**
 * Where the server should answer: the wanted endpoint, or the first port after it with nothing on
 * it when the wanted one is held by something else (an outdated Ollama, another program). impure
 * @returns {Promise<{endpoint: string, up: boolean}>} up: a usable Ollama already answers there
 */
const placeServer = async (wanted) => {
  const base = Number(new URL(wanted).port);
  for (let i = 0; i < PORT_STEPS; i += 1) {
    const endpoint = `http://127.0.0.1:${base + i}`;
    const state = await serverState(endpoint);
    if (usable(state)) return { endpoint, up: true };
    if (!state.up && await portFree(base + i)) return { endpoint, up: false };
  }
  throw setupFailure('SERVER_START', `ports ${base} to ${base + PORT_STEPS - 1} are all held by other programs`);
};

/**
 * Start `ollama serve` as this backend's child and wait for it to answer: at the window fitted to
 * the card, one model and one slot, the card hidden when the driver guard holds it
 * (managed-ollama-plan.js managedServeEnv). impure
 * @returns {Promise<{endpoint: string, started: boolean}>} where it answers (moved past a port held
 *   by another server); started false: a usable Ollama already answered there
 */
const startServer = async (bin, managed, wanted = endpoints().usual, { window = servedOllamaWindow(), holdGpu = false } = {}) => {
  const { endpoint, up } = await placeServer(wanted);
  if (up) return { endpoint, started: false };
  if (!bin) throw setupFailure('SERVER_START', 'no Ollama to start');
  await fsp.mkdir(serverHome(), { recursive: true });
  const logFile = path.join(serverHome(), 'ollama.log');
  const out = fs.openSync(logFile, 'a');
  const env = { ...withoutBackendSecrets(process.env), OLLAMA_HOST: endpoint.replace(/^https?:\/\//, ''), ...managedServeEnv({ window, holdGpu, env: process.env }) };
  if (managed) {
    env.OLLAMA_MODELS = modelsDir();
    await fsp.mkdir(env.OLLAMA_MODELS, { recursive: true });
  }
  child = spawn(bin, ['serve'], { env, stdio: ['ignore', out, out], windowsHide: true });
  fs.closeSync(out);
  const mine = child;
  let spawnError = null;
  mine.on('error', (err) => { spawnError = err; });
  mine.on('exit', (code) => { log.info('ollama serve exited', { code }); if (child === mine) child = null; });
  for (let i = 0; i < 60; i += 1) {
    if (await ollamaUp(endpoint)) return { endpoint, started: true };
    if (spawnError) throw setupFailure('SERVER_START', `the model server could not be started (${bin}): ${spawnError.message}`);
    if (mine.exitCode !== null || mine.signalCode !== null) throw setupFailure('SERVER_START', `the model server stopped while starting; its log is ${logFile}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw setupFailure('SERVER_START', `the model server did not answer within a minute of starting; its log is ${logFile}`);
};

/**
 * Record the window the card was fitted to. A new one drops the capability readings taken at the
 * old one, or the next chat would name the old window and reload the model at it (seen in the
 * 2026-10-23 proof run: refitted to 20,480, the next chat loaded at 32,768). impure
 */
const keepWindow = async (window) => {
  const was = servedOllamaWindow();
  await writeManagedRecord({ ...readRecord(), window });
  if (window !== was) _resetCapsCache();
};

/** Stop the server this backend started, and wait until it has gone (its port is free). impure */
const stopChild = async () => {
  const mine = child;
  if (!mine || mine.exitCode !== null || mine.signalCode !== null) return;
  const gone = new Promise((resolve) => { mine.once('exit', resolve); });
  mine.kill();
  await Promise.race([gone, new Promise((resolve) => { setTimeout(resolve, 10_000); })]);
};

/** Start the server again with what it should serve now (a fitted window, the card held or not). impure */
const restartServer = async (bin, managed, endpoint, opts) => {
  await stopChild();
  return (await startServer(bin, managed, endpoint, opts)).endpoint;
};

/** Pull a model through Ollama, reporting bytes across every layer. impure */
const pullModel = async (ref, signal, endpoint, name = ref) => {
  const downloading = `Downloading the model, ${name}`;
  // Ollama's own words are layer digests ("pulling 3f2a1b..."); a person is told what is happening
  const said = (status) => (/^pulling/.test(status) ? downloading
    : /verifying/.test(status) ? `Checking the download of ${name}`
      : /writing manifest|removing/.test(status) ? `Finishing ${name}`
        : status === 'success' ? `${name} is downloaded` : downloading);
  update({ step: 'pull', completed: 0, total: 0, line: downloading });
  const layers = new Map();
  let finished = false;
  try {
    const res = await fetch(`${endpoint}/api/pull`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: ref, stream: true }),
    });
    if (!res.ok || !res.body) throw setupFailure('PULL_FAILED', `the model server refused the download (HTTP ${res.status})`);
    let buffered = '';
    for await (const chunk of res.body) {
      buffered += Buffer.from(chunk).toString('utf8');
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) {
        const p = pullProgress(line);
        if (!p) continue;
        if (p.error) throw setupFailure('PULL_FAILED', `the model download failed: ${p.error}`);
        if (p.total) layers.set(p.status, { total: p.total, completed: p.completed || 0 });
        if (p.status === 'success') finished = true;
        const sum = [...layers.values()].reduce((a, l) => ({ total: a.total + l.total, completed: a.completed + l.completed }), { total: 0, completed: 0 });
        update({ total: sum.total, completed: sum.completed, line: said(p.status) });
      }
    }
  } catch (err) {
    if (signal.aborted || err.code) throw err;
    throw setupFailure('PULL_FAILED', `the model download stopped: ${err.message}`);
  }
  if (!finished) throw setupFailure('PULL_FAILED', 'the model download ended before it finished');
};

/** The model answers a real message: loaded into memory, and it speaks. impure */
const modelAnswers = async (endpoint, model, signal, window = servedOllamaWindow()) => {
  let res;
  try {
    res = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: 'Reply with one word: ready' }], options: { num_predict: 256, num_ctx: window } }),
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw setupFailure('MODEL_SILENT', `the model did not answer: ${err.message}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw setupFailure('MODEL_SILENT', `the model did not answer (HTTP ${res.status}): ${body.error || ''}`.trim());
  const said = `${body.message?.content || ''}${body.message?.thinking || ''}`.trim();
  if (!said) throw setupFailure('MODEL_SILENT', 'the model answered with nothing');
  return said;
};

/** The route follows the server to its new address, if the route pointed at its old one. impure */
const followServer = async (record, was, endpoint) => {
  await writeManagedRecord({ ...record, endpoint });
  const choice = await loadProviderChoice();
  if (choice?.provider === 'ollama' && sameEndpoint(choice.endpoint, was)) {
    await saveProviderChoice({ provider: 'ollama', endpoint, model: choice.model }, { chosenBy: choice.chosenBy });
  }
  const config = getConfig();
  if (config.provider === 'ollama' && sameEndpoint(config.endpoint, was)) setConfig({ provider: 'ollama', endpoint, model: config.model });
};

/**
 * At boot: a server the setup started is started again, so the mind is there after a restart. One
 * already answering there and new enough is used; one too old (an outdated Ollama's own service
 * holding the port) is left alone and the platform's moves to the next free port, its route with it.
 * impure
 */
export const startManagedAtBoot = async () => {
  const record = readRecord();
  if (!record?.bin || (record.managed && !fs.existsSync(record.bin))) return;
  const was = record.endpoint || endpoints().usual;
  try {
    const guard = await currentDriverGuard();
    if (guard.hold) log.warn('the graphics driver is older than this card needs; the model runs on the processor', { have: guard.have, floor: guard.floor });
    const window = servedOllamaWindow();
    const managed = Boolean(record.managed);
    const placed = await startServer(record.bin, managed, was, { window, holdGpu: guard.hold });
    const { started } = placed;
    let { endpoint } = placed;
    if (!sameEndpoint(endpoint, was)) {
      await followServer(record, was, endpoint);
      log.info('model server moved past a port held by another server', { was, endpoint });
    }
    const state = await serverState(endpoint);
    const hasModel = Boolean(record.model) && state.models.some((m) => m.toLowerCase() === record.model.toLowerCase());
    if (record.model && !hasModel) {
      log.warn('the model the setup downloaded is missing from its server; the door offers it again', { model: record.model, endpoint });
    }
    // Fitted at every start, before the model loads: the card's free memory is today's, not the setup's
    if (started && hasModel) {
      const fit = await fitManagedWindow(endpoint, record.model, { onGpu: !guard.hold });
      await keepWindow(fit.window);
      if (fit.window !== window) endpoint = await restartServer(record.bin, managed, endpoint, { window: fit.window, holdGpu: guard.hold });
      log.info('model window fitted to the graphics card', { window: fit.window, onGpu: fit.onGpu, line: fit.line });
    }
    log.info('managed model server ready', { version: state.version, endpoint });
  } catch (err) {
    log.warn('managed model server did not start', { error: err.message });
  }
};

// The managed server lives and dies with the backend. Only 'exit': a SIGINT/SIGTERM listener
// would replace Node's default exit on those signals (the desktop app stops the backend's whole
// process group, the server with it). A server orphaned by a hard kill is found answering at the
// next boot and used as it is.
process.once('exit', () => { try { child?.kill(); } catch { /* already gone */ } });

/**
 * The person's choice to use the graphics card despite an old driver (or to go back): kept, and
 * the platform's own server started again so the choice takes effect now. impure
 * @returns {Promise<object>} the driver guard as it stands after the choice
 */
export const chooseGpuAnyway = async (useGpuAnyway, wallet = null) => {
  await saveGpuAnyway(useGpuAnyway, wallet);
  if (child && readRecord()?.bin) {
    await stopChild();
    await startManagedAtBoot();
  }
  return currentDriverGuard();
};

/** The home this module installs into, for the screen's honesty line. impure */
export const installHome = () => serverHome().replace(os.homedir(), '~');
