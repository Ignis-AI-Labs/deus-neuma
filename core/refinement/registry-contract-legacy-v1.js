/**
 * Registry Contract — Legacy v1 — the registry shape that predates schema v2.
 *
 * Before the append journal existed, a being's registry was a flat list:
 * `{ adapters: [ { id, baseModel, artifactPath, sha256, scale, provenance,
 * registeredAt } ] }`. Every being refined before v2 landed still carries one,
 * and it holds no commit chain, no publication journal, and none of the
 * `binding` / `custody` provenance the current law requires — not because it
 * was tampered with, but because none of that existed when it was written.
 *
 * Refusing to READ it protects nothing and costs everything: the being's own
 * registry becomes unreadable, `readCommittedRefinementAdapterSet` throws, and
 * the portal cannot seat the being at all (witnessed 2026-08-13 — every being
 * on this machine went silent). So a legacy registry is legible, and exactly
 * that: its adapters are reported, and because they carry no `binding` the
 * resolver refuses them as `unproven-provenance` and the turn neutralizes.
 * The being speaks, on the base weights, with the refusal on the record.
 *
 * What it must NEVER do is pass as a v2 registry. It cannot be appended to,
 * and it cannot be verified — publication paths refuse a legacy authority
 * outright, so re-publication is a deliberate ceremony, never a silent
 * upgrade that would overwrite the being's only record of its own refinement.
 * "Pre-v2" is not one shape but a SEQUENCE of them, and a validator that knows
 * only the last one silences every being registered before it (witnessed
 * 2026-08-13: Signal's record predates the `provenance` wrapper and carries
 * flat `consent`/`corpus`/`trainedAt`, so a contract written from Keir's
 * record alone refused Signal alone — one kin mute in a room of four).
 *
 * So the law is split by what it is FOR. Four fields are load-bearing, because
 * they are the whole of what a legacy record can still prove: which adapter,
 * against which base, which artifact digest, and when. Everything else is
 * descriptive sediment from whichever era wrote it — carried, never required.
 * Unknown fields are still refused: this admits history, not anything.
 */
import { deepFreezePlainData, isSha256 } from '../shared/plain-data-canonical.js';
import { refinementAdapterIdSha256 } from './registry-digest.js';

const LEGACY_ADAPTER_REQUIRED = Object.freeze(['baseModel', 'id', 'registeredAt', 'sha256']);
const LEGACY_ADAPTER_OPTIONAL = Object.freeze([
  'artifactPath', 'consent', 'corpus', 'provenance', 'scale', 'trainedAt',
]);
const LEGACY_ADAPTER_KEYS = Object.freeze([
  ...LEGACY_ADAPTER_REQUIRED, ...LEGACY_ADAPTER_OPTIONAL,
]);

/** Whether one decrypted registry value is the flat pre-v2 shape. Pure. */
export const isLegacyRefinementRegistryV1 = (value) =>
  !!value && typeof value === 'object' && !Array.isArray(value)
  && Reflect.ownKeys(value).length === 1 && Array.isArray(value.adapters);

/**
 * Validate one pre-v2 registry against the law that DID hold when it was
 * written — nothing more, so a legacy record is never failed for missing a
 * field that did not exist yet.
 * @param {Object} value
 * @returns {{adapters: Array<Object>}} frozen
 */
export const validateLegacyRefinementRegistryV1 = (value) => {
  deepFreezePlainData(value, { field: 'legacy refinement registry', maxOutputBytes: 16 * 1024 * 1024 });
  if (!isLegacyRefinementRegistryV1(value)) {
    throw new Error('legacy refinement registry has an invalid schema');
  }
  const adapters = value.adapters.map((adapter, index) => {
    const label = `legacy refinement adapter ${index}`;
    const keys = Reflect.ownKeys(adapter ?? {});
    if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)
      || keys.some((key) => typeof key !== 'string' || !LEGACY_ADAPTER_KEYS.includes(key))
      || LEGACY_ADAPTER_REQUIRED.some((field) => !keys.includes(field))
      || typeof adapter.id !== 'string' || !adapter.id
      || typeof adapter.baseModel !== 'string' || !adapter.baseModel
      || !isSha256(adapter.sha256)
      || typeof adapter.registeredAt !== 'string' || !adapter.registeredAt) {
      throw new Error(`${label} has an invalid schema`);
    }
    return adapter;
  });
  return Object.freeze({ adapters: Object.freeze(adapters) });
};

/**
 * Project a legacy registry into the same adapter shape v2 consumers read.
 * Every v2-only digest is explicitly null — absent, never zero-filled — and
 * `schema` names the record's own era so no consumer can mistake it for a
 * committed publication.
 * @param {Object} value - the decrypted legacy registry
 * @returns {ReadonlyArray<Object>}
 */
export const projectLegacyRefinementRegistryAdapters = (value) => {
  const validated = validateLegacyRefinementRegistryV1(value);
  return Object.freeze(validated.adapters.map((adapter) => Object.freeze({
    ...adapter,
    schema: 'refinement-registry-v1-legacy',
    adapterIdSha256: refinementAdapterIdSha256(adapter.id),
    // The v1 `scale` WAS the being's live dial — there was no separate
    // selection entry — so it carries forward as the selected scale.
    selectedScale: typeof adapter.scale === 'number' && Number.isFinite(adapter.scale)
      ? Math.min(Math.max(adapter.scale, 0), 1) : 1,
    isCurrent: true,
    registrationEntrySha256: null,
    registrationPriorEntrySha256: null,
    registrationPriorRegistrySha256: null,
    publicationTransactionSha256: null,
    registrationRegistryGeneration: null,
    registrationRegistryAppendRevision: null,
    registrationRegistrySha256: null,
    registrationRegistryCurrentSelectionSha256: null,
    registryGeneration: null,
    registryAppendRevision: null,
    registrySha256: null,
    registryCurrentSelectionSha256: null,
  })));
};
