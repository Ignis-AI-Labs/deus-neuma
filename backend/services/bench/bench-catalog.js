/**
 * bench-catalog — the harness's DECLARED side, read-only: which cells exist
 * (the questions), which models are registered (the cars), and which window
 * plans are on file. This is the validation source for the launch plane — a
 * launch param that is not in the catalog is refused, never sanitized.
 *
 * models.json ground truth (verified 2026-09-23): the file's top level is
 * {schemaVersion, $comment, models} — the model table lives under `.models`,
 * keyed by model id. listModels reads that table; the flat fallback exists
 * only so a hand-written models.json without the wrapper still reads.
 */

import { readdir, readFile } from 'node:fs/promises';
import { harnessRoot, resolveInside } from './bench-paths.js';

const CELL_ID_RE = /^[A-Za-z0-9-]+$/;
// Model keys carry version dots (qwen3.8-27b) — a superset of the cell charset.
const MODEL_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const PLAN_FILE_RE = /^[a-z0-9-]+\.json$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Lay a variant over its family's base CELL.json — the harness's own law
 * (benchmarks runtime/cell.js applyVariant, 2026-09-26): objects merge key
 * by key, arrays and scalars replace whole, nothing is deleted. Pure.
 */
export const applyVariant = (base, overlay) => {
  const out = { ...base };
  for (const [key, value] of Object.entries(overlay ?? {})) {
    out[key] = isPlainObject(base?.[key]) && isPlainObject(value) ? applyVariant(base[key], value) : value;
  }
  return out;
};

/**
 * pure — the desk's projection of one parsed CELL.json. `family` is the base
 * cell's id (a cell is its own family); `variant` is true for an overlay
 * from the family's variants/ dir — the picker shows ONE row per family and
 * offers the variants beneath it.
 */
const projectCell = (cell, family = cell?.id ?? null) => ({
  id: cell?.id ?? null,
  label: cell?.label ?? null,
  tier: cell?.tier ?? null,
  dimensions: Array.isArray(cell?.dimensions) ? cell.dimensions : [],
  arms: Array.isArray(cell?.arms) ? cell.arms : [],
  adapter: cell?.adapter?.id ?? null,
  cost: isPlainObject(cell?.cost) ? cell.cost : null,
  family,
  variant: family !== null && cell?.id !== family,
});

/**
 * A family's variants: cells/<tier>/<family>/variants/<id>.json, each laid
 * over the base and projected as a cell in its own right (its id is its file
 * name — the harness refuses any other). An unreadable overlay is skipped.
 * impure (filesystem reads)
 */
