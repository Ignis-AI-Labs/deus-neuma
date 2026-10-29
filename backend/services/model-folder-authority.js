/**
 * MODEL FOLDER AUTHORITY — the folder the operator chose IS the authorization
 * (Design note, 2026-08-28: […]).
 *
 * The store (`data/settings/model-folders.json`, machine-level like every
 * substrate setting) holds the authorized model folders and, per folder,
 * which local serving engines may load from it. UNSET, it answers with the
 * env-declared roots (NEUMA_MODELS_DIRS + the configured model's own dir) on
 * every engine — the rig behaves exactly as it did before this store
 * existed, until the operator edits the folders. The refinement lineage gate
 * is a DIFFERENT law (refined-artifact serving,
 * refinement-lineage-authority.js) and is untouched by this module.
 *
 * Pure law + isolated IO; the store path is injectable for tests
 * (NEUMA_MODEL_FOLDERS_PATH).
 */
import fs from 'fs/promises';
import path from 'path';
import { getSettingsDir } from './data-root.js';
import { modelRoots, findCatalogModel } from './model-catalog.js';
import { createLogger } from './logger.js';

const log = createLogger('ModelFolders');

/** Every local engine an authorized folder may name. */
export const FOLDER_SERVERS = Object.freeze(['llama-server', 'lm-studio', 'ollama']);

const storePath = (env = process.env) =>
  env.NEUMA_MODEL_FOLDERS_PATH || path.join(getSettingsDir(), 'model-folders.json');

/**
 * Validate and normalize a folders list: absolute unique paths, each with a
 * non-empty subset of the known engines (absent → all). Pure; throws on a
 * malformed entry — a torn store must never widen or invent authorization.
 * @param {Array<{path: string, servers?: string[]}>} folders
 */
export const normalizeFolders = (folders) => {
  if (!Array.isArray(folders)) throw new Error('folders must be a list');
  const seen = new Set();
  return folders.map((f) => {
    const p = typeof f?.path === 'string' ? f.path.trim() : '';
    if (!p || !path.isAbsolute(p)) throw new Error('every folder needs an absolute path');
    const clean = p.replace(/\/+$/, '') || '/';
    // never the whole disk: a model folder is walked for weights (audit 2026-10-28 M-02)
    if (clean === path.parse(path.resolve(clean)).root) throw new Error('a model folder cannot be the whole disk — choose the folder that holds the models');
    if (seen.has(clean)) throw new Error('folders must be unique');
    seen.add(clean);
    const servers = f?.servers === undefined ? [...FOLDER_SERVERS]
      : (Array.isArray(f.servers) ? f.servers : []).filter((s) => FOLDER_SERVERS.includes(s));
    if (servers.length === 0) throw new Error(`a folder must allow at least one engine (${FOLDER_SERVERS.join(', ')})`);
    return Object.freeze({ path: clean, servers: Object.freeze(servers) });
  });
};

/** The env roots as folder entries — the unset-store default. Pure. */
export const defaultFolders = (env) =>
  modelRoots(env).map((p) => Object.freeze({ path: p.replace(/\/+$/, '') || '/', servers: FOLDER_SERVERS }));

/**
 * The wall's answer for one model path: the authorizing folder entry, or
 * null when no chosen folder holds it. Pure.
 * @param {Array<{path: string, servers: string[]}>} folders
 * @param {string} absPath
 */
export const authorizingFolder = (folders, absPath) => {
  const p = String(absPath || '');
  return (folders || []).find((f) => p === f.path || p.startsWith(f.path + path.sep)) ?? null;
};

/**
 * The ignition gate's decision, pure: null to proceed, or the refusal text.
 * A model outside every chosen folder is refused by the folder law; a model
 * inside one is still refused for an engine its folder does not allow.
 * @param {{path?: string}|null} entry - the catalog entry being ignited
 * @param {Array<{path: string, servers: string[]}>} folders
 * @param {string} provider - the serving engine asking to load
 */
export const igniteFolderRefusal = (entry, folders, provider) => {
  const folder = authorizingFolder(folders, entry?.path);
  if (!folder) {
    return 'This model is not under an authorized model folder — folders are chosen in SETTINGS → MODELS, and the chosen folder is the authorization.';
  }
  if (!folder.servers.includes(provider)) {
    return `The folder ${folder.path} does not allow ${provider} to load from it (allowed: ${folder.servers.join(', ')}).`;
  }
  return null;
};

/**
 * Catalog entries marked by the folder law: authorized iff the model lies
 * under a chosen folder. Replaces the lineage-based catalog marking
 * (2026-08-28) — a folder the operator chose IS the authorization. Pure.
 * @param {Array<{path?: string}>} models
 * @param {Array<{path: string, servers: string[]}>} folders
 */
export const withFolderAuthorization = (models, folders) =>
  (models || []).map((m) => Object.freeze({
    ...m,
    authorized: authorizingFolder(folders, m.path) !== null,
  }));

/**
 * impure — resolve + authorize one ignite ask on the local wire, in one act:
 * the catalog entry when the folder law admits it, else the refusal and its
 * HTTP status. The route keeps a call site; the law lives here.
 * @param {Record<string, string|undefined>} env
 * @param {string} modelKey
 * @param {string} provider - the serving engine asking to load
 * @returns {Promise<{entry: object}|{error: string, status: number}>}
 */
export const resolveAuthorizedIgnition = async (env, modelKey, provider) => {
  const folders = await readModelFolders(env);
  const entry = findCatalogModel(env, modelKey, folders.map((f) => f.path));
  if (!entry) return { error: 'Unknown model — not in this rig’s catalog', status: 400 };
  const refusal = igniteFolderRefusal(entry, folders, provider);
  return refusal ? { error: refusal, status: 403 } : { entry };
};

// impure — the operator's chosen folders; the env-roots default when never
// set; a torn store answers the DEFAULT loudly rather than nothing (an
// unreadable file must not blank the rig's whole catalog).
export const readModelFolders = async (env = process.env) => {
  try {
    const parsed = JSON.parse(await fs.readFile(storePath(env), 'utf8'));
    return normalizeFolders(parsed?.folders);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.warn('store unreadable — answering the env-root default', { err: err.message });
    }
    return defaultFolders(env);
  }
};

/**
 * Persist the operator's chosen folders (normalized; atomic tmp+rename — a
 * crash mid-write must not tear the authorization wall).
 * @returns {Promise<Array>} the stored folders
 */
// impure
export const setModelFolders = async (folders, env = process.env) => {
  const normalized = normalizeFolders(folders);
  const file = storePath(env);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ folders: normalized }, null, 2));
  await fs.rename(tmp, file);
  return normalized;
};
