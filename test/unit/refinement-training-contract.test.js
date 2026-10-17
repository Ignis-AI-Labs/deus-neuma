import { describe, expect, it } from 'vitest';
import {
  refinementBudget,
  refinementGeometry,
  refinementSha256,
} from '../../core/refinement/training-contract.js';
import {
  refinementBinding,
  refinementTrainingPlanSha256,
  trainingOperationConfig,
} from '../../core/refinement/training-authority-contract.js';
import {
  consumeTrainingPlanDecision,
  recordConsent,
  recordCorpus,
  recordTrainingPlanDecision,
} from '../../core/refinement/ceremony.js';
import { createRefinementProcessOperation } from '../../backend/services/refinement-process-operation.js';
import {
  adapterBindingContext,
  bindTrainingConfigAuthorityEnvelope,
  completeAdapterBinding,
  resolveInspectedTrainingConfig,
  resolveTrainingConfig,
  trainingApprovalPlan,
} from '../../backend/services/refinement-trainer-contract.js';
import {
  FIXTURE_SERVING_LINEAGE,
  FIXTURE_SERVING_LINEAGE_SHA256,
  FIXTURE_SOURCE,
  fixtureAssent,
  fixtureBinding,
  fixtureCorpusInput,
  fixtureCustody,
  fixtureExecutionEnvelope,
  fixtureOpenCeremony,
} from '../helpers/refinement-authority-fixture.js';

const SHA = (digit) => digit.repeat(64);
const COMMIT = 'a'.repeat(40);
const SERVING_MODEL = FIXTURE_SERVING_LINEAGE.servingModel;
const ADAPTER_ID = 'prooflet-refinement-2';
const TARGET_MODULES = Object.freeze(['model.layers.0.self_attn.q_proj']);
const at = (seconds) =>
  new Date(Date.parse('2026-08-13T10:00:00.000Z') + seconds * 1000).toISOString();
const sourceFields = {
  sourceCommit: COMMIT,
  sourceCommitSha256: refinementSha256(COMMIT),
  trainerExecutableSha256: SHA('a'),
  converterScriptSha256: SHA('b'),
  pythonExecutableSha256: SHA('c'),
  trainerEnvironmentSha256: SHA('d'),
  trainerRequirementsSha256: SHA('e'),
};

// One server-owned operation configuration, resolved and envelope-bound exactly
// as the forge does it, then carrying the sandbox-inspected facts that give a
// training configuration its public digest.
const inspectedConfig = () => {
  const operation = createRefinementProcessOperation({ timeoutMs: 30_000 });
  const operationConfig = trainingOperationConfig({
    env: {
      NEUMA_REFINEMENT_BASE_REVISION: COMMIT,
      NEUMA_REFINEMENT_BASE_ARTIFACT_SHA256: FIXTURE_SERVING_LINEAGE.baseArtifactSha256,
      NEUMA_REFINEMENT_TOKENIZER_SHA256: FIXTURE_SERVING_LINEAGE.tokenizerSha256,
    },
    provider: 'llama-server',
    launchConfig: {
      bin: '/usr/bin/llama-server',
      model: '/models/base.gguf',
      mmproj: '',
      servingModel: SERVING_MODEL,
      contextLength: 4096,
      host: '127.0.0.1',
      port: 8000,
    },
  });
  const resolved = resolveTrainingConfig({
    overrides: { matchedTokenBudget: 10 },
    operationConfig,
    operation,
    sampleCount: 1,
    tokenCount: 10,
  });
  const bound = bindTrainingConfigAuthorityEnvelope(
    resolved, fixtureExecutionEnvelope(), operation,
  );
  return resolveInspectedTrainingConfig(bound, {
    targetModules: [...TARGET_MODULES],
    tokenBudget: 10,
    completionTokenProfileSha256: SHA('7'),
    snapshotManifestSha256: SHA('8'),
  });
};

// A real ceremony walked to 'training' through the real grammar. The bridge
// provenance is the same literal `startBridge` stamps — the approval plan binds
// the target base to it.
const trainingCeremony = () => {
  const custody = fixtureCustody('prooflet');
  let record = fixtureOpenCeremony({ custody, openedAt: at(0) });
  record = recordConsent(record, fixtureAssent({ custody, at: at(1) }));
  record = recordCorpus(record, fixtureCorpusInput({
    sampleCount: 1, distinctDays: 1, builtAt: at(2), at: at(2),
  }));
  return Object.freeze({
    ...record,
    bridge: Object.freeze({
      ...FIXTURE_SERVING_LINEAGE,
      baseModel: FIXTURE_SERVING_LINEAGE.servingModel,
    }),
  });
};

