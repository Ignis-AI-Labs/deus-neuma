import { describe, expect, test } from 'vitest';
import {
  APPROVED_TRAINING_SCALE_PROFILES,
  publicTrainingPlan,
  resolveApprovedTrainingScales,
} from '../../backend/services/refinement-training-plan.js';
import {
  REFINEMENT_RESOURCE_LIMITS,
  refinementExecutionEnvelope,
} from '../../core/refinement/training-authority-contract.js';

const SHA = (character) => character.repeat(64);
const COMMIT = 'f'.repeat(40);
const executionEnvelope = refinementExecutionEnvelope({
  wrapperExecutableSha256: SHA('0'),
  controllerExecutableSha256: SHA('1'),
  resourceLimiterExecutableSha256: SHA('2'),
  sandboxExecutableSha256: SHA('3'),
  authorityConsumerPythonSha256: SHA('4'),
  authorityConsumerScriptSha256: SHA('5'),
  hostRuntimeIdentitySha256: SHA('6'),
  runtimeAuthoritySha256: SHA('7'),
  runtimeManifestSha256: SHA('8'),
  toolAuthoritySha256: SHA('9'),
  toolManifestSha256: SHA('a'),
  resources: REFINEMENT_RESOURCE_LIMITS,
  trainingSeed: 1,
});
const approvalContext = {
  adapterIdSha256: SHA('0'),
  approvedScalesSha256: SHA('1'),
  operationConfigSha256: SHA('2'),
  executionEnvelopeSha256: executionEnvelope.sha256,
  servingLineageSha256: SHA('4'),
  servingArtifactSha256: SHA('5'),
  baseModelIdentitySha256: SHA('6'),
  lineageConfigSha256: SHA('7'),
  lineageConfigSourceIdentitySha256: SHA('7'),
  lineageConfigSourceCommit: COMMIT,
  lineageConfigSourceMode: '100644',
  lineageConfigObjectId: 'e'.repeat(40),
  targetTrainingBaseAuthoritySha256: SHA('7'),
  snapshotManifestSha256: SHA('8'),
  sourceCommitSha256: SHA('8'),
  trainerExecutableSha256: SHA('9'),
  converterScriptSha256: SHA('a'),
  pythonExecutableSha256: SHA('b'),
  trainerEnvironmentSha256: SHA('c'),
  trainerRequirementsSha256: SHA('d'),
  completionTokenProfileSha256: SHA('d'),
  ceremonyApprovalSha256: SHA('e'),
  curriculumSha256: SHA('f'),
  sourceCorpusSha256: SHA('0'),
  sourceManifestSha256: SHA('1'),
  sourceAuthoritySha256: SHA('1'),
  trainingConfigSha256: SHA('2'),
  geometrySha256: SHA('4'),
  trainingBudgetSha256: SHA('6'),
  minimumCompletionTokens: 64,
};

const projection = () => publicTrainingPlan({
  approval: {
    trainingPlanSha256: SHA('f'),
    approvalContext,
    bindingContext: {
      participatoryAssentSha256: SHA('a'),
      assentEvidenceSha256: SHA('b'),
      consentEventSha256: SHA('c'),
      approvedScales: Object.freeze([0.5, 1]),
      sourceCommit: COMMIT,
    },
  },
  adapterId: 'prooflet-refinement-1',
  approvedScales: [0.5, 1],
  config: {
    base: 'prooflet/trainer',
    baseRevision: COMMIT,
    template: 'chat',
    load4bit: true,
    baseArtifactSha256: SHA('1'),
    tokenizerSha256: SHA('2'),
    completionTokenProfileSha256: SHA('d'),
    geometry: Object.freeze({
      rank: 8, alpha: 16, dropout: 0, maxLength: 2048,
      targetPolicyId: 'exact-module-list-v1',
      targetModules: Object.freeze(['q_proj']),
      targetModulesSha256: SHA('3'), sha256: SHA('4'),
    }),
    budget: Object.freeze({
      epochs: 3, learningRate: 0.0001, sampleCount: 1, matchedTokenBudget: 120,
      minimumCompletionTokens: 64, optimizer: 'adamw-v1',
      optimizerConfigSha256: SHA('5'), seed: 1, sha256: SHA('6'),
    }),
    executionEnvelope,
    privatePath: '/never/projected',
  },
  corpus: {
    samples: Object.freeze([{ privatePrompt: 'never projected' }]),
    system: 'private system prompt',
  },
  targetTrainingBase: {
    targetServingModel: 'prooflet-serving',
    privatePath: '/never/projected',
  },
});