const readVariants = async (root, tier, family, base) => {
  let files;
  try {
    files = await readdir(resolveInside(root, 'cells', tier, family, 'variants'), { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.isFile() || !f.name.endsWith('.json')) continue;
    const id = f.name.slice(0, -'.json'.length);
    if (!CELL_ID_RE.test(id)) continue;
    try {
      const overlay = JSON.parse(await readFile(resolveInside(root, 'cells', tier, family, 'variants', f.name), 'utf8'));
      if (overlay?.id !== id) continue; // the harness refuses a variant whose id is not its file name
      out.push(projectCell(applyVariant(base, overlay), base.id));
    } catch { /* a broken overlay is not a declared cell */ }
  }
  return out;
};

/**
 * Every declared cell: cells/<tier>/<cell>/CELL.json plus each family's
 * variants/<id>.json, projected. A cell dir with an unreadable CELL.json is
 * skipped, never fatal.
 * @param {string} [root]
 * @returns {Promise<Array<object>>}
 */
// impure (filesystem reads)
export const listCells = async (root = harnessRoot()) => {
  let tiers;
  try {
    tiers = await readdir(resolveInside(root, 'cells'), { withFileTypes: true });
  } catch {
    return [];
  }
  const cells = [];
  for (const tier of tiers) {
    if (!tier.isDirectory() || tier.name.startsWith('_')) continue;
    let dirs;
    try {
      dirs = await readdir(resolveInside(root, 'cells', tier.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      let base;
      try {
        base = JSON.parse(await readFile(resolveInside(root, 'cells', tier.name, dir.name, 'CELL.json'), 'utf8'));
        cells.push(projectCell(base));
      } catch { continue; /* no CELL.json here, or a broken one — not a declared cell */ }
      cells.push(...await readVariants(root, tier.name, dir.name, base));
    }
  }
  cells.sort((a, b) => String(a.tier).localeCompare(String(b.tier)) || String(a.id).localeCompare(String(b.id)));
  return cells;
};

/**
 * One cell by its declared id, or null. The id is charset-validated before
 * any lookup — it arrives from a client.
 * @param {string} [root]
 * @param {string} id
 * @returns {Promise<?object>}
 */
// impure (filesystem reads)
export const getCell = async (root = harnessRoot(), id) => {
  if (typeof id !== 'string' || !CELL_ID_RE.test(id)) return null;
  const cells = await listCells(root);
  return cells.find((cell) => cell.id === id) ?? null;
};

/**
 * The raw model table (key → entry). See the module note for the shape.
 * @param {string} [root]
 * @returns {Promise<object>}
 */
// impure (filesystem read)
const readModelsTable = async (root = harnessRoot()) => {
  let raw;
  try {
    raw = JSON.parse(await readFile(resolveInside(root, 'models.json'), 'utf8'));
  } catch {
    return {};
  }
  if (isPlainObject(raw?.models)) return raw.models;
  if (isPlainObject(raw)) {
    // Flat fallback: a models.json without the wrapper — drop metadata keys.
    const { $comment, schemaVersion, ...rest } = raw;
    return Object.fromEntries(Object.entries(rest).filter(([, v]) => isPlainObject(v)));
  }
  return {};
};

/**
 * Registered models with the flags the desk needs: [{key, label, servedId,
 * fileName, hasSha256, quantization}]. `fileName` (the gguf basename) is how
 * the desk matches the SERVED artifact to a registry entry when the served id
 * is a path.
 * @param {string} [root]
 * @returns {Promise<Array<object>>}
 */
// impure (filesystem read)
export const listModels = async (root = harnessRoot()) => {
  const table = await readModelsTable(root);
  return Object.entries(table).map(([key, entry]) => ({
    key,
    label: entry?.label ?? null,
    servedId: entry?.servedId ?? null,
    fileName: typeof entry?.file === 'string' ? entry.file.split('/').pop() : null,
    hasSha256: typeof entry?.sha256 === 'string' && entry.sha256.length > 0,
    quantization: entry?.quantization ?? null,
  }));
};

/**
 * One registered model entry by key (raw entry plus its key), or null.
 * @param {string} [root]
 * @param {string} key
 * @returns {Promise<?object>}
 */
// impure (filesystem read)
export const getModel = async (root = harnessRoot(), key) => {
  if (typeof key !== 'string' || !MODEL_KEY_RE.test(key)) return null;
  const table = await readModelsTable(root);
  const entry = table[key];
  return isPlainObject(entry) ? { key, ...entry } : null;
};

/**
 * Window plans on file: plans/<name>.json → {name, windowHours, model,
 * groupCount, stepCount}. Plan filenames must match the harness's own
 * charset — anything else is not a plan this plane will name.
 * @param {string} [root]
 * @returns {Promise<Array<object>>}
 */
// impure (filesystem reads)
export const listPlans = async (root = harnessRoot()) => {
  let entries;
  try {
    entries = await readdir(resolveInside(root, 'plans'), { withFileTypes: true });
  } catch {
    return [];
  }
  const plans = [];
  for (const entry of entries) {
    if (!entry.isFile() || !PLAN_FILE_RE.test(entry.name)) continue;
    try {
      const raw = JSON.parse(await readFile(resolveInside(root, 'plans', entry.name), 'utf8'));
      const groups = Array.isArray(raw?.groups) ? raw.groups : [];
      plans.push({
        name: entry.name.replace(/\.json$/, ''),
        windowHours: raw?.windowHours ?? null,
        model: raw?.model ?? null,
        groupCount: groups.length,
        stepCount: groups.reduce((n, g) => n + (Array.isArray(g?.steps) ? g.steps.length : 0), 0),
      });
    } catch { /* a broken plan file is not listed as launchable */ }
  }
  plans.sort((a, b) => a.name.localeCompare(b.name));
  return plans;
};

/**
 * Is this a plan name the plane will put on an argv? The charset the harness
 * itself uses, no path separators by construction.
 * @param {*} name
 * @returns {boolean}
 */
export const isPlanName = (name) => typeof name === 'string' && /^[a-z0-9-]+$/.test(name);
