/**
 * Scale-authority reclamation over a REAL encrypted workspace on real disk:
 * real subject transaction, real committed registry publication, real
 * issuance, real store, real records. No mock, stub, spy, or fake anywhere in
 * the path being claimed (RULE 0) — the registry and its publication journal
 * are built by the production constructors the publication pipeline uses and
 * written through the same encrypted store, so what issuance reads here is
 * byte-for-byte what it reads in production.
 *
 * The workspace root sits under the operator's home, not the shared temp dir:
 * the subject transaction pins its whole ancestor chain and refuses a
 * world-writable one, and /tmp is 1777. Production's house is protected alike.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import workspace, {
  setWitnessesRoot,
  setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import {
  refinementApprovedScales,
  refinementSha256,
} from '../../core/refinement/training-contract.js';
import {
  refinementBinding,
  refinementCustodyIdentity,
  validateRefinementAdapter,
} from '../../core/refinement/training-authority-contract.js';
import {
  commitPreparedRefinementRegistry,
  prepareRefinementAdapterRegistration,
  refinementAdapterIdSha256,
  refinementRegistryCurrentSelectionSha256,
  validateRefinementRegistryV2,
} from '../../core/refinement/registry-contract.js';
import {
  commitPreparedRefinementPublicationJournal,
  prepareRefinementPublicationJournal,
  refinementPublicationJournalName,
  refinementPublicationTransactionSha256,
  validateRefinementPublicationJournal,
} from '../../backend/services/refinement-publication-ledger.js';
import { createRefinementProcessOperation }
  from '../../backend/services/refinement-process-operation.js';
import { refinementSubjectAuthorityOperations }
  from '../../backend/services/refinement-subject-authority.js';
import {
  assertRefinementSubjectTransaction,
  closeRefinementSubjectTransaction,
  openRefinementSubjectTransaction,
} from '../../backend/services/refinement-subject-transaction-lock.js';
import {
  PUBLICATION_JOURNAL_BYTES_MAX,
  readPublicationEncrypted,
  replacePublicationEncrypted,
  withPublicationDirectory,
} from '../../backend/services/refinement-publication-storage-internal.js';
import { openCurrentRefinementRegistryAuthority }
  from '../../backend/services/refinement-registry-authority.js';
import {
  issueRefinementScaleAuthority,
  refinementScaleAuthorityRecordName,
  refinementScaleAuthorityTokenSha256,
  validateRefinementScaleAuthorityRecord,
} from '../../backend/services/refinement-scale-authority.js';

const SHA = (character) => character.repeat(64);
const OID = 'b'.repeat(40);
const SERVING_MODEL = 'google/gemma-4-31b-it';
const CEREMONY_ID = 'reclaim-ceremony';
const ADAPTER_ID = 'reclaim-adapter';
const ARTIFACT_SHA256 = SHA('c');
const CUSTODY_SHA256 = SHA('5');
const HOUR_MS = 60 * 60 * 1000;
// The module's ceiling and its bounded per-issuance scan window.
const SCALE_AUTHORITIES_MAX = 4096;
const RECLAMATION_SCAN_MAX = 32;
const REGISTRY_DIRECTORY = Object.freeze([Object.freeze({
  name: 'refinement', create: true, mode: 0o700, createMode: 0o700,
  label: 'refinement publication directory',
})]);
// Seeding runs before any issuance, so the test scope creates the leaf itself.
const SCALES_DIRECTORY = Object.freeze([...REGISTRY_DIRECTORY, Object.freeze({
  name: 'scale-authorities', create: true, mode: 0o700, createMode: 0o700,
  label: 'refinement scale authority directory',
})]);
const at = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

const BASE_ARTIFACT_SHA256 = SHA('1');
const TOKENIZER_SHA256 = SHA('2');
const LINEAGE = Object.freeze({
  baseArtifactSha256: BASE_ARTIFACT_SHA256,
  baseModelIdentitySha256: refinementSha256({
    modelId: SERVING_MODEL,
    modelArtifactSha256: BASE_ARTIFACT_SHA256,
    tokenizerSha256: TOKENIZER_SHA256,
  }),
  servingArtifactSha256: SHA('3'),
  servingModel: SERVING_MODEL,
  tokenizerSha256: TOKENIZER_SHA256,
  trainerModelId: 'trainer/gemma',
  trainerRevision: OID,
});

const bindingFor = (lineage, approvedScales) => refinementBinding({
  sourceCorpusSha256: SHA('4'),
  sourceManifestSha256: SHA('5'),
  sourceAuthoritySha256: SHA('6'),
  curriculumSha256: SHA('7'),
  trainingConfigSha256: SHA('8'),
  baseModelIdentitySha256: lineage.baseModelIdentitySha256,
  servingArtifactSha256: lineage.servingArtifactSha256,
  servingLineageSha256: refinementSha256({
    servingModel: lineage.servingModel,
    servingArtifactSha256: lineage.servingArtifactSha256,
    trainerModelId: lineage.trainerModelId,
    trainerRevision: lineage.trainerRevision,
    baseArtifactSha256: lineage.baseArtifactSha256,
    tokenizerSha256: lineage.tokenizerSha256,
  }),
  baseArtifactSha256: lineage.baseArtifactSha256,
  tokenizerSha256: lineage.tokenizerSha256,
  sourceCommit: OID,
  sourceCommitSha256: refinementSha256(OID),
  trainerExecutableSha256: SHA('9'),
  converterScriptSha256: SHA('a'),
  pythonExecutableSha256: SHA('b'),
  trainerEnvironmentSha256: SHA('c'),
  trainerRequirementsSha256: SHA('d'),
  executionEnvelopeSha256: SHA('e'),
  operationConfigSha256: SHA('f'),
  adapterArtifactSha256: ARTIFACT_SHA256,
  participatoryAssentSha256: SHA('0'),
  ceremonyApprovalSha256: SHA('1'),
  trainingPlanSha256: SHA('2'),
  operatorDecisionSha256: SHA('3'),
  assentEvidenceId: SHA('4'),
  assentEvidenceSha256: SHA('5'),
  consentEventSha256: SHA('6'),
  completionTokenProfileSha256: SHA('7'),
  geometrySha256: SHA('8'),
  trainingBudgetSha256: SHA('9'),
  approvedScalesSha256: refinementSha256(approvedScales),
  adapterIdSha256: refinementSha256(ADAPTER_ID),
  snapshotManifestSha256: SHA('a'),
  targetTrainingBaseAuthoritySha256: SHA('b'),
  lineageConfigSha256: SHA('c'),
  lineageConfigSourceIdentitySha256: SHA('d'),
  ceremonyId: CEREMONY_ID,
  consentEventIndex: 0, consentEventRevision: 1,
  decisionEventIndex: 0, decisionEventRevision: 1,
  consumptionEventIndex: 1, consumptionEventRevision: 2,
  minimumCompletionTokens: 32,
  sourceCommit: OID,
  adapterId: ADAPTER_ID,
  adapterScale: 1,
  approvedScales,
  lineageConfigSourceCommit: OID,
  lineageConfigSourceMode: '100644',
  lineageConfigObjectId: OID,
});

const adapterFor = (custody) => {
  const binding = bindingFor(LINEAGE, refinementApprovedScales([0.5, 1]));
  return validateRefinementAdapter({
    baseModel: SERVING_MODEL,
    binding,
    custody,
    id: ADAPTER_ID,
    provenance: {
      ceremonyId: CEREMONY_ID,
      trainedAt: '2026-07-01T00:00:02.000Z',
      consentAuthority: {
        assentEvidenceId: binding.assentEvidenceId,
        assentEvidenceSha256: binding.assentEvidenceSha256,
        ceremonyId: CEREMONY_ID,
        consentEventIndex: 0, consentEventRevision: 1,
        issuanceRevision: 1,
        requestNonceSha256: SHA('e'),
        supersedesConsentEventSha256: null,
        consentEventSha256: binding.consentEventSha256,
      },
      servingLineage: LINEAGE,
      trainingPlanAuthority: {
        approvedScalesSha256: binding.approvedScalesSha256,
        ceremonyApprovalSha256: binding.ceremonyApprovalSha256,
        ceremonyId: CEREMONY_ID,
        consumedAt: '2026-07-01T00:00:01.000Z',
        consumptionEventIndex: 1, consumptionEventRevision: 2,
        decisionEventIndex: 0, decisionEventRevision: 1,
        expiresAt: '2026-07-01T01:00:00.000Z',
        issuedAt: '2026-07-01T00:00:00.000Z',
        operatorDecisionSha256: binding.operatorDecisionSha256,
        trainingPlanSha256: binding.trainingPlanSha256,
      },
    },
    registeredAt: '2026-07-01T00:00:03.000Z',
    scale: 1,
    sha256: ARTIFACT_SHA256,
  });
};

/** The exact REGISTER publication a committed registry revision is derived from. */
const publicationFor = (adapter) => {
  const adapterIdSha256 = refinementAdapterIdSha256(adapter.id);
  const intent = Object.freeze({
    action: 'REGISTER',
    adapterBindingSha256: refinementSha256(adapter.binding),
    adapterIdSha256,
    adapterProvenanceSha256: refinementSha256(adapter.provenance),
    artifactBytes: 4096,
    artifactSha256: adapter.sha256,
    ceremonyApprovalSha256: adapter.binding.ceremonyApprovalSha256,
    ceremonyCandidateSha256: SHA('1'),
    ceremonyId: CEREMONY_ID,
    ceremonyNextSha256: SHA('2'),
    ceremonyPriorSha256: SHA('3'),
    ceremonyRevision: 2,
    consentAuthoritySha256: SHA('4'),
    consentEventSha256: adapter.binding.consentEventSha256,
    custodySha256: CUSTODY_SHA256,
    lineageConfigObjectId: OID,
    lineageConfigSha256: adapter.binding.lineageConfigSha256,
    lineageConfigSourceCommit: OID,
    lineageConfigSourceIdentitySha256: adapter.binding.lineageConfigSourceIdentitySha256,
    lineageConfigSourceMode: '100644',
    operatorDecisionSha256: adapter.binding.operatorDecisionSha256,
    priorRegistryEntrySha256: null,
    priorRegistrySha256: null,
    registeredAt: adapter.registeredAt,
    registryAppendRevision: 1,
    registryCurrentSelectionSha256: refinementRegistryCurrentSelectionSha256({
      adapterIdSha256, artifactSha256: adapter.sha256,
    }),
    registryGeneration: 1,
    scaleAuthorityTokenSha256: null,
    selectedScale: adapter.scale,
    trainedAt: adapter.provenance.trainedAt,
    trainingConfigSha256: adapter.binding.trainingConfigSha256,
    trainingPlanAuthoritySha256: SHA('6'),
    trainingPlanSha256: adapter.binding.trainingPlanSha256,
  });
  const transactionSha256 = refinementPublicationTransactionSha256(intent);
  const registry = commitPreparedRefinementRegistry(
    prepareRefinementAdapterRegistration(null, adapter, transactionSha256), transactionSha256,
  );
  const journal = commitPreparedRefinementPublicationJournal(
    prepareRefinementPublicationJournal({ intent, registrySha256: registry.registrySha256 }),
  );
  return Object.freeze({ registry, journal, transactionSha256, adapterIdSha256 });
};