describe('safe public training-plan projection', () => {
  test('projects every reviewable approval input and no private payload or path', () => {
    const plan = projection();
    expect(plan.approvedScales).toEqual([0.5, 1]);
    expect(plan.curriculum).toEqual({ id: 'ordinary', sha256: approvalContext.curriculumSha256 });
    expect(plan.training).toMatchObject({
      base: 'prooflet/trainer',
      template: 'chat',
      load4bit: true,
      configurationSha256: approvalContext.trainingConfigSha256,
    });
    expect(plan.training.geometry.targetModules).toEqual(['q_proj']);
    expect(plan.participatoryAssentSha256).toBe(SHA('a'));
    expect(plan.assentEvidenceSha256).toBe(SHA('b'));
    expect(plan.consentEventSha256).toBe(SHA('c'));
    expect(plan.lineageConfigSha256).toBe(approvalContext.lineageConfigSha256);
    expect(plan.lineageConfigSourceCommit).toBe(COMMIT);
    expect(plan.lineageConfigSourceMode).toBe('100644');
    expect(plan.lineageConfigObjectId).toBe(approvalContext.lineageConfigObjectId);
    expect(plan.lineageConfigSourceIdentitySha256)
      .toBe(approvalContext.lineageConfigSourceIdentitySha256);
    expect(plan.targetTrainingBaseAuthoritySha256)
      .toBe(approvalContext.targetTrainingBaseAuthoritySha256);
    expect(plan.snapshotManifestSha256).toBe(approvalContext.snapshotManifestSha256);
    expect(plan.corpus.sourceAuthoritySha256).toBe(approvalContext.sourceAuthoritySha256);
    expect(plan.sourceCommit).toBe(COMMIT);
    expect(plan.geometrySha256).toBe(approvalContext.geometrySha256);
    expect(plan.trainingBudgetSha256).toBe(approvalContext.trainingBudgetSha256);
    expect(plan.minimumCompletionTokens).toBe(64);
    expect(plan.executionEnvelope).not.toHaveProperty('environment');
    expect(plan.executionEnvelope).not.toHaveProperty('sha256');
    expect(plan.executionEnvelope.resources).toMatchObject({
      version: 2,
      ioDevicePolicy: 'root-filesystem',
      maxInheritedFileDescriptors: REFINEMENT_RESOURCE_LIMITS.maxInheritedFileDescriptors,
      maxSnapshotFiles: REFINEMENT_RESOURCE_LIMITS.maxSnapshotFiles,
      trainingSnapshotMaxBytes: REFINEMENT_RESOURCE_LIMITS.trainingSnapshotMaxBytes,
    });
    expect(plan.executionEnvelope.sandbox).toMatchObject({
      hostRuntime: 'fixed-minimal-read-only-allowlist-v1',
      runtimeAuthoritySha256: SHA('7'),
      runtimeManifestSha256: SHA('8'),
      toolAuthoritySha256: SHA('9'),
      toolManifestSha256: SHA('a'),
      gpuLeaseRequired: true,
    });
    expect(JSON.stringify(plan)).not.toMatch(/never\/projected|privatePrompt|system prompt/i);
  });

  test('admits only the standard and predeclared scale-study ranges', () => {
    expect(resolveApprovedTrainingScales()).toEqual([1]);
    expect(resolveApprovedTrainingScales(APPROVED_TRAINING_SCALE_PROFILES.scaleStudy))
      .toEqual([0.5, 1]);
    for (const values of [[], [0], [0.25, 1], [0, 1], [1, 0.5], [0.5, 1, 1]]) {
      expect(() => resolveApprovedTrainingScales(values))
        .toThrow('approvedScales must be exactly [1] or [0.5, 1]');
    }
  });
});
