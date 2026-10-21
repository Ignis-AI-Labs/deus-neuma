// managed-ollama — set up a local model server for a person who has none, and keep it running.
// impure (network, fs, child processes). The decisions are in managed-ollama-plan.js (pure).
//
// One job at a time, observed by polling (GET /api/v1/model-server/status):
//   download → the pinned Ollama build, resumable, SHA-256 checked before anything runs it
//   unpack   → under <data root>/model-server/ollama (no admin rights, nothing system-wide)
//   start    → `ollama serve` on 127.0.0.1:11434, models kept under <data root>/model-server/models
//   pull     → the model the capacity check recommends, straight from Hugging Face (Ollama
//              verifies every layer it pulls)
//   adopt    → the platform's mind becomes that server and model, persisted (provider-choice.js)
// An Ollama already on the machine is used as it is: started if it is installed but not running,
// never downloaded twice. A managed server is started again at every boot (startManagedAtBoot)
// and stopped with the backend.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getDataRoot } from './data-root.js';
import { createLogger } from './logger.js';
import { getSetupStatus } from './substrate-setup.js';
import { saveProviderChoice } from './provider-choice.js';
import { setConfig } from './llm-provider.js';
import {
  MIN_OLLAMA_VERSION, OLLAMA_ENDPOINT, OLLAMA_VERSION, installPlan, ollamaAssetFor, pullProgress, versionAtLeast,
} from './managed-ollama-plan.js';

const log = createLogger('ManagedOllama');

// impure — read at call time (packaged vs dev data roots)
const root = () => path.join(getDataRoot(), 'model-server');
const recordPath = () => path.join(root(), 'managed.json');
const managedBin = () => {
  const asset = ollamaAssetFor(process.platform, process.arch);
  return asset ? path.join(root(), 'ollama', asset.bin) : null;
};

