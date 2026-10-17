// Pure geometry and budget identities used by refinement authority contracts.

import { createHash } from 'node:crypto';
import {
  canonicalAuthoritySha256,
  deepFreezePlainData,
} from '../shared/plain-data-canonical.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const DEFAULT_TARGET_POLICY = 'text-attention-projections-v1';
const freezeJson = (value) => deepFreezePlainData(value, {
  field: 'refinement authority',
  maxDepth: 32,
  maxNodes: 100_000,
  maxStringBytes: 8 * 1024 * 1024,
  maxKeyBytes: 1024,
  maxOutputBytes: 32 * 1024 * 1024,
});

export const refinementSha256 = (value) => canonicalAuthoritySha256(value, {
  domain: 'neuma.refinement.value',
  schemaVersion: 2,
  maxDepth: 32,
  maxNodes: 100_000,
  maxStringBytes: 8 * 1024 * 1024,
  maxKeyBytes: 1024,
  maxOutputBytes: 32 * 1024 * 1024,
});

export const refinementTextSha256 = (value) => createHash('sha256')
  .update(String(value), 'utf8')
  .digest('hex');

const ADAMW_V1 = Object.freeze({
  implementation: 'torch.optim.AdamW',
  beta1: 0.9,
  beta2: 0.999,
  epsilon: 1e-8,
  weightDecay: 0.01,
  amsgrad: false,
});
export const refinementOptimizerConfigSha256 = refinementSha256(ADAMW_V1);

const positiveInteger = (value, field, maximum = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} must be a positive safe integer at most ${maximum}`);
  }
  return value;
};
const positiveFinite = (value, field, maximum = Number.MAX_VALUE) => {
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`${field} must be positive and at most ${maximum}`);
  }
  return value;
};
const boundedId = (value, field) => {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`${field} must be a bounded id`);
  }
  return value;
};

export const refinementApprovedScales = (values = [1]) => {
  if (!Array.isArray(values) || values.length < 1 || values.length > 64) {
    throw new Error('approvedScales must contain between 1 and 64 values');
  }
  const scales = values.map((value) => {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('approvedScales values must be finite in [0, 1]');
    }
    return value === 0 ? 0 : value;
  });
  return Object.freeze([...new Set(scales)].sort((left, right) => left - right));
};

const normalizedTargets = (targets) => {
  if (targets == null) return Object.freeze([]);
  if (!Array.isArray(targets)) throw new Error('targetModules must be an array');
  if (targets.length > 1024) throw new Error('targetModules must contain at most 1024 entries');
  const values = targets.map((target) => {
    if (typeof target !== 'string' || !target.trim() || target.length > 512) {
      throw new Error('targetModules entries must be non-empty strings at most 512 characters');
    }
    return target.trim();
  });
  if (new Set(values).size !== values.length) throw new Error('targetModules must be unique');
  return Object.freeze([...values].sort());
};

export const refinementGeometry = (values = {}) => {
  const rank = positiveInteger(values.rank ?? 8, 'rank', 64);
  const alpha = positiveFinite(values.alpha ?? rank * 2, 'alpha', 512);
  const dropout = values.dropout ?? 0;
  if (!Number.isFinite(dropout) || dropout < 0 || dropout >= 1) {
    throw new Error('dropout must be finite in [0, 1)');
  }
  const targetModules = normalizedTargets(values.targetModules);
  const targetPolicyId = boundedId(values.targetPolicyId ?? DEFAULT_TARGET_POLICY, 'targetPolicyId');
  if (!['text-attention-projections-v1', 'exact-module-list-v1'].includes(targetPolicyId)) {
    throw new Error('targetPolicyId is unsupported');
  }
  if (targetModules.length && targetPolicyId === 'text-attention-projections-v1'
    && targetModules.some((target) => !/(?:^|\.)(?:q_proj|k_proj|v_proj|o_proj)$/.test(target))) {
    throw new Error('text-attention-projections-v1 accepts only explicit q/k/v/o modules');
  }
  if (!targetModules.length && targetPolicyId === 'exact-module-list-v1') {
    throw new Error('exact-module-list-v1 requires targetModules');
  }
  const geometry = freezeJson({
    rank,
    alpha,
    dropout,
    maxLength: positiveInteger(values.maxLength ?? 2048, 'maxLength', 8192),
    targetPolicyId,
    targetModules,
    targetModulesSha256: refinementSha256(targetModules),
  });
  return Object.freeze({ ...geometry, sha256: refinementSha256(geometry) });
};

export const refinementBudget = (values = {}) => {
  const budget = freezeJson({
    epochs: positiveInteger(values.epochs ?? 3, 'epochs', 24),
    learningRate: positiveFinite(values.learningRate ?? 1e-4, 'learningRate', 1),
    sampleCount: positiveInteger(values.sampleCount, 'sampleCount', 100_000),
    matchedTokenBudget: positiveInteger(values.matchedTokenBudget, 'matchedTokenBudget', 100_000_000),
    minimumCompletionTokens: positiveInteger(
      values.minimumCompletionTokens ?? 8,
      'minimumCompletionTokens',
      8192,
    ),
    optimizer: boundedId(values.optimizer ?? 'adamw-v1', 'optimizer'),
    optimizerConfigSha256: values.optimizerConfigSha256 ?? refinementOptimizerConfigSha256,
    seed: values.seed ?? 1,
  });
  if (budget.optimizer !== 'adamw-v1') throw new Error('optimizer must be adamw-v1');
  if (budget.optimizerConfigSha256 !== refinementOptimizerConfigSha256) {
    throw new Error('optimizerConfigSha256 must match adamw-v1');
  }
  if (!Number.isSafeInteger(budget.seed) || budget.seed < 0 || budget.seed > 4_294_967_295) {
    throw new Error('seed must be an unsigned 32-bit integer');
  }
  return Object.freeze({ ...budget, sha256: refinementSha256(budget) });
};
