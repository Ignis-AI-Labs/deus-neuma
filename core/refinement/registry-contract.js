import {
  canonicalJson,
  deepFreezePlainData,
  isSha256,
} from '../shared/plain-data-canonical.js';
import { validateRefinementAdapter } from './training-authority-contract.js';
import {
  SCHEMA_VERSION, digest, refinementAdapterIdSha256,
} from './registry-digest.js';

// Barrel — the legacy v1 reader and the shared digest primitives keep their
// historical home in this module's public surface, so importers see zero
// change after the size-law split (SIZE-015).
export { refinementAdapterIdSha256 } from './registry-digest.js';
export {
  isLegacyRefinementRegistryV1,
  validateLegacyRefinementRegistryV1,
  projectLegacyRefinementRegistryAdapters,
} from './registry-contract-legacy-v1.js';
const REGISTRY_KEYS = Object.freeze([
  'appendRevision', 'currentSelection', 'currentSelectionSha256', 'entries',
  'generation', 'priorRegistrySha256', 'registrySha256', 'schemaVersion', 'selectedScale',
]);
const COMMIT_KEYS = Object.freeze([
  'appendRevision', 'currentSelectionSha256', 'generation', 'registrySha256',
  'transactionSha256',
]);
const REGISTRATION_KEYS = Object.freeze([
  'adapter', 'adapterIdSha256', 'appendRevision', 'commit', 'entrySha256', 'kind',
  'priorEntrySha256', 'selectedScale',
]);
const SELECTION_KEYS = Object.freeze([
  'adapterIdSha256', 'appendRevision', 'artifactSha256', 'commit', 'entrySha256',
  'kind', 'priorEntrySha256', 'selectedScale',
]);

