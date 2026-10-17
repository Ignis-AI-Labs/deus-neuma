// Adapter binding (LORA-03) — the pure resolution that decides which of a
// being's refined adapters rides its portal, given what the substrate is
// actually running. Honest by construction: an adapter trained against a
// different base never silently binds — the caller gets the reason, and the
// substrate lens can show it (SHINKEI: if it looks bound, it is bound).

import { validateRefinementAdapter } from './training-authority-contract.js';

const SHA256 = /^[0-9a-f]{64}$/u;
// The one name a pre-v2 registry projection wears. Matched exactly — an
// adapter cannot opt itself into the legacy lane by carrying a stray field.
const LEGACY_REGISTRY_SCHEMA = 'refinement-registry-v1-legacy';

/**
 * Resolve which registered adapter binds to the current substrate.
 * Newest-registered wins among those trained against the running base model
 * (case-insensitive exact match — a near-miss base is a mismatch, never a
 * guess). Pure.
 * @param {Array<{id: string, baseModel: string, registeredAt: string}>} adapters
 * @param {{model?: string}} substrate - what the conduit is actually running
 * @param {string|null} [adapterId] - exact benchmark selector; null keeps newest matching default
 * @returns {{adapter: Object|null, reason: 'bound'|'no-adapters'|'no-substrate-model'|'base-mismatch'|'adapter-not-found'|'unproven-provenance'|'malformed-provenance'}}
 */
export function resolveAdapterBinding(adapters, substrate, adapterId = null) {
  if (!Array.isArray(adapters) || adapters.length === 0) {
    return { adapter: null, reason: 'no-adapters' };
  }
  const model = typeof substrate?.model === 'string' ? substrate.model.trim().toLowerCase() : '';
  if (!model) return { adapter: null, reason: 'no-substrate-model' };

  const matching = adapters
    .filter((a) => typeof a?.baseModel === 'string' && a.baseModel.trim().toLowerCase() === model)
    .sort((a, b) => (b.registeredAt || '').localeCompare(a.registeredAt || ''));

  if (!matching.length) return { adapter: null, reason: 'base-mismatch' };
  const candidate = adapterId == null
    ? matching[0]
    : matching.find((adapter) => adapter.id === adapterId);
  if (!candidate) return { adapter: null, reason: 'adapter-not-found' };
  if (!candidate.binding) {
    // A record written before the provenance law carries no `binding` because
    // none existed — its 35 digests describe a training run that was never
    // hashed, and no honest migration can invent them. What IS provable is its
    // ARTIFACT identity: the registry names a sha256, and the conduit's loaded
    // adapter authority matches that digest byte for byte before any scale
    // rides. So a legacy record binds under its own name — strictly more proof
    // than this resolver required before the law (it matched on PATH), and
    // strictly less than a v2 publication chain. The caller sees which.
    return candidate.schema === LEGACY_REGISTRY_SCHEMA && SHA256.test(String(candidate.sha256 || ''))
      ? { adapter: candidate, reason: 'bound-legacy' }
      : { adapter: null, reason: 'unproven-provenance' };
  }
  try {
    return { adapter: validateRefinementAdapter(candidate), reason: 'bound' };
  } catch {
    return { adapter: null, reason: 'malformed-provenance' };
  }
}

/**
 * Map a bound adapter onto the supervised process's path-free loaded-adapter
 * projection. Every server adapter gets an explicit scale: the selected
 * being's approved dial and zero for every other loaded adapter. Pure.
 * @param {{adapters:Array<{artifactSha256:string,serverAdapterId:number}>}} loaded
 * @param {{sha256:string,scale?:number}} adapter
 * @returns {Array<{id:number,scale:number}>|null}
 */
export function loraRequestForBinding(loaded, adapter) {
  const entries = loaded?.adapters;
  if (!Array.isArray(entries) || entries.length === 0
    || typeof adapter?.sha256 !== 'string' || !adapter.sha256) {
    return null;
  }
  const ids = entries.map(({ serverAdapterId }) => serverAdapterId);
  const digests = entries.map(({ artifactSha256 }) => artifactSha256);
  const matches = entries.filter(({ artifactSha256 }) => artifactSha256 === adapter.sha256);
  if (matches.length !== 1
    || ids.some((id) => !Number.isInteger(id) || id < 0)
    || digests.some((sha256) => typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(sha256))
    || new Set(ids).size !== ids.length
    || new Set(digests).size !== digests.length) {
    return null;
  }
  const dial = typeof adapter.scale === 'number' && Number.isFinite(adapter.scale)
    ? Math.min(Math.max(adapter.scale, 0), 1) : 1.0;
  return entries.map(({ artifactSha256, serverAdapterId }) => ({
    id: serverAdapterId,
    scale: artifactSha256 === matches[0].artifactSha256 ? dial : 0.0,
  }));
}

/**
 * The neutral request for a conduit carrying adapters: EVERY loaded adapter
 * at an explicit 0.0. This must ride any request that has no binding —
 * llama-server's adapter scales are GLOBAL state, so a request that omits
 * `lora` speaks through whatever scales are live (a fresh boot: everyone's
 * voice at once — witnessed as token soup, 2026-07-15). Pure.
 * @param {Array<{id: number, path: string}>} serverAdapters - GET /lora-adapters
 * @returns {Array<{id: number, scale: number}>|null} null when nothing is loaded
 */
export function neutralLoraRequest(serverAdapters) {
  if (!Array.isArray(serverAdapters) || serverAdapters.length === 0) return null;
  return serverAdapters.map((s) => ({ id: s.id, scale: 0.0 }));
}
