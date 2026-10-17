// Write a REAL v2 refinement adapter registry through the public store.
//
// Every byte on disk here is produced by production code: the adapter record
// by `validateRefinementAdapter`, the revision by
// `prepareRefinementAdapterRegistration` / `prepareRefinementAdapterSelection`
// + `commitPreparedRefinementRegistry`, and the file itself by
// `commitRefinementRegistryRevision` — the same held-inode CAS, the same real
// AES-GCM envelope under the being's own DEK, the same fsync and directory
// sync production uses. Reading back goes through
// `openRefinementRegistryAuthority`, which authenticates the ciphertext and
// revalidates every append prefix with no knowledge that a test wrote it.
// No mock, stub, fake, or spy anywhere in that path (RULE 0).
//
// This exists because the v1 workspace adapter delegate (`registerAdapter` /
// `setAdapterScale` / `listAdapters`) was deleted: it read a v1 `{adapters:[…]}`
// blob from the path that now holds canonical schema v2, so it answered `[]`
// on every real being. The registry-level tests that used it need a genuine
// committed v2 entry, not the full ceremony-bound publication path.
//
// Scope: the registry file only. A serving read that also verifies the
// publication journal (`openCurrentRefinementRegistryAuthority`) needs
// `commitFirstRefinementRegistration` from `committed-refinement-registry.js`.
//
// This helper owns the store's mandatory `{signal, deadline}` control so no
// call site can forget one, and it releases every retained descriptor so no
// registry FD leaks between tests.

import { performance } from 'node:perf_hooks';
import {
  commitPreparedRefinementRegistry,
  prepareRefinementAdapterRegistration,
  prepareRefinementAdapterSelection,
  projectRefinementRegistryAdapters,
} from '../../core/refinement/registry-contract.js';
// The store lives HERE, beside its only consumer: production reads registries
// through backend/services/refinement-registry-authority.js (read/verify only)
// and writes them through the ceremony-bound publication path. This store is
// the test lane's way to mint a genuine committed v2 entry without a full
// ceremony — real crypto, real CAS, and it MUST track the production read
// format or these fixtures start lying.
import {
  commitRefinementRegistryRevision,
  openRefinementRegistryAuthority,
} from './refinement-registry-store.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import {
  refinementCustodyIdentity,
  validateRefinementAdapter,
} from '../../core/refinement/training-authority-contract.js';
import { committedAdapterRecord, servingLineageFor } from './committed-refinement-registry.js';

const DEADLINE_MS = 30_000;
const NO_ADAPTERS = Object.freeze([]);

// The store refuses any call missing either control
// (`refinement-registry-store.js` `controls`), so it is minted here once per
// call rather than left to each call site.
const control = () => Object.freeze({
  signal: new AbortController().signal,
  deadline: performance.now() + DEADLINE_MS,
});

const release = async (...sources) => {
  const settled = await Promise.allSettled(
    sources.filter(Boolean).map((source) => source.close()),
  );
  const failures = settled
    .filter(({ status }) => status === 'rejected')
    .map(({ reason }) => reason);
  if (failures.length) {
    throw new AggregateError(failures, 'registry fixture descriptor release failed');
  }
};

/**
 * Hold the current registry inode, commit one revision against it, and release
 * both the prior and the committed authority.
 * @param {Object} workspace - the real NeumaWorkspace
 * @param {string} neumaId
 * @param {(current: (Object|null)) => Object} revise - pure prepared → committed registry
 * @returns {Promise<ReadonlyArray<Object>>} the committed projection
 */
// impure — real encrypted read, held-inode CAS, real fsync
const commitRevision = async (workspace, neumaId, revise) => {
  const held = await openRefinementRegistryAuthority(workspace, neumaId, control());
  let committed = null;
  let primary = null;
  try {
    committed = await commitRefinementRegistryRevision({
      workspace,
      neumaId,
      registry: revise(held.registry),
      expectedSource: held.source,
      options: control(),
    });
    return projectRefinementRegistryAdapters(committed.registry);
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      await release(held.source, committed?.source);
    } catch (cleanup) {
      throw primary
        ? new AggregateError([primary, cleanup], 'registry fixture revision and release failed')
        : cleanup;
    }
  }
};