/** The record of what the platform set up, or null. impure */
export const readRecord = () => {
  try { return JSON.parse(fs.readFileSync(recordPath(), 'utf8')); } catch { return null; }
};
const writeRecord = async (record) => {
  await fsp.mkdir(root(), { recursive: true });
  const tmp = `${recordPath()}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(record, null, 2));
  await fsp.rename(tmp, recordPath());
};

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
export const serverState = async (endpoint = OLLAMA_ENDPOINT) => {
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
export const ollamaUp = async (endpoint = OLLAMA_ENDPOINT) => (await serverState(endpoint)).up;

/** Free bytes on the disk that holds the data root. impure */
const freeBytes = async () => {
  let dir = root();
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  try { const s = await fsp.statfs(dir); return s.bavail * s.bsize; } catch { return null; }
};

/** What setting up a server here would take, read from this machine now. impure */
export const currentPlan = async () => {
  const setup = await getSetupStatus();
  const record = readRecord();
  return installPlan({
    platform: process.platform,
    arch: process.arch,
    recommendation: setup.recommendation,
    running: await serverState(OLLAMA_ENDPOINT),
    system: findSystemOllama(),
    managedInstalled: Boolean(record?.managed && record.bin && fs.existsSync(record.bin)),
    freeBytes: await freeBytes(),
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
 * Start setting up a model server. Refuses a second job. The route passes nothing (the plan is
 * read from this machine); a proof run may pass a plan of its own. impure
 */
export const startJob = async ({ plan: given } = {}) => {
  if (job.state === 'running') return job;
  const plan = given ?? await currentPlan();
  if (!plan.supported) { update({ state: 'failed', error: plan.reason, plan }); return job; }
  if (!plan.enoughDisk) {
    update({ state: 'failed', plan, error: `Setting up needs about ${(plan.needBytes / 1e9).toFixed(1)} GB free; this disk has ${(plan.freeBytes / 1e9).toFixed(1)} GB. Free some space, then try again.` });
    return job;
  }
  abort = new AbortController();
  update({ state: 'running', plan, step: plan.steps[0]?.id || 'adopt', completed: 0, total: 0, error: null, line: '' });
  run(plan, abort.signal).catch((err) => {
    const cancelled = abort?.signal.aborted;
    log.warn('model server setup stopped', { error: err.message, cancelled });
    update({ state: cancelled ? 'cancelled' : 'failed', error: cancelled ? 'Stopped. Start again to pick up where it left off.' : err.message });
  });
  return job;
};

const run = async (plan, signal) => {
  const { endpoint } = plan;
  const managed = plan.server === 'download' || plan.server === 'managed';
  let bin = null;
  if (managed) bin = await ensureManagedServer(plan, signal);
  else if (plan.server === 'installed') bin = findSystemOllama()?.bin;
  if (plan.server !== 'running') {
    update({ step: 'start', completed: 0, total: 0, line: 'Starting the model server' });
    await startServer(bin, managed, endpoint);
  }
  const version = (await serverState(endpoint)).version;
  if (!versionAtLeast(version, MIN_OLLAMA_VERSION)) {
    throw new Error(`the model server answering at ${endpoint} is Ollama ${version || '(unknown)'}, older than ${MIN_OLLAMA_VERSION}; it cannot run this model`);
  }
  if (!plan.model.ready) await pullModel(plan.model.ref, signal, endpoint);
  update({ step: 'adopt', line: 'Making it the platform\'s model server' });
  const choice = { provider: 'ollama', endpoint, model: plan.model.ref };
  setConfig(choice);
  await saveProviderChoice(choice, { chosenBy: 'operator' });
  await writeRecord({
    version,
    managed,
    bin,
    endpoint,
    ...(managed ? { modelsDir: path.join(root(), 'models') } : {}),
    model: plan.model.ref,
    installedAt: new Date().toISOString(),
  });
  update({ state: 'done', step: 'done', line: `${plan.model.name} is ready on Ollama ${version}.` });
  log.info('model server set up', { model: plan.model.ref, server: plan.server });
};

// ── download + unpack ────────────────────────────────────────────────────────
const ensureManagedServer = async (plan, signal) => {
  const asset = ollamaAssetFor(process.platform, process.arch);
  const bin = managedBin();
  if (fs.existsSync(bin)) return bin;
  await fsp.mkdir(root(), { recursive: true });
  const archive = path.join(root(), asset.name);
  update({ step: 'download', completed: 0, total: asset.size, line: `Downloading Ollama ${OLLAMA_VERSION}` });
  await downloadVerified(asset, archive, signal);
  update({ step: 'unpack', completed: 0, total: 0, line: 'Unpacking' });
  const dir = path.join(root(), 'ollama');
  const tmp = `${dir}.unpacking`;
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  await unpack(asset, archive, tmp);
  if (!fs.existsSync(path.join(tmp, asset.bin))) throw new Error(`the Ollama archive did not hold ${asset.bin}`);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.rename(tmp, dir);
  if (process.platform !== 'win32') await fsp.chmod(bin, 0o755);
  await fsp.rm(archive, { force: true });
  return bin;
};

/** Download with resume; refuse anything that does not hash to the pinned SHA-256. impure */
const downloadVerified = async (asset, dest, signal) => {
  const part = `${dest}.part`;
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (have > asset.size) { await fsp.rm(part, { force: true }); have = 0; }
  let hash = createHash('sha256');
  if (have > 0) await pipeline(fs.createReadStream(part), new Transform({ transform(c, _e, cb) { hash.update(c); cb(); } }));
  if (have < asset.size) {
    const res = await fetch(asset.url, { signal, redirect: 'follow', headers: have ? { Range: `bytes=${have}-` } : {} });
    if (have > 0 && res.status !== 206) { have = 0; hash = createHash('sha256'); }
    if (!res.ok || !res.body) throw new Error(`the Ollama download answered HTTP ${res.status}`);
    const count = new Transform({
      transform(chunk, _e, cb) {
        hash.update(chunk);
        have += chunk.length;
        if (have - (job.completed || 0) > 8_000_000 || have === asset.size) update({ completed: have });
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), count, fs.createWriteStream(part, { flags: have > 0 && res.status === 206 ? 'a' : 'w' }), { signal });
  }
  const got = hash.digest('hex');
  if (got !== asset.sha256) {
    await fsp.rm(part, { force: true });
    throw new Error('the Ollama download did not match its published checksum, so it was discarded. Try again.');
  }
  await fsp.rename(part, dest);
};

/** Unpack with the system's own tar (Linux tar, Windows 10+ bsdtar). impure */
const unpack = async (asset, archive, dir) => {
  const tarRun = (args, input) => new Promise((resolve, reject) => {
    const p = spawn('tar', args, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`unpacking failed (tar exit ${code}): ${err.trim().split('\n').pop() || ''}`))));
    if (input) pipeline(fs.createReadStream(archive), zlib.createZstdDecompress(), p.stdin).catch(reject);
  });
  if (asset.format === 'zip') return tarRun(['-xf', archive, '-C', dir]);
  if (typeof zlib.createZstdDecompress === 'function') return tarRun(['-x', '-C', dir], true);
  return tarRun(['--zstd', '-xf', archive, '-C', dir]);
};

// ── serve + pull ─────────────────────────────────────────────────────────────
/** Start `ollama serve` as this backend's child and wait for it to answer. impure */
const startServer = async (bin, managed, endpoint = OLLAMA_ENDPOINT) => {
  if (await ollamaUp(endpoint)) return;
  if (!bin) throw new Error('no Ollama to start');
  await fsp.mkdir(root(), { recursive: true });
  const out = fs.openSync(path.join(root(), 'ollama.log'), 'a');
  const env = { ...process.env, OLLAMA_HOST: endpoint.replace(/^https?:\/\//, '') };
  if (managed) env.OLLAMA_MODELS = path.join(root(), 'models');
  child = spawn(bin, ['serve'], { env, stdio: ['ignore', out, out], windowsHide: true });
  child.on('exit', (code) => { log.info('ollama serve exited', { code }); child = null; });
  for (let i = 0; i < 60; i += 1) {
    if (await ollamaUp(endpoint)) return;
    if (!child) throw new Error(`the model server stopped while starting; its log is ${path.join(root(), 'ollama.log')}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('the model server did not answer within a minute of starting');
};

