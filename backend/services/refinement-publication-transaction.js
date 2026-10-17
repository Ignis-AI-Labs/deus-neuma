import {
  commitPreparedRefinementRegistry,
  prepareRefinementAdapterSelection,
  refinementRegistryCurrentSelectionSha256,
  validateRefinementRegistryV2,
} from '../../core/refinement/registry-contract.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { isSha256 } from '../../core/shared/plain-data-canonical.js';
import { resolveCurrentRefinementRegistryState } from './refinement-registry-authority-state.js';
import {
  assertPublishableRefinementRegistryAuthority,
  assertRefinementAdapterId,
} from './refinement-registry-authority.js';
import {
  assertRefinementScaleAuthorityToken,
  refinementScaleAuthorityTokenSha256,
} from './refinement-scale-authority.js';
import {
  assertCommittedRefinementPublication,
  commitPreparedRefinementPublicationJournal,
  prepareRefinementPublicationJournal,
  refinementPublicationJournalName,
  refinementPublicationTransactionSha256,
  validateRefinementPublicationJournal,
} from './refinement-publication-ledger.js';
import {
  PUBLICATION_FILE_BYTES_MAX,
  PUBLICATION_JOURNAL_BYTES_MAX,
  assertCurrentAdapterAuthority,
  openPublicationEncrypted,
  publicationDirectories,
  publicationFailure,
  readCurrentPublicationAuthority,
  readPublicationEncrypted,
  releasePublicationResource,
  replacePublicationEncrypted,
  sameRegistryRevision,
  withPublicationDirectory,
} from './refinement-publication-storage-internal.js';

export {
  publishCommittedRefinementAdapter,
  reconcilePreparedRefinementPublication,
} from './refinement-publication-registration.js';
export {
  verifyCurrentRefinementPublicationAuthority,
} from './refinement-publication-verifier.js';

const exactWallet = (value) => {
  if (value !== null && !isSha256(value)) {
    throw publicationFailure('INVALID_OPERATOR_AUTHORITY', 'operator wallet authority is invalid');
  }
  return value;
};
const scaleTokenFields = Object.freeze([
  'adapterId', 'adapterIdSha256', 'approvedScales', 'approvedScalesSha256',
  'artifactSha256', 'custodySha256', 'expiresAt', 'issuedAt', 'operatorWalletSha256',
  'publicationTransactionSha256', 'registryAppendRevision',
  'registryCurrentSelectionSha256', 'registryGeneration', 'registrySha256',
  'schemaVersion', 'selectedScale', 'state', 'subjectNeumaId', 'tokenSha256',
]);
const validateScaleToken = (value, expected, allowConsumed = false) => {
  const keys = Reflect.ownKeys(value || {});
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || keys.length !== scaleTokenFields.length
    || keys.some((key) => typeof key !== 'string' || !scaleTokenFields.includes(key))
    || value.schemaVersion !== 2
    || !['ISSUED', 'CONSUMED'].includes(value.state)
    || value.tokenSha256 !== expected.tokenSha256) {
    throw publicationFailure(
      'INVALID_REFINEMENT_SCALE_AUTHORITY',
      'scale authority token is invalid',
    );
  }
  if (value.state === 'CONSUMED' && !allowConsumed) {
    throw publicationFailure(
      'REFINEMENT_SCALE_AUTHORITY_REPLAYED',
      'scale authority token was already consumed',
    );
  }
  if (scaleTokenFields.filter((field) => Object.hasOwn(expected, field))
    .some((field) => refinementSha256(value[field]) !== refinementSha256(expected[field]))) {
    throw publicationFailure(
      'REFINEMENT_SCALE_AUTHORITY_STALE',
      'scale authority is stale or mismatched',
    );
  }
  if (!Array.isArray(value.approvedScales)
    || !value.approvedScales.includes(expected.scale)) {
    throw publicationFailure(
      'INVALID_ADAPTER_SCALE',
      'scale is not covered by current approval',
    );
  }
  if (value.state === 'ISSUED'
    && (!Number.isFinite(Date.parse(value.expiresAt))
      || Date.parse(value.expiresAt) <= Date.now())) {
    throw publicationFailure(
      'REFINEMENT_SCALE_AUTHORITY_EXPIRED',
      'scale authority expired',
    );
  }
  return Object.freeze(value);
};
const readScaleToken = (state, authorityToken, expected) =>
  withPublicationDirectory(
    state.operations,
    publicationDirectories.scales,
    async () => {
      const value = await readPublicationEncrypted(
        state.operations,
        `scale-${refinementScaleAuthorityTokenSha256(authorityToken)}.json`,
        PUBLICATION_JOURNAL_BYTES_MAX,
        state.operation,
        true,
      );
      if (value === null) {
        throw publicationFailure(
          'INVALID_REFINEMENT_SCALE_AUTHORITY',
          'scale authority token is unavailable',
        );
      }
      return validateScaleToken(value, expected);
    },
  );
