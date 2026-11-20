// managed-engine — set up the house's fast engine on a Linux PC with an NVIDIA card: llama.cpp under
// the platform's own supervisor, and the model's files beside each other. impure (network, fs,
// child processes). The decisions are in managed-engine-plan.js (pure); the downloads are
// managed-ollama-download.js; the words for a failure are managed-ollama-errors.js.
//
// One job at a time, observed by polling (the same routes and screen as the Ollama setup,
// model-server-setup.js):
//   check    → the plan, read from this machine
//   download → the pinned llama.cpp build, then its CUDA runtime, each SHA-256 checked on disk
//   unpack   → both into one folder under <home>/llama.cpp (no admin rights, nothing system-wide)
//   pull     → the model, straight from Hugging Face at a pinned revision, into <home>/gguf/<folder>
//   projector→ its vision projector beside it
//   drafter  → the DFlash2 drafter beside them, on the tiers that carry one
//   adopt    → the folder is authorized, the selection names the model, the mind is llama-server
//   verify   → the supervisor serves it and it answers a real message
// The supervisor runs the engine from then on (supervisor-launch-config.js): the pool is fitted
// to the card, slots are held, and MTP or DFlash2 is chosen at every launch (serving-drafter.js).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getDataRoot } from './data-root.js';
import { chosenModelHome } from './model-home.js';
import { boundedExec } from './bounded-exec.js';
import { obtainArchive, unpackArchive } from './managed-ollama-download.js';
import { isFinal, plainFailure, setupFailure } from './managed-ollama-errors.js';
import { createLogger } from './logger.js';
import { recommendForMachine } from './substrate-setup.js';
import { getSubstrateProfile } from './substrate-detector.js';
import { saveProviderChoice } from './provider-choice.js';
import { setConfig } from './llm-provider.js';
import { activeLaunchConfig, ensureServing, selectSubstrateModel } from './llama-server-supervisor.js';
import { authorizingFolder, readModelFolders, setModelFolders } from './model-folder-authority.js';
import { findCatalogModel } from './model-catalog.js';
import { engineDirFor, ggufDirFor, readEngineRecord, writeEngineRecord } from './managed-engine-record.js';
import {
  LLAMA_CPP_BUILD, engineArchives, engineDoneLine, enginePlan, engineVariantFor, filesOf, modelFilesFor,
} from './managed-engine-plan.js';

const log = createLogger('ManagedEngine');
const JOB_TRIES = 2;

// the folder this job was given, else where the engine was set up; a NEW setup goes where the
// person chose (model-home.js), as the Ollama setup does
let chosenHome = null;
const serverHome = () => chosenHome || readEngineRecord()?.home || path.join(getDataRoot(), 'model-server');
const setupHome = () => chosenHome || chosenModelHome() || readEngineRecord()?.home || path.join(getDataRoot(), 'model-server');

/** The card's compute capability (7.5, 8.9, 12.0), or null. impure */
const computeCap = async () => {
  const r = await boundedExec('nvidia-smi', ['--query-gpu=compute_cap', '--format=csv,noheader'], { timeoutMs: 5000 });
  const cap = r.ok ? Number.parseFloat(String(r.stdout).trim().split('\n')[0]) : NaN;
  return Number.isFinite(cap) ? cap : null;
};

/** Free bytes on the disk the next setup goes into. impure */
const freeBytes = async () => {
  let dir = setupHome();
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  try { const s = await fsp.statfs(dir); return s.bavail * s.bsize; } catch { return null; }
};

// impure — the names of a choice's files already in its folder at full size
const presentFiles = (files) => filesOf(files)
  .filter((f) => { try { return fs.statSync(path.join(ggufDirFor(setupHome()), files.folder, f.name)).size === f.size; } catch { return false; } })
  .map((f) => f.name);

// impure — the card and the model matched to it, read without probing the model servers (the
// engine path depends on neither)
const machineRead = async () => {
  const profile = await getSubstrateProfile();
  const gpu = profile.gpu || null;
  return {
    platform: process.platform,
    arch: process.arch,
    gpu,
    computeCap: gpu?.vendor === 'nvidia' ? await computeCap() : null,
    recommendation: recommendForMachine(profile),
  };
};

/**
 * What setting up the fast engine here would take, or null where it does not apply (the Ollama
 * path decides). impure
 */
