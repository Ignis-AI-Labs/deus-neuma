/**
 * Model catalog — every base model tied to this rig, discoverable for ignition.
 *
 * The global ignite control lets the witness bring up ANY model the system
 * holds, not just the env-configured one — but only models the catalog names:
 * ignition never spawns an arbitrary caller-supplied path. Roots come from
 * NEUMA_MODELS_DIRS (comma-separated); the directory of LLAMA_SERVER_MODEL is
 * always included so the configured substrate is tied to the system even
 * without an explicit roots line.
 *
 * Pure grouping/naming is separated from the filesystem walk (RULE 0): the
 * grouping is provable with real inputs; the walk is `// impure` and proven
 * against a real directory tree.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const SHA256_RE = /^[0-9a-f]{64}$/;

const SHARD_RE = /-(\d{5})-of-(\d{5})\.gguf$/;
const MAX_DEPTH = 4;

/** Vision projectors ride beside a model's weights; they are not models. Pure. */
export const isProjectorFile = (name) => /mmproj/i.test(name);

// Quant/precision tokens a weights or projector filename may carry — stripped
// so a projector and its model compare by FAMILY NAME, not by precision.
// 'qat' is deliberately NOT here: it is family identity (a quantization-aware
// TRAINED line, not a post-hoc precision), and stripping it from a basename
// that ends in '-qat' would split the model from its projector
// ('gemma-3-27b-it-qat.gguf' vs 'mmproj-gemma-3-27b-it-qat-bf16.gguf').
const QUANT_TOKEN_RE = /-(bf16|f16|f32|q8_0|q8_k_p|q6_k|q5_k_m|q5_0|q4_k_m|q4_k_s|q4_0|q3_k_m|q2_k|iq4_nl)$/i;

/**
 * The family key of a served model: basename minus shard/extension and one
 * trailing quant token, lowercased. 'gemma-4-31B-it-Q8_0.gguf' →
 * 'gemma-4-31b-it'. Pure.
 * @param {string} modelPath
 */
export const modelFamilyKey = (modelPath) =>
  path.basename(modelPath).replace(SHARD_RE, '.gguf').replace(/\.gguf$/i, '')
    .replace(QUANT_TOKEN_RE, '').toLowerCase();

/**
 * The family key of a projector file: the 'mmproj-' prefix and one trailing
 * precision token stripped. 'mmproj-gemma-4-31B-it-BF16.gguf' →
 * 'gemma-4-31b-it'. Pure.
 * @param {string} name
 */
export const projectorFamilyKey = (name) =>
  path.basename(name).replace(/\.gguf$/i, '').replace(/^mmproj[-_]/i, '')
    .replace(QUANT_TOKEN_RE, '').toLowerCase();

/**
 * Catalog id from a root-relative path: shard suffix and extension stripped,
 * separators kept (they name publisher/repo the way the store lays them out).
 * Pure.
 */
export const modelIdFor = (relPath) =>
  relPath.replace(SHARD_RE, '.gguf').replace(/\.gguf$/, '');

/** Is this file the shard ignition points at (first shard or single file)? Pure. */
export const isPrimaryShard = (name) => {
  const m = name.match(SHARD_RE);
  return !m || m[1] === '00001';
};

/**
 * Group a flat gguf listing into catalog entries — one entry per model, shards
 * folded together, entry.path always the primary shard (what llama-server's
 * --model takes; it discovers siblings itself). Entries whose primary shard is
 * missing are dropped: a model that cannot be loaded is not offered. Pure.
 * @param {Array<{relPath: string, absPath: string, sizeBytes: number}>} files
 * @returns {Array<{id: string, name: string, path: string, sizeBytes: number, shards: number}>}
 */
export const groupModels = (files) => {
  const byId = new Map();
  for (const f of files) {
    const base = path.basename(f.relPath);
    if (!base.endsWith('.gguf') || isProjectorFile(base)) continue;
    const id = modelIdFor(f.relPath);
    const entry = byId.get(id) ?? { id, name: path.basename(id), path: null, sizeBytes: 0, shards: 0 };
    entry.sizeBytes += f.sizeBytes;
    entry.shards += 1;
    if (isPrimaryShard(base)) entry.path = f.absPath;
    byId.set(id, entry);
  }
  return [...byId.values()]
    .filter((e) => e.path)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(Object.freeze);
};

/**
 * The catalog roots this rig declares — the env lines plus any extra roots
 * the caller carries (the operator's AUTHORIZED MODEL FOLDERS ride in here,
 * model-folder-authority.js). Roots nested inside another root are dropped
 * so one model never appears under two ids. Pure.
 * @param {Record<string, string|undefined>} env
 * @param {string[]} [extraRoots]
 * @returns {string[]}
 */
export const modelRoots = (env, extraRoots = []) => {
  const declared = (env.NEUMA_MODELS_DIRS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (env.LLAMA_SERVER_MODEL) declared.push(path.dirname(env.LLAMA_SERVER_MODEL));
  declared.push(...(extraRoots || []).filter(Boolean));
  const unique = [...new Set(declared)];
  return unique.filter((d) => !unique.some((o) => o !== d && d.startsWith(o + path.sep)));
};

// impure — bounded recursive walk of one root for gguf files; unreadable
// directories are skipped (a stale root must not break the catalog).
const walkRoot = (root) => {
  const files = [];
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, depth + 1);
      } else if (entry.name.endsWith('.gguf')) {
        let sizeBytes = 0;
        try { sizeBytes = statSync(abs).size; } catch { /* unreadable file — size stays 0 */ }
        files.push({ relPath: path.relative(root, abs), absPath: abs, sizeBytes });
      }
    }
  };
  walk(root, 0);
  return files;
};

