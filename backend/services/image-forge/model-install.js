/**
 * MODEL INSTALL — a neuma brings a new model into the image engine itself (Design note, 2026-11-20: […]). Metidar had found FLUX 3 Image Klein and could not install
 * it: […]
 *
 * What a neuma names: a Hugging Face repo and a file in it. What the platform does, once the operator says yes
 * (intents/forge-install.js): reads the file's size and its publisher SHA-256 (the LFS id Hugging Face keeps), streams
 * it straight into the engine's model folder under a temporary name, checks every byte against that hash, and only then
 * gives it its real name; it records the install where no being can write. The house's Hugging Face token (Settings ›
 * API) goes to huggingface.co alone — a redirect to its storage never carries it — so a gated model the operator
 * accepted downloads like any other.
 *
 * SAFETENSORS ONLY: a .ckpt/.pt/.bin is a pickle, and loading a pickle runs code. A file on disk is still not callable
 * by itself — the pipelines that name it are reviewed code (pack-registry.js) — this only fetches what they name.
 */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { getDataRoot } from '../data-root.js';
import { withStoredHfToken } from '../stored-secrets.js';
import { assertSafeWebTarget } from '../web-guard.js';
import { requestWebOnce, readBounded } from '../web-fetch.js';
import { streamDownload } from '../web-download.js';

const HF = 'huggingface.co';
/** The engine's model folders a file may go into. */
export const MODEL_FOLDERS = Object.freeze(['diffusion_models', 'text_encoders', 'vae', 'checkpoints', 'loras', 'clip_vision', 'model_patches', 'upscale_models']);
// A model is a large file; the disk's own room is checked as it streams (web-download.js).
const INSTALL_MAX_BYTES = 256 * 1024 ** 3;
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * pure — what is to be installed, or why not.
 * @param {{repo, file, revision?, folder?}} q folder: one of MODEL_FOLDERS; read from the file's own path when it names one
 * @returns {{ok: true, value: {repo, file, revision, folder, name}} | {ok: false, reason: string}}
 */
export const parseInstall = (q) => {
  const repo = String(q?.repo ?? '').trim();
  const file = String(q?.file ?? '').trim().replace(/^\/+/, '');
  const revision = String(q?.revision ?? 'main').trim();
  const parts = file.split('/');
  if (!REPO.test(repo)) return { ok: false, reason: 'repo: a Hugging Face repo as owner/name, e.g. black-forest-labs/flux-3-image-klein-comfy' };
  if (!file || parts.length > 4 || !parts.every((p) => SEGMENT.test(p) && p !== '..')) return { ok: false, reason: 'file: the file\'s path inside the repo, e.g. diffusion_models/flux3-image-klein-int8-convrot.safetensors' };
  if (!/\.safetensors$/i.test(file)) return { ok: false, reason: 'only .safetensors files are installed: a .ckpt, .pt or .bin is a pickle, and loading one runs code' };
  if (!REVISION.test(revision)) return { ok: false, reason: 'revision: a branch, tag or commit (default main)' };
  const folder = q?.folder ? String(q.folder).trim() : parts.slice(0, -1).reverse().find((p) => MODEL_FOLDERS.includes(p));
  if (!MODEL_FOLDERS.includes(folder)) return { ok: false, reason: `folder: which engine folder it goes in — one of ${MODEL_FOLDERS.join(', ')} (the file's path names none)` };
  return { ok: true, value: Object.freeze({ repo, file, revision, folder, name: parts.at(-1) }) };
};

/** pure — the address of a file in a repo. */
export const resolveUrl = ({ repo, file, revision }) => `https://${HF}/${repo}/resolve/${encodeURIComponent(revision)}/${file.split('/').map(encodeURIComponent).join('/')}`;

/** impure — the house's Hugging Face token (Settings › API, else the env), or null. Never logged, never handed to a being. */
const hfToken = () => {
  const env = withStoredHfToken(process.env);
  return String(env.HF_TOKEN || env.HUGGING_FACE_HUB_TOKEN || '').trim() || null;
};
/** pure — the login for an address: huggingface.co itself only. */
export const hfHeadersFor = (token) => (url) => (token && new URL(url).hostname === HF ? { Authorization: `Bearer ${token}` } : {});