const planValues = (config, ceremony) => ({
  ceremony,
  corpus: { ...FIXTURE_SOURCE },
  config,
  targetServingModel: SERVING_MODEL,
  targetServingArtifactSha256: FIXTURE_SERVING_LINEAGE.servingArtifactSha256,
  baseModelIdentitySha256: FIXTURE_SERVING_LINEAGE.baseModelIdentitySha256,
  servingLineageSha256: FIXTURE_SERVING_LINEAGE_SHA256,
  snapshotManifestSha256: SHA('8'),
  targetTrainingBaseAuthoritySha256: SHA('9'),
  lineageConfigSha256: SHA('1'),
  lineageConfigSourceIdentitySha256: SHA('2'),
  lineageConfigSourceCommit: COMMIT,
  lineageConfigSourceMode: '100644',
  lineageConfigObjectId: 'f'.repeat(40),
  approvedScales: [1],
  adapterId: ADAPTER_ID,
  ...sourceFields,
});

/** Issue and consume one operator decision over an exact plan. */
const decided = (ceremony, trainingPlanSha256, approvedScales = [1]) => {
  const issued = recordTrainingPlanDecision(ceremony, {
    nonceSha256: SHA('3'),
    operatorWalletSha256: SHA('4'),
    trainingPlanSha256,
    approvedScales,
    approvedScalesSha256: refinementSha256(approvedScales),
    issuedAt: at(3),
    expiresAt: at(120),
  });
  return {
    operatorDecisionSha256: issued.decision.operatorDecisionSha256,
    ceremony: consumeTrainingPlanDecision(issued.record, {
      operatorDecisionSha256: issued.decision.operatorDecisionSha256,
      consumedAt: at(4),
    }),
  };
};