/**
 * Every model tied to this rig, across all declared roots — enriched with the
 * lineage evidence a model carries beside its weights when it carries any, so
 * the ignition path and the desk both see the model's declared serving
 * identity. Impure (fs walk + sidecar reads).
 * @param {Record<string, string|undefined>} env
 * @param {string[]} [extraRoots] - the operator's authorized folders
 */
export const listCatalog = (env, extraRoots = []) =>
  modelRoots(env, extraRoots).flatMap((root) => groupModels(walkRoot(root)))
    .map((entry) => {
      const evidence = lineageEvidenceFor(entry.path);
      return evidence ? Object.freeze({ ...entry, ...evidence }) : entry;
    });

/**
 * The lineage evidence a model carries beside its weights
 * (`<model>.training.json`): the serving identity the sovereign gate matches
 * on (refinement-lineage-authority.js — servingModel + servingArtifactSha256,
 * NOT the catalog path). Absent or malformed → null: the gate will refuse the
 * model as-is. impure (fs read).
 * @param {string} absPath - the model's primary shard
 */
export const lineageEvidenceFor = (absPath) => {
  try {
    const parsed = JSON.parse(readFileSync(`${absPath}.training.json`, 'utf8'));
    return typeof parsed?.servingModel === 'string' && SHA256_RE.test(String(parsed?.servingArtifactSha256))
      ? Object.freeze({ servingModel: parsed.servingModel, servingArtifactSha256: parsed.servingArtifactSha256 })
      : null;
  } catch { return null; }
};

// (The lineage-based catalog marking that lived here until 2026-08-28 —
// withServingAuthorization over the COMMITTED refinement-lineages document —
// conflated the REFINEMENT lane's law with the base catalog, reading 34
// ordinary ggufs as NOT AUTHORIZED. Authorization is folder-based now
// (model-folder-authority.js, Founder's call); the lineage gate still governs
// refined-artifact serving where it always lived,
// refinement-lineage-authority.js.)

/**
 * Resolve a caller-supplied catalog id to its entry — the ignition gate: only
 * a path the catalog itself produced is ever spawned. Impure (fs walk).
 * @param {Record<string, string|undefined>} env
 * @param {string} id
 * @param {string[]} [extraRoots] - the operator's authorized folders
 */
export const findCatalogModel = (env, id, extraRoots = []) => {
  if (!id) return null;
  const catalog = listCatalog(env, extraRoots);
  const key = String(id);
  return catalog.find((m) =>
    m.id === key || m.path === key || m.servingModel === key || m.name === key
  ) ?? null;
};

/**
 * The vision projector for a served model, when this rig holds one. Order:
 * beside the model first (the publisher's layout — llama.cpp pairs them by
 * convention), then a family-exact search across the catalog roots for when
 * the projector lives in another directory of the same rig. The roots search
 * pairs only when EXACTLY ONE candidate names this model family: an ambiguous
 * rig gets no pairing rather than a wrong one (a mismatched projector fails
 * the llama-server boot). Impure (fs reads). Returns absolute path or null.
 * @param {Record<string, string|undefined>} env
 * @param {string} modelPath - absolute gguf path being served
 */
export const findProjectorFor = (env, modelPath) => {
  if (!modelPath) return null;
  try {
    const dir = path.dirname(modelPath);
    const beside = readdirSync(dir)
      .filter((f) => f.endsWith('.gguf') && isProjectorFile(f))
      .sort();
    // One projector beside the model pairs by convention — the publisher's
    // one-model-per-dir layout, where names are often family-blind
    // ('mmproj-model-f16.gguf' says nothing about which model it projects).
    if (beside.length === 1) return path.join(dir, beside[0]);
    // Several projectors share the dir (a multi-model layout): only a single
    // family-exact candidate pairs — sort order must never hand the boot a
    // mismatched projector (llama-server refuses to start on one).
    if (beside.length > 1) {
      const family = modelFamilyKey(modelPath);
      const exact = beside.filter((f) => projectorFamilyKey(f) === family);
      if (exact.length === 1) return path.join(dir, exact[0]);
    }
  } catch { /* unreadable dir — fall through to the roots search */ }
  const family = modelFamilyKey(modelPath);
  const candidates = [...new Set(
    modelRoots(env)
      .flatMap(walkRoot)
      .filter((f) => isProjectorFile(f.relPath))
      .filter((f) => projectorFamilyKey(f.relPath) === family)
      .map((f) => f.absPath),
  )];
  return candidates.length === 1 ? candidates[0] : null;
};

// Projector hits persist for a served model; misses expire so a new projector
// is found without a restart.
export const PROJECTOR_NULL_TTL_MS = 60_000;
let projectorMemo = { key: null, value: null, at: 0 };

/** Does the memo answer for this key? Found pairings stick; nulls expire. Pure. */
export const projectorMemoHit = (entry, key, now, ttl = PROJECTOR_NULL_TTL_MS) =>
  Boolean(entry) && entry.key === key && (entry.value !== null || now - entry.at < ttl);

/** Memoized projector discovery beside a model. Impure (fs walk + clock). */
export const memoizedProjectorFor = (env, model) => {
  const key = `${model}|${env.NEUMA_MODELS_DIRS || ''}`;
  if (projectorMemoHit(projectorMemo, key, Date.now())) return projectorMemo.value;
  const value = findProjectorFor(env, model);
  projectorMemo = { key, value, at: Date.now() };
  return value;
};