const consumeScaleToken = (state, authorityToken, expected) =>
  withPublicationDirectory(
    state.operations,
    publicationDirectories.scales,
    async () => {
      const name = `scale-${refinementScaleAuthorityTokenSha256(authorityToken)}.json`;
      const opened = await openPublicationEncrypted(
        state.operations,
        name,
        PUBLICATION_JOURNAL_BYTES_MAX,
      );
      let primary = null;
      try {
        const issued = validateScaleToken(opened.value, expected);
        const consumed = Object.freeze({ ...issued, state: 'CONSUMED' });
        await replacePublicationEncrypted({
          operations: state.operations,
          name,
          value: consumed,
          maximumBytes: PUBLICATION_JOURNAL_BYTES_MAX,
          expectedResource: opened.resource,
          validate: (value) => {
            const exact = validateScaleToken(value, expected, true);
            if (exact.state !== 'CONSUMED') {
              throw publicationFailure(
                'REFINEMENT_PUBLICATION_CORRUPT',
                'consumed scale authority marker changed',
              );
            }
          },
        });
        await state.operations.sync();
      } catch (error) {
        primary = error;
      }
      return releasePublicationResource(state.operations, opened.resource, primary);
    },
  );
const safeSelectedAdapter = (adapter, registry) => Object.freeze({
  id: adapter.id, baseModel: adapter.baseModel, sha256: adapter.sha256,
  registeredAt: adapter.registeredAt, selectedScale: registry.selectedScale,
  isCurrent: true, registryGeneration: registry.generation,
  registryAppendRevision: registry.appendRevision, registrySha256: registry.registrySha256,
  registryCurrentSelectionSha256: registry.currentSelectionSha256,
});