/**
 * impure — a file's size and publisher SHA-256, read from the repo's listing.
 * @returns {Promise<{ok: true, bytes: number, sha256: string} | {ok: false, reason: string}>}
 */
export const hfFileInfo = async ({ repo, file, revision }, { signal, token = hfToken() } = {}) => {
  const dir = file.split('/').slice(0, -1).map(encodeURIComponent).join('/');
  const url = `https://${HF}/api/models/${repo}/tree/${encodeURIComponent(revision)}${dir ? `/${dir}` : ''}`;
  const guard = await assertSafeWebTarget(url);
  if (!guard.ok) return { ok: false, reason: `huggingface.co could not be reached (${guard.reason})` };
  const { res, error } = await requestWebOnce(url, guard.addrs, { signal, headers: { Accept: 'application/json', ...hfHeadersFor(token)(url) } });
  if (error) return { ok: false, reason: 'huggingface.co could not be reached' };
  const raw = await readBounded(res, 4 * 1024 * 1024);
  if (res.statusCode === 401 || res.statusCode === 403) return { ok: false, reason: `${repo} is private or gated and this house may not read it: accept its licence on huggingface.co with the account whose token is saved in Settings › API${token ? '' : ' (no Hugging Face token is saved)'}` };
  if (res.statusCode === 404) return { ok: false, reason: `huggingface.co has no ${repo}${dir ? ` with a folder ${dir}` : ''} at ${revision}` };
  if (res.statusCode !== 200) return { ok: false, reason: `huggingface.co answered ${res.statusCode}` };
  if (raw.truncated) return { ok: false, reason: 'huggingface.co\'s file list for that folder is too long to read' };
  let list;
  try { list = JSON.parse(raw.buf.toString('utf8')); } catch { return { ok: false, reason: 'huggingface.co answered something that is not a file list' }; }
  const entry = (Array.isArray(list) ? list : []).find((e) => e?.path === file && e.type === 'file');
  if (!entry) return { ok: false, reason: `${repo} has no file ${file} at ${revision}` };
  const sha256 = String(entry.lfs?.oid ?? '');
  if (!SHA256.test(sha256)) {
    return { ok: false, reason: /^\*+$/.test(sha256)
      ? `${repo} is gated: its files open only to an account that accepted the licence — accept it on huggingface.co with the account whose token is saved in Settings › API${token ? ' (the saved token cannot read it yet)' : ' (no Hugging Face token is saved)'}`
      : `${file} has no published SHA-256 to check it against — nothing is installed unchecked` };
  }
  return { ok: true, bytes: Number(entry.lfs.size ?? entry.size), sha256 };
};

/** impure — a file's SHA-256, read through. */
const sha256Of = (file) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  createReadStream(file).on('data', (c) => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
});

/** Where installs are kept: the platform's own data, never a being's workspace. */
export const installsLedger = () => path.join(getDataRoot(), 'image-forge', 'installs.jsonl');

/**
 * impure — download one file into the engine's model folder, checked, and record it.
 * @param {{repo, file, revision, folder, name}} want from parseInstall
 * @param {{modelsDir: string, by: string, signal?: AbortSignal, token?: string|null}} opts
 * @returns {Promise<{ok: true, path: string, bytes: number, sha256: string, already: boolean} | {ok: false, reason: string}>}
 */