/** Pull a model through Ollama, reporting bytes across every layer. impure */
const pullModel = async (ref, signal, endpoint = OLLAMA_ENDPOINT) => {
  update({ step: 'pull', completed: 0, total: 0, line: `Downloading ${ref}` });
  const res = await fetch(`${endpoint}/api/pull`, {
    method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: ref, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`the model server refused the download (HTTP ${res.status})`);
  const layers = new Map();
  let buffered = '';
  let finished = false;
  for await (const chunk of res.body) {
    buffered += Buffer.from(chunk).toString('utf8');
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const line of lines) {
      const p = pullProgress(line);
      if (!p) continue;
      if (p.error) throw new Error(`the model download failed: ${p.error}`);
      if (p.total) layers.set(p.status, { total: p.total, completed: p.completed || 0 });
      if (p.status === 'success') finished = true;
      const sum = [...layers.values()].reduce((a, l) => ({ total: a.total + l.total, completed: a.completed + l.completed }), { total: 0, completed: 0 });
      update({ total: sum.total, completed: sum.completed, line: p.status });
    }
  }
  if (!finished) throw new Error('the model download ended before it finished; start again to resume it');
};

/** At boot: a server the platform set up is started again, so the mind is there after a restart. impure */
export const startManagedAtBoot = async () => {
  const record = readRecord();
  if (!record?.managed || !record.bin || !fs.existsSync(record.bin)) return;
  const endpoint = record.endpoint || OLLAMA_ENDPOINT;
  if (await ollamaUp(endpoint)) return;
  try {
    await startServer(record.bin, true, endpoint);
    log.info('managed model server started', { version: record.version });
  } catch (err) {
    log.warn('managed model server did not start', { error: err.message });
  }
};

// The managed server lives and dies with the backend. Only 'exit': a SIGINT/SIGTERM listener
// would replace Node's default exit on those signals. A server orphaned by a hard kill is
// found answering at the next boot and used as it is.
process.once('exit', () => { try { child?.kill(); } catch { /* already gone */ } });

/** The home this module installs into, for the screen's honesty line. impure */
export const installHome = () => root().replace(os.homedir(), '~');
