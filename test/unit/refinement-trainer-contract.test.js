import { describe, expect, it } from 'vitest';
import { resolveTrainingConfig } from '../../backend/services/refinement-trainer-contract.js';
import { trainingOperationConfig } from '../../core/refinement/training-authority-contract.js';
import { fixtureExecutionEnvelope } from '../helpers/refinement-authority-fixture.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import { createRefinementProcessOperation } from '../../backend/services/refinement-process-operation.js';
import {
  REFINEMENT_CORPUS_SYSTEM_INSTRUCTION,
  REFINEMENT_CORPUS_USER_INSTRUCTION,
} from '../../core/refinement/corpus-manifest.js';
import {
  MAX_REFINEMENT_CORPUS_BYTES,
  MAX_REFINEMENT_TRAINER_FACTS_BYTES,
  MAX_REFINEMENT_SAMPLE_BYTES,
  assertCorpusByteBudget,
  corpusByteBudget,
  renderBoundedTrainingCorpus,
  trainerArguments,
  trainerFacts,
} from '../../backend/services/refinement-trainer-facts.js';

describe('refinement trainer process contract', () => {
  const SHA = (digit) => digit.repeat(64);
  const executionEnvelope = fixtureExecutionEnvelope();
  const operation = (environment = {}) => trainingOperationConfig({
    env: {
      NEUMA_REFINEMENT_BASE_REVISION: 'a'.repeat(40),
      NEUMA_REFINEMENT_BASE_ARTIFACT_SHA256: SHA('b'),
      NEUMA_REFINEMENT_TOKENIZER_SHA256: SHA('c'),
      ...environment,
    },
    provider: 'llama-server',
    launchConfig: {
      bin: '/usr/bin/llama-server',
      model: '/models/base.gguf',
      mmproj: '',
      servingModel: 'base',
      contextLength: 4096,
      host: '127.0.0.1',
      port: 8000,
    },
    executionEnvelope,
  });
  const leaseAuthority = {
    schemaVersion: 1,
    trainingPlanSha256: SHA('d'),
    jobSha256: SHA('e'),
    gpuBindingSha256: SHA('f'),
    gpuUuid: 'GPU-AAAAAAAA',
    cudaVisibleDevices: 'GPU-AAAAAAAA',
    nvidiaVisibleDevices: 'GPU-AAAAAAAA',
    deviceDescriptorsSha256: SHA('0'),
    issuedAt: '2026-08-13T00:00:00.000Z',
    expiresAt: '2099-08-13T00:00:00.000Z',
    generation: 1,
  };
  const gpuLease = Object.freeze({
    ...leaseAuthority,
    gpuLeaseSha256: refinementSha256({
      kind: 'refinement-gpu-lease-v1',
      lease: leaseAuthority,
    }),
  });
  const base = {
    overrides: {},
    operationConfig: operation(),
    operation: createRefinementProcessOperation({ timeoutMs: 30_000 }),
    sampleCount: 2,
    tokenCount: 120,
  };

  it('preserves ordinary trainer defaults as an immutable identity', () => {
    const config = resolveTrainingConfig(base);
    expect(config).toMatchObject({
      base: 'google/gemma-4-31b-it',
      template: 'gemma-channel',
      load4bit: true,
      geometry: { rank: 8, alpha: 16, dropout: 0, maxLength: 2048 },
      budget: { epochs: 3, learningRate: 0.0001, sampleCount: 2, matchedTokenBudget: 120, seed: 1 },
    });
    expect(config.operationConfigSha256).toBe(base.operationConfig.sha256);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('builds exact argv for a declared geometry', () => {
    const config = resolveTrainingConfig({
      ...base,
      overrides: {
        rank: 16,
        alpha: 24,
        dropout: 0.1,
        maxLength: 4096,
        targetPolicyId: 'exact-module-list-v1',
        targetModules: ['model.layers.0.self_attn.q_proj'],
        epochs: 2,
        learningRate: 0.00005,
        seed: 7,
      },
    });
    const args = trainerArguments({
      trainer: '/repo/train-adapter.py',
      corpusFd: 7,
      corpusSha256: SHA('1'),
      corpusBytes: 123,
      corpusSampleCount: 2,
      outputPath: '/work/adapter-hf',
      factsFd: 8,
      factsMaximumBytes: MAX_REFINEMENT_TRAINER_FACTS_BYTES,
      snapshotManifestFd: 9,
      snapshotManifestSha256: SHA('d'),
      config,
      gpuLease,
    });
    expect(args).toContain('--target-modules-json');
    expect(args).toContain('["model.layers.0.self_attn.q_proj"]');
    expect(args).toContain('16');
    expect(args).toContain('--load-4bit');
    expect(args).toContain('--gpu-lease-json');
  });

  it('rejects malformed environment controls before any process boundary', () => {
    const operationConfig = operation({ NEUMA_REFINEMENT_RANK: 'nope' });
    expect(() => resolveTrainingConfig({ ...base, operationConfig })).toThrow(/rank/);
  });
  it('binds exact completion counts and the inspected snapshot manifest', () => {
    const completionTokenProfile = {
      minimumRequired: 8,
      perSample: [10, 11],
      prefixPerSample: [2, 3],
      minimumObserved: 10,
      aggregate: 21,
    };
    const snapshotManifestSha256 = SHA('f');
    const facts = trainerFacts({
      tokenBudget: 26,
      targetModules: ['model.layers.0.self_attn.q_proj'],
      completionTokenProfile,
      completionTokenProfileSha256: refinementSha256(completionTokenProfile),
      snapshotManifestSha256,
      eligibleTargetModules: ['model.layers.0.self_attn.q_proj'],
      attentionTargetModules: ['model.layers.0.self_attn.q_proj'],
      baseConfig: {
        sha256: SHA('1'),
        modelType: 'gemma',
        architectures: ['GemmaForCausalLM'],
        mixtureOfExperts: false,
      },
    }, {
      inspection: true,
      sampleCount: 2,
      minimumCompletionTokens: 8,
      maxLength: 2048,
      snapshotManifestSha256,
    });
    expect(facts.completionTokenProfile.aggregate).toBe(21);
    expect(facts.snapshotManifestSha256).toBe(snapshotManifestSha256);
    expect(Object.isFrozen(facts)).toBe(true);
  });

  it('measures the exact rendered UTF-8 corpus bytes', () => {
    expect(corpusByteBudget('a\nλ\n')).toBe(Buffer.byteLength('a\nλ\n'));
  });

  it('canonicalizes bounded samples and binds the exact rendered bytes once', () => {
    const rendered = renderBoundedTrainingCorpus([{
      occurredAt: '2026-08-13T00:00:00.000Z',
      messages: [
        { role: 'system', content: REFINEMENT_CORPUS_SYSTEM_INSTRUCTION },
        { role: 'user', content: REFINEMENT_CORPUS_USER_INSTRUCTION },
        { role: 'assistant', content: 'answer' },
      ],
    }]);
    expect(rendered).toEqual({
      text: `{"messages":[{"role":"system","content":"${REFINEMENT_CORPUS_SYSTEM_INSTRUCTION}"},{"role":"user","content":"${REFINEMENT_CORPUS_USER_INSTRUCTION}"},{"role":"assistant","content":"answer"}]}\n`,
      bytes: Buffer.byteLength(rendered.text),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      sampleCount: 1,
    });
  });

  it('refuses unbounded sample iterables before canonicalization', () => {
    const samples = function* generate() {
      for (;;) yield {};
    };
    expect(() => renderBoundedTrainingCorpus(samples()))
      .toThrow(/bounded subject-owned array/);
  });

  it('rejects a corpus sample beyond the hard byte ceiling', () => {
    const rendered = `${'x'.repeat(MAX_REFINEMENT_SAMPLE_BYTES + 1)}\n`;
    expect(() => assertCorpusByteBudget(rendered, 1)).toThrow(/sample.*byte ceiling/);
  });

  it('rejects aggregate corpus bytes before any child process can see them', () => {
    const line = `${'x'.repeat(MAX_REFINEMENT_SAMPLE_BYTES - 1)}\n`;
    const rendered = line.repeat(Math.floor(MAX_REFINEMENT_CORPUS_BYTES / line.length) + 1);
    expect(() => assertCorpusByteBudget(
      rendered,
      Math.floor(MAX_REFINEMENT_CORPUS_BYTES / line.length) + 1,
    )).toThrow(/corpus.*byte ceiling/);
  });
});