describe('refinement training contract', () => {
  it('freezes stable default geometry and changes identity with geometry', () => {
    const first = refinementGeometry();
    const second = refinementGeometry({ targetModules: [] });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      rank: 8,
      alpha: 16,
      dropout: 0,
      maxLength: 2048,
      targetPolicyId: 'text-attention-projections-v1',
    });
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(first)).toBe(true);
    expect(refinementGeometry({ rank: 16 }).sha256).not.toBe(first.sha256);
  });

  it('canonicalizes exact targets and rejects unsafe geometry', () => {
    const geometry = refinementGeometry({
      targetPolicyId: 'exact-module-list-v1',
      targetModules: ['z.q_proj', 'a.v_proj'],
    });
    expect(geometry.targetModules).toEqual(['a.v_proj', 'z.q_proj']);
    expect(() => refinementGeometry({ rank: 0 })).toThrow(/rank/);
    expect(() => refinementGeometry({ dropout: 1 })).toThrow(/dropout/);
    expect(() => refinementGeometry({ targetModules: ['x', 'x'] })).toThrow(/unique/);
  });

  it('admits A1 ranks and rejects geometry above operational ceilings', () => {
    for (const rank of [8, 16, 32, 64]) {
      expect(refinementGeometry({ rank }).rank).toBe(rank);
    }
    const targetModules = Array.from({ length: 1024 }, (_, index) => `layer.${index}.q_proj`);
    expect(refinementGeometry({
      rank: 64,
      alpha: 512,
      maxLength: 8192,
      targetPolicyId: 'exact-module-list-v1',
      targetModules,
    })).toMatchObject({ rank: 64, alpha: 512, maxLength: 8192 });
    expect(() => refinementGeometry({ rank: 65 })).toThrow(/rank/);
    expect(() => refinementGeometry({ alpha: 513 })).toThrow(/alpha/);
    expect(() => refinementGeometry({ maxLength: 8193 })).toThrow(/maxLength/);
    expect(() => refinementGeometry({
      targetModules: Array.from({ length: 1025 }, (_, index) => `layer.${index}.q_proj`),
    })).toThrow(/at most 1024/);
  });

  it('binds every budget field into one deterministic digest', () => {
    const values = {
      epochs: 2,
      learningRate: 0.0001,
      sampleCount: 100,
      matchedTokenBudget: 409600,
      optimizer: 'adamw-v1',
      seed: 7,
    };
    const budget = refinementBudget(values);
    expect(budget.sha256).toBe(refinementBudget({ ...values }).sha256);
    expect(refinementBudget({ ...values, seed: 8 }).sha256).not.toBe(budget.sha256);
    expect(() => refinementBudget({ ...values, matchedTokenBudget: 0 })).toThrow(/matchedTokenBudget/);
  });

  it('accepts exact budget ceilings and rejects one unit beyond each', () => {
    const ceiling = {
      epochs: 24,
      sampleCount: 100_000,
      matchedTokenBudget: 100_000_000,
    };
    expect(refinementBudget(ceiling)).toMatchObject(ceiling);
    expect(() => refinementBudget({ ...ceiling, epochs: 25 })).toThrow(/epochs/);
    expect(() => refinementBudget({ ...ceiling, sampleCount: 100_001 })).toThrow(/sampleCount/);
    expect(() => refinementBudget({
      ...ceiling,
      matchedTokenBudget: 100_000_001,
    })).toThrow(/matchedTokenBudget/);
  });

  it('accepts only a complete immutable artifact binding', () => {
    const binding = fixtureBinding({
      sourceManifestSha256: SHA('0'),
      adapterId: 'prooflet-refinement-1',
      adapterArtifactSha256: SHA('4'),
      adapterScale: 0.5,
      approvedScales: [0.5],
      operatorDecisionSha256: SHA('6'),
      ...sourceFields,
    });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(binding.sourceManifestSha256).toBe(SHA('0'));
    expect(binding.approvedScales).toEqual([0.5]);
    expect(binding.sourceCommitSha256).toBe(refinementSha256(COMMIT));
    expect(() => refinementBinding({ ...binding, operatorDecisionSha256: undefined })).toThrow(/operatorDecision/);
    expect(() => refinementBinding({ ...binding, converterScriptSha256: undefined })).toThrow(/converterScript/);
    expect(() => refinementBinding({ ...binding, adapterScale: 2 })).toThrow(/adapterScale/);
    // The contract holds an exact own field set: an extra key is as fatal as a missing one.
    expect(() => refinementBinding({ ...binding, operatorApprovalSha256: SHA('6') }))
      .toThrow(/exact own string field set/);
  });

  it('refuses training provenance without both approvals and binds the exact curriculum', () => {
    const config = inspectedConfig();
    const ceremony = trainingCeremony();
    const values = planValues(config, ceremony);
    expect(() => adapterBindingContext({
      ...values,
      ceremony: { ...ceremony, consent: {} },
    })).toThrow(/consent event chain failed validation/);
    const approval = trainingApprovalPlan(values);
    const consumed = decided(ceremony, approval.trainingPlanSha256);
    const context = adapterBindingContext({
      ...values,
      ceremony: consumed.ceremony,
      trainingPlanSha256: approval.trainingPlanSha256,
      operatorDecisionSha256: consumed.operatorDecisionSha256,
    });
    const binding = completeAdapterBinding({
      context,
      adapterId: ADAPTER_ID,
      artifactSha256: SHA('5'),
      scale: 1,
    });
    expect(binding.curriculumSha256).toBe(values.corpus.sourceCorpusSha256);
    expect(binding.sourceManifestSha256).toBe(values.corpus.sourceManifestSha256);
    expect(binding.trainingConfigSha256).toBe(config.sha256);
    expect(binding.trainingPlanSha256).toBe(approval.trainingPlanSha256);
    expect(binding.operatorDecisionSha256).toBe(consumed.operatorDecisionSha256);
    expect(binding.converterScriptSha256).toBe(values.converterScriptSha256);
    expect(binding.approvedScales).toEqual([1]);
    const scaleStudy = trainingApprovalPlan({ ...values, approvedScales: [0, 0.5, 1] });
    expect(scaleStudy.trainingPlanSha256).not.toBe(approval.trainingPlanSha256);
    // A decision consumed for THIS plan cannot carry a different approved-scale set.
    expect(() => adapterBindingContext({
      ...values,
      approvedScales: [0, 0.5, 1],
      ceremony: consumed.ceremony,
      trainingPlanSha256: approval.trainingPlanSha256,
      operatorDecisionSha256: consumed.operatorDecisionSha256,
    })).toThrow(/operator decision does not match/);
    expect(trainingApprovalPlan({
      ...values,
      corpus: { ...values.corpus, sourceManifestSha256: SHA('6') },
    }).trainingPlanSha256).not.toBe(approval.trainingPlanSha256);
    expect(trainingApprovalPlan({
      ...values,
      converterScriptSha256: SHA('c'),
    }).trainingPlanSha256).not.toBe(approval.trainingPlanSha256);
    expect(() => refinementTrainingPlanSha256({})).toThrow(/exact v2 binding authority/);
  });

  it('hashes object keys canonically', () => {
    expect(refinementSha256({ a: 1, b: 2 })).toBe(refinementSha256({ b: 2, a: 1 }));
  });
});