/**
 * The being's own custody identity, derived from its real persisted DNA.
 * Throws the contract's own refusal when no sovereign DNA exists yet.
 * @param {Object} workspace
 * @param {string} neumaId
 * @returns {Promise<{subjectNeumaId: string, sovereignDnaSha256: string}>}
 */
// impure — reads the being's encrypted DNA
export const fixtureAdapterCustody = async (workspace, neumaId) =>
  refinementCustodyIdentity(neumaId, await workspace.readDNA(neumaId));

/**
 * One production-validated adapter record carrying the exact ADAPTER_FIELDS
 * set — no `artifactPath`, which the record validator refuses. Every field a
 * test does not name is filled with a real, internally consistent value, and
 * a named `registeredAt` is revalidated against its own provenance.
 * @param {Object} spec
 * @returns {Object} the frozen validated record
 */
export const fixtureAdapterRecord = ({
  id,
  custody,
  baseModel = 'fixture-serving-base',
  lineage = servingLineageFor(baseModel),
  ceremonyId = `${id}-ceremony`,
  sha256 = refinementSha256({ fixtureArtifact: id }),
  scale = 1,
  approvedScales = undefined,
  registeredAt = null,
}) => {
  const record = committedAdapterRecord({
    adapterId: id,
    approvedScales,
    artifactSha256: sha256,
    ceremonyId,
    custody,
    lineage,
    scale,
  });
  return registeredAt === null
    ? record
    : validateRefinementAdapter({ ...record, registeredAt });
};

/**
 * Register one adapter into the being's real encrypted v2 registry.
 * @param {Object} workspace - the real NeumaWorkspace
 * @param {string} neumaId
 * @param {string} id - the adapter id
 * @param {Object} [overrides] - any other field of `fixtureAdapterRecord`
 * @returns {Promise<Object>} the committed projection of the new record
 */
// impure
export const registerFixtureAdapter = async (workspace, neumaId, id, overrides = {}) => {
  const custody = overrides.custody ?? await fixtureAdapterCustody(workspace, neumaId);
  const adapter = fixtureAdapterRecord({ ...overrides, custody, id });
  const adapters = await commitRevision(workspace, neumaId, (current) => {
    const transactionSha256 = refinementSha256({
      fixtureRegistration: adapter,
      generation: (current?.generation ?? 0) + 1,
    });
    return commitPreparedRefinementRegistry(
      prepareRefinementAdapterRegistration(current, adapter, transactionSha256),
      transactionSha256,
    );
  });
  return adapters.find((entry) => entry.id === adapter.id);
};

/**
 * Append one committed scale selection — the being's own dial, which moves
 * `selectedScale` and never the immutable approved `scale`.
 * @param {Object} workspace
 * @param {string} neumaId
 * @param {string} adapterId
 * @param {number} scale
 * @returns {Promise<Object>} the committed projection of the selected adapter
 */
// impure
export const setFixtureAdapterScale = async (workspace, neumaId, adapterId, scale) => {
  const adapters = await commitRevision(workspace, neumaId, (current) => {
    const transactionSha256 = refinementSha256({
      fixtureSelection: { adapterId, scale },
      generation: (current?.generation ?? 0) + 1,
    });
    return commitPreparedRefinementRegistry(
      prepareRefinementAdapterSelection(current, adapterId, scale, transactionSha256),
      transactionSha256,
    );
  });
  return adapters.find((entry) => entry.id === adapterId);
};

/**
 * Read the being's committed registry projection. An absent registry is the
 * declared absence of a being that has never been refined.
 * @param {Object} workspace
 * @param {string} neumaId
 * @returns {Promise<ReadonlyArray<Object>>}
 */
// impure — real encrypted read, authenticated by the store
export const readFixtureAdapters = async (workspace, neumaId) => {
  const held = await openRefinementRegistryAuthority(workspace, neumaId, control());
  try {
    return held.state === 'present'
      ? projectRefinementRegistryAdapters(held.registry)
      : NO_ADAPTERS;
  } finally {
    await release(held.source);
  }
};