export const commitRefinementScaleSelection = async ({
  registryAuthority, adapterId, scale, authorityToken, operatorWalletSha256, operation,
}) => {
  assertPublishableRefinementRegistryAuthority(registryAuthority, operation);
  const state = resolveCurrentRefinementRegistryState(registryAuthority, operation);
  const id = assertRefinementAdapterId(adapterId);
  const token = assertRefinementScaleAuthorityToken(authorityToken);
  const walletSha256 = exactWallet(operatorWalletSha256);
  if (!state.registry) throw publicationFailure('ADAPTER_NOT_FOUND', 'adapter registry is absent');
  const matches = state.adapters.filter((adapter) => adapter.id === id);
  if (matches.length !== 1) throw publicationFailure('ADAPTER_NOT_FOUND', 'adapter is unavailable');
  const adapter = matches[0];
  // Zero is withdrawal, not a refinement strength, so it is never in
  // `approvedScales` — and requiring approval to turn an adapter OFF would fail
  // OPEN: the changed-artifact guard in `refinement-training-authority.js` and
  // the being's own `refinement_dial` both drive scale to 0 precisely to disarm.
  // Both callers already encode this exemption; this is the layer that persists
  // the decision, and it must agree with them.
  if (!Number.isFinite(scale) || scale < 0 || scale > 1
    || (scale !== 0 && !adapter.binding.approvedScales.includes(scale))) {
    throw publicationFailure(
      'INVALID_ADAPTER_SCALE',
      'scale must be 0 or one exact approved scale',
    );
  }
  if (state.registry.currentSelection.adapterIdSha256 === adapter.adapterIdSha256
    && state.registry.currentSelection.artifactSha256 === adapter.sha256
    && state.registry.selectedScale === scale) {
    throw publicationFailure('INVALID_ADAPTER_SCALE', 'scale selection is already current');
  }
  const current = await readCurrentPublicationAuthority(state, adapter.provenance.ceremonyId);
  assertCurrentAdapterAuthority(adapter, current);
  const tokenExpected = Object.freeze({
    adapterId: id,
    adapterIdSha256: adapter.adapterIdSha256,
    artifactSha256: adapter.sha256,
    custodySha256: current.custodySha256,
    operatorWalletSha256: walletSha256,
    publicationTransactionSha256: adapter.publicationTransactionSha256,
    registryGeneration: state.registry.generation,
    registryAppendRevision: state.registry.appendRevision,
    registrySha256: state.registry.registrySha256,
    registryCurrentSelectionSha256: state.registry.currentSelectionSha256,
    selectedScale: adapter.selectedScale,
    subjectNeumaId: state.operations.neumaId,
    tokenSha256: refinementScaleAuthorityTokenSha256(token),
    scale,
  });
  await readScaleToken(state, token, tokenExpected);
  const result = await withPublicationDirectory(state.operations, publicationDirectories.refinement, async () => {
    const registrationName = refinementPublicationJournalName({
      action: 'REGISTER', ceremonyId: adapter.provenance.ceremonyId,
    });
    const registration = validateRefinementPublicationJournal(await readPublicationEncrypted(state.operations, registrationName, PUBLICATION_JOURNAL_BYTES_MAX, state.operation,));
    assertCommittedRefinementPublication(registration, {
      adapterIdSha256: adapter.adapterIdSha256,
      artifactSha256: adapter.sha256,
      ceremonyId: adapter.provenance.ceremonyId,
      custodySha256: current.custodySha256,
      registryAppendRevision: adapter.registrationRegistryAppendRevision,
      registryCurrentSelectionSha256: adapter.registrationRegistryCurrentSelectionSha256,
      registryGeneration: adapter.registrationRegistryGeneration,
      registrySha256: adapter.registrationRegistrySha256,
      transactionSha256: adapter.publicationTransactionSha256,
    });
    const nextSelectionSha256 = refinementRegistryCurrentSelectionSha256({
      adapterIdSha256: adapter.adapterIdSha256, artifactSha256: adapter.sha256,
    });
    const intent = Object.freeze({
      action: 'SELECT',
      adapterBindingSha256: refinementSha256(adapter.binding),
      adapterIdSha256: adapter.adapterIdSha256,
      adapterProvenanceSha256: refinementSha256(adapter.provenance),
      artifactBytes: registration.intent.artifactBytes,
      artifactSha256: adapter.sha256,
      ceremonyApprovalSha256: adapter.binding.ceremonyApprovalSha256,
      ceremonyCandidateSha256: current.recordSha256,
      ceremonyId: adapter.provenance.ceremonyId,
      ceremonyNextSha256: current.recordSha256,
      ceremonyPriorSha256: current.recordSha256,
      ceremonyRevision: current.revision,
      consentAuthoritySha256: refinementSha256(current.consentAuthority),
      consentEventSha256: adapter.binding.consentEventSha256,
      custodySha256: current.custodySha256,
      lineageConfigObjectId: adapter.binding.lineageConfigObjectId,
      lineageConfigSha256: adapter.binding.lineageConfigSha256,
      lineageConfigSourceCommit: adapter.binding.lineageConfigSourceCommit,
      lineageConfigSourceIdentitySha256: adapter.binding.lineageConfigSourceIdentitySha256,
      operatorDecisionSha256: adapter.binding.operatorDecisionSha256,
      lineageConfigSourceMode: adapter.binding.lineageConfigSourceMode,
      priorRegistryEntrySha256: state.registry.entries.at(-1).entrySha256,
      priorRegistrySha256: state.registry.registrySha256,
      registeredAt: adapter.registeredAt,
      registryAppendRevision: state.registry.appendRevision + 1,
      registryCurrentSelectionSha256: nextSelectionSha256,
      registryGeneration: state.registry.generation + 1,
      scaleAuthorityTokenSha256: refinementScaleAuthorityTokenSha256(token),
      selectedScale: scale,
      trainedAt: adapter.provenance.trainedAt,
      trainingConfigSha256: adapter.binding.trainingConfigSha256,
      trainingPlanAuthoritySha256: refinementSha256(current.trainingPlanAuthority),
      trainingPlanSha256: adapter.binding.trainingPlanSha256,
    });
    const transactionSha256 = refinementPublicationTransactionSha256(intent);
    const preparedRegistry = prepareRefinementAdapterSelection(
      state.registry, id, scale, transactionSha256,
    );
    const nextRegistry = commitPreparedRefinementRegistry(preparedRegistry, transactionSha256);
    const preparedJournal = prepareRefinementPublicationJournal({
      intent, registrySha256: nextRegistry.registrySha256,
    });
    const committedJournal = commitPreparedRefinementPublicationJournal(preparedJournal);
    const journalName = refinementPublicationJournalName({
      action: 'SELECT', transactionSha256,
    });
    let heldJournal = await openPublicationEncrypted(state.operations, journalName, PUBLICATION_JOURNAL_BYTES_MAX, true,);
    if (!heldJournal) {
      await replacePublicationEncrypted({
        operations: state.operations, name: journalName, value: preparedJournal,
        maximumBytes: PUBLICATION_JOURNAL_BYTES_MAX, expectedResource: null,
        validate: (value) => {
          const exact = validateRefinementPublicationJournal(value);
          if (exact.preparedSha256 !== preparedJournal.preparedSha256 || exact.state !== 'PREPARED') {
            throw publicationFailure('REFINEMENT_PUBLICATION_CORRUPT', 'prepared journal changed');
          }
        },
      });
      heldJournal = await openPublicationEncrypted(state.operations, journalName, PUBLICATION_JOURNAL_BYTES_MAX);
    }
    let journal = validateRefinementPublicationJournal(heldJournal.value);
    if (journal.transactionSha256 !== transactionSha256
      || journal.preparedSha256 !== preparedJournal.preparedSha256) {
      return releasePublicationResource(state.operations, heldJournal.resource,
        publicationFailure('REFINEMENT_TRANSACTION_STALE', 'selection journal is not this transaction'));
    }
    const heldRegistry = await openPublicationEncrypted(state.operations, 'adapters.json', PUBLICATION_FILE_BYTES_MAX,);
    let registry = validateRefinementRegistryV2(heldRegistry.value);
    let primary = null;
    try {
      if (journal.state === 'PREPARED' && sameRegistryRevision(registry, state.registry)) {
        await replacePublicationEncrypted({
          operations: state.operations, name: 'adapters.json', value: nextRegistry,
          maximumBytes: PUBLICATION_FILE_BYTES_MAX, expectedResource: heldRegistry.resource,
          validate: (value) => {
            const exact = validateRefinementRegistryV2(value);
            if (!sameRegistryRevision(exact, nextRegistry)) {
              throw publicationFailure('REFINEMENT_PUBLICATION_CORRUPT', 'registry commit changed');
            }
          },
        });
        registry = nextRegistry;
      }
      if (!sameRegistryRevision(registry, nextRegistry)) {
        throw publicationFailure('REFINEMENT_TRANSACTION_STALE', 'registry changed before scale publication');
      }
      if (journal.state === 'PREPARED') {
        await replacePublicationEncrypted({
          operations: state.operations, name: journalName, value: committedJournal,
          maximumBytes: PUBLICATION_JOURNAL_BYTES_MAX, expectedResource: heldJournal.resource,
          validate: (value) => {
            const exact = validateRefinementPublicationJournal(value);
            if (exact.commitSha256 !== committedJournal.commitSha256
              || exact.state !== 'COMMITTED') {
              throw publicationFailure('REFINEMENT_PUBLICATION_CORRUPT', 'commit marker changed');
            }
          },
        });
        await state.operations.sync();
        journal = committedJournal;
      }
      assertCommittedRefinementPublication(journal, {
        adapterIdSha256: adapter.adapterIdSha256, artifactSha256: adapter.sha256,
        ceremonyId: adapter.provenance.ceremonyId, custodySha256: current.custodySha256,
        registryAppendRevision: nextRegistry.appendRevision,
        registryCurrentSelectionSha256: nextRegistry.currentSelectionSha256,
        registryGeneration: nextRegistry.generation, registrySha256: nextRegistry.registrySha256,
        transactionSha256,
      });
      await consumeScaleToken(state, token, tokenExpected);
    } catch (error) { primary = error; }
    try { await state.operations.release(heldRegistry.resource); } catch (error) {
      primary = primary ? new AggregateError([primary, error], 'registry release failed') : error;
    }
    try { await state.operations.release(heldJournal.resource); } catch (error) {
      primary = primary ? new AggregateError([primary, error], 'journal release failed') : error;
    }
    if (primary) throw primary;
    return Object.freeze({ adapter, registry: nextRegistry });
  });
  await readScaleToken(state, token, tokenExpected)
    .then(
      () => {
        throw publicationFailure(
          'REFINEMENT_PUBLICATION_CORRUPT',
          'scale authority consumption was not durable',
        );
      },
      (error) => {
        if (error?.code !== 'REFINEMENT_SCALE_AUTHORITY_REPLAYED') throw error;
      },
    );
  return safeSelectedAdapter(result.adapter, result.registry);
};