const exactKeys = (value, expected, label) => {
  deepFreezePlainData(value, { field: label, maxOutputBytes: 16 * 1024 * 1024 });
  const keys = Reflect.ownKeys(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || keys.length !== expected.length
    || keys.some((key) => typeof key !== 'string' || !expected.includes(key))) {
    throw new Error(`${label} has an invalid schema`);
  }
  return value;
};
const positive = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`);
  return value;
};
const invalidScale = (message) => Object.assign(new Error(message), {
  code: 'INVALID_ADAPTER_SCALE',
});
const selectedScale = (value, adapter = null) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidScale('registry selectedScale must be finite in [0, 1]');
  }
  if (adapter && !adapter.binding.approvedScales.includes(value)) {
    throw invalidScale('registry selectedScale must be an exact approved scale');
  }
  return value;
};
const nullableSha256 = (value, label) => {
  if (value !== null && !isSha256(value)) throw new Error(`${label} must be null or sha256`);
  return value;
};
export const refinementRegistryCurrentSelectionSha256 = (selection) => {
  exactKeys(selection, ['adapterIdSha256', 'artifactSha256'], 'registry current selection');
  if (!isSha256(selection.adapterIdSha256) || !isSha256(selection.artifactSha256)) {
    throw new Error('registry current selection digests are invalid');
  }
  return digest('neuma.refinement.registry-current-selection', selection);
};

const commitCore = (commit) => Object.freeze({
  transactionSha256: commit.transactionSha256,
  generation: commit.generation,
  appendRevision: commit.appendRevision,
  currentSelectionSha256: commit.currentSelectionSha256,
});
const entryCore = (entry) => entry.kind === 'adapter-registration-v2'
  ? Object.freeze({
    kind: entry.kind,
    appendRevision: entry.appendRevision,
    priorEntrySha256: entry.priorEntrySha256,
    adapterIdSha256: entry.adapterIdSha256,
    adapter: entry.adapter,
    selectedScale: entry.selectedScale,
    commit: commitCore(entry.commit),
  })
  : Object.freeze({
    kind: entry.kind,
    appendRevision: entry.appendRevision,
    priorEntrySha256: entry.priorEntrySha256,
    adapterIdSha256: entry.adapterIdSha256,
    artifactSha256: entry.artifactSha256,
    selectedScale: entry.selectedScale,
    commit: commitCore(entry.commit),
  });

const selectionOf = (entry) => Object.freeze({
  adapterIdSha256: entry.adapterIdSha256,
  artifactSha256: entry.kind === 'adapter-registration-v2'
    ? entry.adapter.sha256
    : entry.artifactSha256,
});

const registryCore = ({ generation, priorRegistrySha256, entries }) => {
  const current = entries.at(-1);
  const currentSelection = selectionOf(current);
  const currentSelectionSha256 = refinementRegistryCurrentSelectionSha256(currentSelection);
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    generation,
    appendRevision: current.appendRevision,
    priorRegistrySha256,
    entries: Object.freeze(entries.map((entry) => Object.freeze({
      ...entryCore(entry),
      entrySha256: entry.entrySha256,
    }))),
    currentSelection,
    currentSelectionSha256,
    selectedScale: current.selectedScale,
  });
};

const registryDigest = (core) => digest('neuma.refinement.adapter-registry', core);
const entryDigest = (entry) => digest('neuma.refinement.adapter-registry-entry', entryCore(entry));

const assertCommit = (commit, expected = {}) => {
  exactKeys(commit, COMMIT_KEYS, 'registry commit');
  positive(commit.generation, 'registry commit generation');
  positive(commit.appendRevision, 'registry commit appendRevision');
  if (!isSha256(commit.transactionSha256) || !isSha256(commit.registrySha256)
    || !isSha256(commit.currentSelectionSha256)
    || Object.entries(expected).some(([field, value]) => commit[field] !== value)) {
    throw new Error('registry commit does not match its exact revision');
  }
  return Object.freeze({ ...commit });
};

const assertEntry = (raw, index, priorEntrySha256, registrations) => {
  const expectedRevision = index + 1;
  const kind = raw?.kind;
  const keys = kind === 'adapter-registration-v2' ? REGISTRATION_KEYS
    : kind === 'adapter-selection-v2' ? SELECTION_KEYS : null;
  if (!keys) throw new Error('registry entry kind is unsupported');
  exactKeys(raw, keys, 'registry entry');
  if (positive(raw.appendRevision, 'registry appendRevision') !== expectedRevision
    || raw.priorEntrySha256 !== priorEntrySha256
    || !isSha256(raw.adapterIdSha256)) {
    throw new Error('registry entry revision chain is invalid');
  }
  selectedScale(raw.selectedScale);
  const commit = assertCommit(raw.commit, {
    generation: expectedRevision,
    appendRevision: expectedRevision,
  });
  let entry;
  if (kind === 'adapter-registration-v2') {
    const adapter = validateRefinementAdapter(raw.adapter);
    if (!adapter.binding) throw new Error('registry adapter requires an immutable binding');
    selectedScale(raw.selectedScale, adapter);
    const adapterIdSha256 = refinementAdapterIdSha256(adapter.id);
    if (adapterIdSha256 !== raw.adapterIdSha256 || registrations.has(adapterIdSha256)) {
      throw new Error('registry adapter identity is duplicated or invalid');
    }
    registrations.set(adapterIdSha256, adapter);
    entry = { ...raw, adapter, commit };
  } else {
    const adapter = registrations.get(raw.adapterIdSha256);
    selectedScale(raw.selectedScale, adapter);
    if (!adapter || raw.artifactSha256 !== adapter.sha256) {
      throw new Error('registry selection does not name one registered artifact');
    }
    entry = { ...raw, commit };
  }
  if (raw.entrySha256 !== entryDigest(entry)) throw new Error('registry entry digest mismatch');
  return Object.freeze(entry);
};

/** Strictly validate every prefix and committed append of one encrypted v2 registry. */
export const validateRefinementRegistryV2 = (value) => {
  deepFreezePlainData(value, { field: 'refinement registry', maxOutputBytes: 16 * 1024 * 1024 });
  exactKeys(value, REGISTRY_KEYS, 'refinement registry');
  if (value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.entries) || !value.entries.length) {
    throw new Error('refinement registry must be a nonempty schema v2 append log');
  }
  positive(value.generation, 'registry generation');
  positive(value.appendRevision, 'registry appendRevision');
  nullableSha256(value.priorRegistrySha256, 'registry prior digest');
  if (!isSha256(value.registrySha256) || !isSha256(value.currentSelectionSha256)) {
    throw new Error('registry canonical digests are invalid');
  }
  const registrations = new Map();
  const entries = [];
  let priorEntrySha256 = null;
  let priorRegistrySha256 = null;
  let priorSelection = null;
  let priorScale = null;
  for (let index = 0; index < value.entries.length; index += 1) {
    const entry = assertEntry(value.entries[index], index, priorEntrySha256, registrations);
    const nextSelection = selectionOf(entry);
    if (entry.kind === 'adapter-selection-v2'
      && priorSelection?.adapterIdSha256 === nextSelection.adapterIdSha256
      && priorSelection?.artifactSha256 === nextSelection.artifactSha256
      && priorScale === entry.selectedScale) {
      throw new Error('registry contains a duplicate no-op selection');
    }
    entries.push(entry);
    const generation = index + 1;
    const core = registryCore({ generation, priorRegistrySha256, entries });
    const registrySha256 = registryDigest(core);
    const commit = assertCommit(entry.commit, {
      generation,
      appendRevision: entry.appendRevision,
      registrySha256,
      currentSelectionSha256: core.currentSelectionSha256,
    });
    entries[index] = Object.freeze({ ...entry, commit });
    priorEntrySha256 = entry.entrySha256;
    priorRegistrySha256 = registrySha256;
    priorSelection = nextSelection;
    priorScale = entry.selectedScale;
  }
  const expectedPrior = entries.length === 1 ? null : entries.at(-2).commit.registrySha256;
  const core = registryCore({
    generation: entries.length,
    priorRegistrySha256: expectedPrior,
    entries,
  });
  const exact = {
    schemaVersion: SCHEMA_VERSION,
    generation: entries.length,
    appendRevision: entries.length,
    priorRegistrySha256: expectedPrior,
    entries,
    currentSelection: core.currentSelection,
    currentSelectionSha256: core.currentSelectionSha256,
    selectedScale: core.selectedScale,
    registrySha256: registryDigest(core),
  };
  for (const field of REGISTRY_KEYS) {
    if (field === 'entries') continue;
    if (canonicalJson(value[field]) !== canonicalJson(exact[field])) {
      throw new Error(`refinement registry ${field} does not match its append log`);
    }
  }
  return deepFreezePlainData(exact);
};

const preparedRevision = (current, nextEntry, transactionSha256) => {
  if (!isSha256(transactionSha256)) {
    throw new Error('registry preparation requires a publication transaction digest');
  }
  const previous = current == null ? null : validateRefinementRegistryV2(current);
  const generation = (previous?.generation ?? 0) + 1;
  if (!Number.isSafeInteger(generation)) throw new Error('registry generation overflow');
  const base = Object.freeze({
    ...nextEntry,
    appendRevision: generation,
    priorEntrySha256: previous?.entries.at(-1).entrySha256 ?? null,
  });
  const currentSelection = selectionOf(base);
  const currentSelectionSha256 = refinementRegistryCurrentSelectionSha256(currentSelection);
  const commit = {
    transactionSha256,
    generation,
    appendRevision: generation,
    currentSelectionSha256,
    registrySha256: null,
  };
  const entrySha256 = entryDigest({ ...base, commit });
  const pending = Object.freeze({ ...base, commit, entrySha256 });
  const priorRegistrySha256 = previous?.registrySha256 ?? null;
  const pendingEntries = Object.freeze([...(previous?.entries ?? []), pending]);
  const core = registryCore({ generation, priorRegistrySha256, entries: pendingEntries });
  const registrySha256 = registryDigest(core);
  const entry = Object.freeze({
    ...pending,
    commit: Object.freeze({ ...commit, registrySha256 }),
  });
  const entries = Object.freeze([...(previous?.entries ?? []), entry]);
  const registry = validateRefinementRegistryV2({
    schemaVersion: SCHEMA_VERSION,
    generation,
    appendRevision: generation,
    priorRegistrySha256,
    entries,
    currentSelection,
    currentSelectionSha256,
    selectedScale: base.selectedScale,
    registrySha256,
  });
  return deepFreezePlainData({
    kind: 'refinement-registry-prepared-v2',
    transactionSha256,
    registry,
  });
};

export const prepareRefinementAdapterRegistration = (
  current,
  adapter,
  transactionSha256,
) => {
  const validated = validateRefinementAdapter(adapter);
  if (!validated.binding) throw new Error('registry registration requires an immutable adapter binding');
  const previous = current == null ? null : validateRefinementRegistryV2(current);
  const adapterIdSha256 = refinementAdapterIdSha256(validated.id);
  if (previous?.entries.some((entry) => entry.kind === 'adapter-registration-v2'
    && entry.adapterIdSha256 === adapterIdSha256)) {
    throw new Error('registry adapter id is already registered');
  }
  return preparedRevision(previous, {
    kind: 'adapter-registration-v2',
    adapterIdSha256,
    adapter: validated,
    selectedScale: selectedScale(validated.binding.adapterScale, validated),
  }, transactionSha256);
};

export const prepareRefinementAdapterSelection = (
  current,
  adapterId,
  scale,
  transactionSha256,
) => {
  const previous = validateRefinementRegistryV2(current);
  const adapterIdSha256 = refinementAdapterIdSha256(adapterId);
  const registration = previous.entries.find((entry) =>
    entry.kind === 'adapter-registration-v2' && entry.adapterIdSha256 === adapterIdSha256);
  if (!registration) throw new Error('registry selection names no registered adapter');
  return preparedRevision(previous, {
    kind: 'adapter-selection-v2',
    adapterIdSha256,
    artifactSha256: registration.adapter.sha256,
    selectedScale: selectedScale(scale, registration.adapter),
  }, transactionSha256);
};

export const commitPreparedRefinementRegistry = (prepared, transactionSha256) => {
  if (prepared?.kind !== 'refinement-registry-prepared-v2'
    || prepared.transactionSha256 !== transactionSha256
    || !isSha256(transactionSha256)) {
    throw new Error('registry commit requires its exact prepared transaction digest');
  }
  const registry = validateRefinementRegistryV2(prepared.registry);
  const commit = registry.entries.at(-1).commit;
  if (commit.transactionSha256 !== transactionSha256
    || commit.registrySha256 !== registry.registrySha256
    || commit.generation !== registry.generation
    || commit.appendRevision !== registry.appendRevision
    || commit.currentSelectionSha256 !== registry.currentSelectionSha256) {
    throw new Error('prepared registry does not carry its exact committed tuple');
  }
  return registry;
};
/** Recover the exact prior canonical prefix without trusting mutable caller state. */
export const priorRefinementRegistryRevision = (value) => {
  const current = validateRefinementRegistryV2(value);
  if (current.entries.length === 1) return null;
  const entries = Object.freeze(current.entries.slice(0, -1));
  const tail = entries.at(-1);
  const selection = selectionOf(tail);
  const priorRegistrySha256 = entries.length === 1
    ? null
    : entries.at(-2).commit.registrySha256;
  return validateRefinementRegistryV2({
    schemaVersion: SCHEMA_VERSION,
    generation: entries.length,
    appendRevision: entries.length,
    priorRegistrySha256,
    entries,
    currentSelection: selection,
    currentSelectionSha256: refinementRegistryCurrentSelectionSha256(selection),
    selectedScale: tail.selectedScale,
    registrySha256: tail.commit.registrySha256,
  });
};

export const projectRefinementRegistryAdapters = (registry) => {
  const validated = validateRefinementRegistryV2(registry);
  return Object.freeze(validated.entries
    .filter(({ kind }) => kind === 'adapter-registration-v2')
    .map((entry) => {
      const isCurrent = entry.adapterIdSha256 === validated.currentSelection.adapterIdSha256
        && entry.adapter.sha256 === validated.currentSelection.artifactSha256;
      return Object.freeze({
        ...entry.adapter,
        adapterIdSha256: entry.adapterIdSha256,
        selectedScale: isCurrent ? validated.selectedScale : 0,
        isCurrent,
        registrationEntrySha256: entry.entrySha256,
        registrationPriorEntrySha256: entry.priorEntrySha256,
        registrationPriorRegistrySha256: entry.appendRevision === 1
          ? null
          : validated.entries[entry.appendRevision - 2].commit.registrySha256,
        publicationTransactionSha256: entry.commit.transactionSha256,
        registrationRegistryGeneration: entry.commit.generation,
        registrationRegistryAppendRevision: entry.commit.appendRevision,
        registrationRegistrySha256: entry.commit.registrySha256,
        registrationRegistryCurrentSelectionSha256: entry.commit.currentSelectionSha256,
        registryGeneration: validated.generation,
        registryAppendRevision: validated.appendRevision,
        registrySha256: validated.registrySha256,
        registryCurrentSelectionSha256: validated.currentSelectionSha256,
      });
    }));
};