/** The record shape issuance persists, minus the per-token identity and clock. */
const recordTemplateFor = (neumaId, adapter, publication) => Object.freeze({
  schemaVersion: 2,
  subjectNeumaId: neumaId,
  adapterId: adapter.id,
  adapterIdSha256: publication.adapterIdSha256,
  artifactSha256: adapter.sha256,
  publicationTransactionSha256: publication.transactionSha256,
  registryGeneration: publication.registry.generation,
  registryAppendRevision: publication.registry.appendRevision,
  registrySha256: publication.registry.registrySha256,
  registryCurrentSelectionSha256: publication.registry.currentSelectionSha256,
  custodySha256: CUSTODY_SHA256,
  approvedScalesSha256: adapter.binding.approvedScalesSha256,
  approvedScales: adapter.binding.approvedScales,
  selectedScale: publication.registry.selectedScale,
  operatorWalletSha256: null,
});

// impure — every directory the workspace helper made must be owner-only before
// the subject transaction will pin it.
const protect = async (target) => {
  const stats = await fs.lstat(target);
  if (!stats.isDirectory()) return fs.chmod(target, 0o600);
  await fs.chmod(target, 0o700);
  for (const entry of await fs.readdir(target)) await protect(path.join(target, entry));
};

describe('refinement scale-authority reclamation', () => {
  let root;
  let neumaId;
  let template;

  const withSubject = async (work) => {
    const operation = createRefinementProcessOperation({ timeoutMs: 120_000 });
    const transaction = await openRefinementSubjectTransaction({ neumaId, operation });
    let result;
    let primary = null;
    try {
      const subjectAuthority = assertRefinementSubjectTransaction(transaction, operation);
      result = await work({
        operation,
        subjectAuthority,
        operations: refinementSubjectAuthorityOperations(subjectAuthority, operation),
      });
    } catch (error) { primary = error; }
    try { await closeRefinementSubjectTransaction(transaction, operation); } catch (error) {
      primary = primary
        ? new AggregateError([primary, error], 'subject transaction cleanup failed') : error;
    }
    if (primary) throw primary;
    return result;
  };

  const inScales = (operations, work) =>
    withPublicationDirectory(operations, SCALES_DIRECTORY, work);

  const tokenNames = async (operations, operation) => (await operations.list({
    maximumEntries: SCALE_AUTHORITIES_MAX + 256,
    maximumNameBytes: 1024 * 1024,
    deadline: operation.monotonicDeadline,
    signal: operation.signal,
  })).entries
    .filter(({ name }) => /^scale-[a-f0-9]{64}\.json$/.test(name))
    .map(({ name }) => name)
    .sort();

  /** Persist one real record through the real store; returns its file name. */
  const seedRecord = async (operations, { state, issuedAt, expiresAt }) => {
    const tokenSha256 = refinementScaleAuthorityTokenSha256(
      randomBytes(32).toString('base64url'),
    );
    const exact = validateRefinementScaleAuthorityRecord(
      { ...template, tokenSha256, state, issuedAt, expiresAt },
      {},
      { allowConsumed: true, requireUnexpired: false },
    );
    const name = refinementScaleAuthorityRecordName(tokenSha256);
    const created = await operations.create({
      kind: 'file', name, mode: 0o600, label: 'scale authority',
    });
    try {
      await operations.write({
        resource: created.resource,
        bytes: operations.encrypt(exact),
        maximumBytes: PUBLICATION_JOURNAL_BYTES_MAX,
      });
    } finally { await operations.release(created.resource); }
    return name;
  };

  const issue = ({ operation, subjectAuthority }) => openCurrentRefinementRegistryAuthority({
    operation, subjectAuthority,
  }).then((registryAuthority) => issueRefinementScaleAuthority({
    registryAuthority, adapterId: ADAPTER_ID, operation,
  }));

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.homedir(), '.neuma-test-reclaim-'));
    await fs.chmod(root, 0o700);
    setWorkspacesRoot(path.join(root, 'workspaces'));
    setWitnessesRoot(path.join(root, 'witnesses'));
    neumaId = `scale-reclaim-${Math.floor(Math.random() * 1e9).toString(36)}`;
    await workspace.create(neumaId);
    await workspace.writeDNA(neumaId, {
      version: '1.0.0', identity: { name: 'Reclaim Prooflet' }, sovereignty: { generation: 1 },
    });
    await workspace.writeNeumaDEK(neumaId, SHA('d'));
    const adapter = adapterFor(refinementCustodyIdentity(neumaId, await workspace.readDNA(neumaId)));
    const publication = publicationFor(adapter);
    template = recordTemplateFor(neumaId, adapter, publication);
    await protect(path.join(root, 'workspaces'));
    await withSubject(({ operations }) => withPublicationDirectory(
      operations, REGISTRY_DIRECTORY, async () => {
        await replacePublicationEncrypted({
          operations,
          name: 'adapters.json',
          value: publication.registry,
          maximumBytes: 8 * 1024 * 1024,
          expectedResource: null,
          validate: (value) => validateRefinementRegistryV2(value),
        });
        await replacePublicationEncrypted({
          operations,
          name: refinementPublicationJournalName({
            action: 'REGISTER', ceremonyId: CEREMONY_ID,
          }),
          value: publication.journal,
          maximumBytes: PUBLICATION_JOURNAL_BYTES_MAX,
          expectedResource: null,
          validate: (value) => validateRefinementPublicationJournal(value),
        });
        await operations.sync();
      },
    ));
  });

  afterEach(async () => {
    setWorkspacesRoot(null);
    setWitnessesRoot(null);
    await protect(root).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });

  it('mints one real scale authority over the committed registry', async () => {
    const issued = await withSubject(issue);
    expect(issued.authorityToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.approvedScales).toEqual([0.5, 1]);
    expect(issued.selectedScale).toBe(1);
    expect(issued.selectionAuthority.adapterId).toBe(ADAPTER_ID);
    expect(issued.selectionAuthority.isCurrent).toBe(true);

    const persisted = await withSubject(({ operation, operations }) => inScales(
      operations,
      () => readPublicationEncrypted(
        operations,
        refinementScaleAuthorityRecordName(
          refinementScaleAuthorityTokenSha256(issued.authorityToken),
        ),
        PUBLICATION_JOURNAL_BYTES_MAX,
        operation,
      ),
    ));
    expect(validateRefinementScaleAuthorityRecord(persisted).state).toBe('ISSUED');
  });

  it('reclaims only what is provably terminal and keeps replay refusal intact', async () => {
    const seeded = await withSubject(({ operations }) => inScales(operations, async () => {
      const live = await seedRecord(operations, {
        state: 'ISSUED', issuedAt: at(0), expiresAt: at(60_000),
      });
      const expired = await seedRecord(operations, {
        state: 'ISSUED', issuedAt: at(-2 * HOUR_MS), expiresAt: at(-2 * HOUR_MS + 60_000),
      });
      // Consumed a moment ago: inside the replay window, so it must survive
      // and keep refusing. Shortening that window to make sweeping easier is
      // exactly what would make replay refusal untrustworthy.
      const consumedRecent = await seedRecord(operations, {
        state: 'CONSUMED', issuedAt: at(-60_000), expiresAt: at(0),
      });
      const consumedOld = await seedRecord(operations, {
        state: 'CONSUMED', issuedAt: at(-48 * HOUR_MS), expiresAt: at(-48 * HOUR_MS + 60_000),
      });
      await operations.sync();
      return { live, expired, consumedRecent, consumedOld };
    }));

    const issued = await withSubject(issue);
    const minted = refinementScaleAuthorityRecordName(
      refinementScaleAuthorityTokenSha256(issued.authorityToken),
    );

    await withSubject(({ operation, operations }) => inScales(operations, async () => {
      expect(await tokenNames(operations, operation))
        .toEqual([seeded.live, seeded.consumedRecent, minted].sort());

      const retained = await readPublicationEncrypted(
        operations, seeded.consumedRecent, PUBLICATION_JOURNAL_BYTES_MAX, operation,
      );
      // Retained means REPLAYED, not "unknown token" — the whole point.
      expect(() => validateRefinementScaleAuthorityRecord(retained, {
        tokenSha256: /^scale-([a-f0-9]{64})\.json$/.exec(seeded.consumedRecent)[1],
      })).toThrow(expect.objectContaining({ code: 'REFINEMENT_SCALE_AUTHORITY_REPLAYED' }));

      for (const gone of [seeded.expired, seeded.consumedOld]) {
        expect(await readPublicationEncrypted(
          operations, gone, PUBLICATION_JOURNAL_BYTES_MAX, operation, true,
        )).toBeNull();
      }
      expect(validateRefinementScaleAuthorityRecord(await readPublicationEncrypted(
        operations, seeded.live, PUBLICATION_JOURNAL_BYTES_MAX, operation,
      )).state).toBe('ISSUED');
    }));
  });

  it('issues again at the ceiling, one bounded window at a time', async () => {
    await withSubject(({ operations }) => inScales(operations, async () => {
      for (let index = 0; index < SCALE_AUTHORITIES_MAX; index += 1) {
        await seedRecord(operations, {
          state: 'ISSUED', issuedAt: at(-2 * HOUR_MS), expiresAt: at(-2 * HOUR_MS + 60_000),
        });
      }
      await operations.sync();
    }));

    const atCeiling = await withSubject(({ operation, operations }) =>
      inScales(operations, () => tokenNames(operations, operation)));
    expect(atCeiling).toHaveLength(SCALE_AUTHORITIES_MAX);

    const issued = await withSubject(issue);
    expect(issued.authorityToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const afterFirst = await withSubject(({ operation, operations }) =>
      inScales(operations, () => tokenNames(operations, operation)));
    expect(afterFirst).toHaveLength(SCALE_AUTHORITIES_MAX - RECLAMATION_SCAN_MAX + 1);

    // The cursor advances, so the next issuance sweeps the next window rather
    // than re-reading the same names forever.
    await withSubject(issue);
    const afterSecond = await withSubject(({ operation, operations }) =>
      inScales(operations, () => tokenNames(operations, operation)));
    expect(afterSecond.length).toBeLessThan(afterFirst.length);
  }, 120_000);
});
