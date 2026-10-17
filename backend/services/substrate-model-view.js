/**
 * substrate-model-view — ONE catalog + loaded identity for every surface.
 *
 * Stream, SUBSTRATE HUD, settings, witnesses: the same list, the same active
 * row. The live server may self-report /proc/self/fd/N; activeServedModelKey
 * must never leak that FD. This module matches the public key onto a catalog
 * id so a picker can sit on the row that is actually loaded.
 */
import path from 'path';
import { listCatalog } from './model-catalog.js';
import { readModelFolders, withFolderAuthorization } from './model-folder-authority.js';
import { activeServedModelKey, isServing, resolveServingLaunchConfig } from './llama-server-supervisor.js';
import { isFdServedName } from './serving-identity.js';
import { getConfig } from './llm-provider.js';

const basename = (value) => path.basename(String(value || '')).replace(/\.gguf$/i, '');

/**
 * Match a served key (path, catalog id, servingModel, or basename) to a
 * catalog entry. An FD name matches nothing — it is not an identity.
 * Pure.
 * @param {Array<{id?: string, path?: string, name?: string, servingModel?: string}>} catalog
 * @param {string|null|undefined} served
 * @returns {object|null}
 */
export const matchCatalogModel = (catalog, served) => {
  if (!served || !Array.isArray(catalog)) return null;
  const key = String(served);
  if (isFdServedName(key)) return null;
  const exact = catalog.find((m) =>
    m.id === key || m.path === key || m.servingModel === key || m.name === key);
  if (exact) return exact;
  const base = basename(key);
  return catalog.find((m) =>
    m.name === base || basename(m.path) === base || basename(m.id) === base
  ) ?? null;
};

/**
 * Authorized rows plus the loaded row even if the gate would refuse it.
 * Pure.
 * @param {Array<{id?: string, authorized?: boolean|null}>} catalog
 * @param {string|null} loadedId
 * @returns {Array}
 */
export const offerableModels = (catalog, loadedId) =>
  (Array.isArray(catalog) ? catalog : [])
    .filter((m) => m.authorized !== false || m.id === loadedId);

const publicModel = (m) => Object.freeze({
  id: m.id,
  name: m.name,
  path: m.path,
  sizeBytes: m.sizeBytes,
  authorized: m.authorized,
  servingModel: m.servingModel,
});

/**
 * The rig catalog, the loaded catalog id, and how many rows the gate withholds.
 * Impure (fs walk + live served key).
 * @param {NodeJS.ProcessEnv} [env]
 */
export const substrateModelView = async (env = process.env) => {
  // The operator's chosen folders both WIDEN discovery (a folder they added
  // lists its models) and DECIDE authorization (the folder law,
  // model-folder-authority.js — Design note, 2026-08-28.
  const folders = await readModelFolders(env);
  const catalog = withFolderAuthorization(
    listCatalog(env, folders.map((f) => f.path)), folders);
  const launch = resolveServingLaunchConfig(env);
  // LOADED is a live fact: with no server answering, the served key is only
  // the resting target — it seeds the picker but marks no row loaded.
  const serving = await isServing(launch.port, launch.host);
  const served = await activeServedModelKey(env);
  const loaded = serving ? matchCatalogModel(catalog, served) : null;
  const loadedId = loaded?.id ?? null;
  const models = offerableModels(catalog, loadedId).map(publicModel);
  return Object.freeze({
    models,
    active: loadedId,
    name: loaded?.name ?? null,
    withheld: catalog.length - models.length,
    served: loadedId || (isFdServedName(served) ? null : served) || null,
    provider: getConfig().provider,
  });
};