export const currentPlan = async ({ verify = true } = {}) => {
  const machine = await machineRead();
  const variant = engineVariantFor(machine);
  const files = modelFilesFor(machine.recommendation);
  if (!variant || !files) return null;
  return enginePlan({
    ...machine,
    installed: fs.existsSync(path.join(engineDirFor(setupHome(), LLAMA_CPP_BUILD, variant.id), 'llama-server')),
    present: presentFiles(files),
    freeBytes: await freeBytes(),
    verify,
  });
};

// ── the job ──────────────────────────────────────────────────────────────────
let job = Object.freeze({ state: 'idle' });
let abort = null;
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
 * Start setting up the engine, or return the job already running (running from this call's first
 * line, so a second press never starts a second job). loadModel false is the installer's: it
 * downloads and adopts, and the model first loads at the app's own first check of it. impure
 */
export const startJob = async ({ plan: given, home, loadModel = true } = {}) => {
  if (job.state === 'running') return job;
  const target = home || chosenModelHome();
  if (target) chosenHome = path.resolve(target);
  abort = new AbortController();
  const { signal } = abort;
  update({ state: 'running', plan: null, step: 'check', completed: 0, total: 0, error: null, detail: null, line: 'Reading what this computer needs' });
  runJob(given, signal, loadModel).catch((err) => {
    const cancelled = signal.aborted;
    log.warn('engine setup stopped', { error: err.message, code: err.code, cancelled });
    update(cancelled
      ? { state: 'cancelled', error: 'Stopped. Press TRY AGAIN to pick up where it left off.', detail: null }
      : { state: 'failed', ...plainFailure(err) });
  });
  return job;
};

const runJob = async (given, signal, loadModel) => {
  let last = null;
  for (let n = 1; n <= JOB_TRIES; n += 1) {
    const plan = n === 1 && given ? given : await currentPlan({ verify: loadModel });
    if (!plan) throw setupFailure('UNSUPPORTED', 'this machine no longer takes the llama.cpp engine', 'This computer can no longer run the fast engine. Press RECHECK.');
    update({ plan });
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
      if (n < JOB_TRIES) update({ step: 'check', completed: 0, total: 0, line: 'One step did not finish; trying it again' });
    }
  }
  throw last;
};

/** One pinned download into `file`, its bytes reported on the job. impure */
const fetchFile = async (asset, file, step, signal) => {
  update({ step, completed: 0, total: asset.size, line: `Downloading ${asset.label}` });
  const onBytes = (have) => {
    if (Math.abs(have - (job.completed || 0)) > 8_000_000 || have === asset.size) update({ completed: have });
  };
  await obtainArchive(asset, file, { signal, onBytes, onLine: (line) => update({ line }) });
};

/**
 * The engine on disk at `dir`: both archives fetched beside it, then one folder holding llama-server
 * and the CUDA runtime it finds beside itself. Unpacked beside its place first, so a failed unpack
 * never leaves half an engine. impure
 * @param {{engine: object, runtime: object}} archives - the pinned pair (engineArchives)
 * @param {string} dir - <home>/llama.cpp/<build>-<variant>
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>} dir
 */
export const installEngine = async ({ engine, runtime }, dir, signal) => {
  if (fs.existsSync(path.join(dir, 'llama-server'))) return dir;
  const parent = path.dirname(dir);
  await fsp.mkdir(parent, { recursive: true });
  const [engineFile, runtimeFile] = [engine, runtime].map((a) => path.join(parent, a.name));
  await fetchFile(engine, engineFile, 'download', signal);
  await fetchFile(runtime, runtimeFile, 'runtime', signal);
  update({ step: 'unpack', completed: 0, total: 0, line: 'Unpacking' });
  const tmp = `${dir}.unpacking`;
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(path.join(tmp, 'runtime'), { recursive: true });
  await unpackArchive(engine, engineFile, tmp);
  await unpackArchive(runtime, runtimeFile, path.join(tmp, 'runtime'));
  const serverDir = (await fsp.readdir(tmp)).map((d) => path.join(tmp, d)).find((d) => fs.existsSync(path.join(d, 'llama-server')));
  if (!serverDir) throw setupFailure('UNPACK', 'the llama.cpp archive did not hold llama-server');
  // the runtime's libraries (one top folder, or loose) go beside the server
  for (const top of await fsp.readdir(path.join(tmp, 'runtime'))) {
    const from = path.join(tmp, 'runtime', top);
    const libs = (await fsp.stat(from)).isDirectory() ? (await fsp.readdir(from)).map((f) => path.join(from, f)) : [from];
    for (const lib of libs) await fsp.rename(lib, path.join(serverDir, path.basename(lib)));
  }
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.rename(serverDir, dir);
  await fsp.rm(tmp, { recursive: true, force: true });
  // the supervisor runs only an owner executable no one else may write (serving-process-owner.js)
  await fsp.chmod(path.join(dir, 'llama-server'), 0o755);
  await Promise.all([engineFile, runtimeFile].map((f) => fsp.rm(f, { force: true })));
  return dir;
};