export const installModel = async (want, { modelsDir, by, signal, token = hfToken() }) => {
  if (!modelsDir) return { ok: false, reason: 'the image engine has no models folder set (COMFYUI_MODELS_DIR) — nothing can be installed into it' };
  const info = await hfFileInfo(want, { signal, token });
  if (!info.ok) return info;
  const dir = path.join(modelsDir, want.folder);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, want.name);
  const record = async (already) => {
    const row = { repo: want.repo, file: want.file, revision: want.revision, folder: want.folder, name: want.name, bytes: info.bytes, sha256: info.sha256, by, at: new Date().toISOString(), ...(already ? { already: true } : {}) };
    await fs.mkdir(path.dirname(installsLedger()), { recursive: true });
    await fs.appendFile(installsLedger(), `${JSON.stringify(row)}\n`, { mode: 0o600 });
    return { ok: true, path: target, bytes: info.bytes, sha256: info.sha256, already };
  };
  const there = await fs.stat(target).catch(() => null);
  if (there) {
    if (there.size === info.bytes && await sha256Of(target) === info.sha256) return record(true);
    return { ok: false, reason: `${want.folder}/${want.name} is already in the engine and is a different file — it is left as it is; remove it first if it should be replaced` };
  }
  const part = `${target}.part-${randomUUID().slice(0, 8)}`;
  const got = await streamDownload(resolveUrl(want), part, { signal, maxBytes: Math.min(INSTALL_MAX_BYTES, info.bytes + 1), headersFor: hfHeadersFor(token) });
  if (!got.ok) return { ok: false, reason: got.error };
  if (got.bytes !== info.bytes || got.sha256 !== info.sha256) {
    await fs.rm(part, { force: true });
    return { ok: false, reason: `the download did not match what ${want.repo} published (${got.bytes} bytes, sha256 ${got.sha256.slice(0, 12)}…; expected ${info.bytes}, ${info.sha256.slice(0, 12)}…) — nothing installed` };
  }
  await fs.chmod(part, 0o644);
  await fs.rename(part, target);
  return record(false);
};

/** pure — the folders an engine also reads (extra_model_paths YAML): [{base, folders: {folder: subdir}}]. */
export const extraModelRoots = (yaml) => {
  const roots = [];
  let cur = null;
  for (const line of String(yaml ?? '').split('\n')) {
    if (/^\S[^:]*:\s*$/.test(line)) { cur = { base: null, folders: {} }; roots.push(cur); continue; }
    const m = /^\s+([A-Za-z_]+):\s*(\S.*?)\s*$/.exec(line);
    if (!m || !cur) continue;
    if (m[1] === 'base_path') cur.base = m[2]; else cur.folders[m[1]] = m[2];
  }
  return roots.filter((r) => r.base);
};

/**
 * impure — which of a pipeline's files the engine does not have, each with the install that brings it.
 * @param {Array<{folder: string, name: string, install?: {repo: string, file: string}}>} files
 * @param {{modelsDir: string, extraModelPaths?: string}} cfg
 */
export const missingModelFiles = async (files, cfg) => {
  const yaml = cfg.extraModelPaths ? await fs.readFile(cfg.extraModelPaths, 'utf8').catch(() => '') : '';
  const roots = extraModelRoots(yaml);
  const placesOf = ({ folder, name }) => [
    ...(cfg.modelsDir ? [path.join(cfg.modelsDir, folder, name)] : []),
    ...roots.filter((r) => r.folders[folder]).map((r) => path.join(r.base, r.folders[folder], name)),
  ];
  const missing = [];
  for (const f of files) {
    const found = await Promise.any(placesOf(f).map((p) => fs.access(p).then(() => true))).catch(() => false);
    if (!found) missing.push(f);
  }
  return missing;
};

/** pure — the act that brings one missing file, as a neuma files it. */
export const installAct = (f) => `forge/install-model ${JSON.stringify({ repo: f.install.repo, file: f.install.file })}`;

/**
 * impure — for a pipeline whose model (or the pipeline itself: a checkpoint, an upscaler) names its files: what the
 * engine still lacks, and how to get it. null when nothing is missing (or nothing names files).
 * @param {{files?: Array<{folder: string, name: string, install?: {repo: string, file: string}}>}} model
 * @param {{modelsDir: string, extraModelPaths?: string}} cfg
 * @param {{files?: Array<{folder: string, name: string, install?: {repo: string, file: string}}>}|null} [pipeline]
 * @returns {Promise<null | {missing: Array<object>, words: string}>}
 */
export const installsWaiting = async (model, cfg, pipeline = null) => {
  const files = [model, pipeline].flatMap((o) => (Array.isArray(o?.files) ? o.files : []));
  if (!files.length) return null;
  const missing = await missingModelFiles(files, cfg);
  if (!missing.length) return null;
  const how = missing.map((f) => (f.install ? `${f.folder}/${f.name} — ${installAct(f)}` : `${f.folder}/${f.name} (no install is named; ask your operator)`));
  return { missing, words: `NOT INSTALLED YET — the engine lacks ${missing.length === 1 ? 'one file' : `${missing.length} files`}; file each install (your operator approves it): ${how.join('; ')}` };
};