/**
 * The model's folder is one the operator authorized (the folder law, model-folder-authority.js):
 * pressing SET IT UP FOR ME chose it. Added once; the folders already chosen stay. impure
 */
const authorizeFolder = async (dir) => {
  const folders = await readModelFolders();
  if (authorizingFolder(folders, dir)) return folders;
  return setModelFolders([...folders, { path: dir }]);
};

/** The supervised server serves the selection, and it answers a real message. impure */
const serveAndAnswer = async (signal) => {
  const cfg = activeLaunchConfig(process.env);
  update({ step: 'verify', completed: 0, total: 0, line: 'Starting llama.cpp and checking the model answers' });
  try {
    await ensureServing(cfg);
  } catch (err) {
    throw setupFailure('SERVER_START', `the supervised server did not start: ${err.message}`);
  }
  let res;
  try {
    res = await fetch(`http://${cfg.host}:${cfg.port}/v1/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Reply with one word: ready' }], max_tokens: 256 }),
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw setupFailure('MODEL_SILENT', `the model did not answer: ${err.message}`);
  }
  const body = await res.json().catch(() => ({}));
  const said = `${body.choices?.[0]?.message?.content || ''}${body.choices?.[0]?.message?.reasoning_content || ''}`.trim();
  if (!res.ok || !said) throw setupFailure('MODEL_SILENT', `the model did not answer (HTTP ${res.status})`);
};

const run = async (plan, signal, loadModel) => {
  const files = modelFilesFor((await machineRead()).recommendation);
  if (!files || files.model.name !== plan.model.ref) throw setupFailure('UNSUPPORTED', 'the recommended model changed during the setup');
  const dir = await installEngine(engineArchives(plan.variant), engineDirFor(serverHome(), LLAMA_CPP_BUILD, plan.variant), signal);
  await fsp.mkdir(path.join(ggufDirFor(serverHome()), files.folder), { recursive: true });
  // by real paths: the supervisor serves no model reached through a link, and the folder law
  // matches the model against its folder by prefix
  const gguf = await fsp.realpath(ggufDirFor(serverHome()));
  const folder = path.join(gguf, files.folder);
  for (const f of filesOf(files)) {
    const file = path.join(folder, f.name);
    if (fs.existsSync(file) && fs.statSync(file).size === f.size) continue;
    await fetchFile(f, file, f === files.drafter ? 'drafter' : f === files.mmproj ? 'projector' : 'pull', signal);
  }
  const model = path.join(folder, files.model.name);
  await writeEngineRecord({ build: LLAMA_CPP_BUILD, variant: plan.variant, home: serverHome(), model, installedAt: new Date().toISOString() });
  update({ step: 'adopt', completed: 0, total: 0, line: 'Making it the platform\'s model server' });
  const folders = await authorizeFolder(gguf);
  const entry = findCatalogModel(process.env, model, folders.map((f) => f.path));
  const key = entry?.servingModel ?? entry?.id ?? null;
  selectSubstrateModel(model, key);
  const cfg = activeLaunchConfig(process.env);
  const choice = { provider: 'llama-server', endpoint: `http://${cfg.host}:${cfg.port}`, ...(key ? { model: key } : {}) };
  setConfig(choice);
  await saveProviderChoice(choice, { chosenBy: 'operator' });
  if (loadModel) await serveAndAnswer(signal);
  update({ state: 'done', step: 'done', line: engineDoneLine({ name: plan.model.name, loaded: loadModel }) });
  log.info('engine set up', { build: LLAMA_CPP_BUILD, variant: plan.variant, dir, model, key, loaded: loadModel });
};

/** The folder the next setup installs into, as the screen shows it. impure */
export const installHome = () => setupHome().replace(os.homedir(), '~');

/** The same folder, whole, for the folder dialog to open at. impure */
export const installHomePath = () => setupHome();
