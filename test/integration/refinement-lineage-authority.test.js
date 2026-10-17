import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import {
  openCommittedRefinementLineageConfigAuthority,
  refinementServingLineageSha256,
  validateRefinementLineageAuthorityDocument,
} from '../../backend/services/refinement-lineage-authority.js';
import {
  createRefinementProcessOperation,
} from '../../backend/services/refinement-process-operation.js';

const SERVING_MODEL = 'fixture/served-model';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const exactTuple = () => {
  const baseArtifactSha256 = sha256('fixture trainer snapshot');
  const tokenizerSha256 = sha256('fixture tokenizer');
  return Object.freeze({
    servingModel: SERVING_MODEL,
    servingArtifactSha256: sha256('fixture serving gguf'),
    trainerModelId: 'fixture/trainer-model',
    trainerRevision: 'a'.repeat(40),
    baseArtifactSha256,
    tokenizerSha256,
    baseModelIdentitySha256: refinementSha256({
      modelId: SERVING_MODEL,
      modelArtifactSha256: baseArtifactSha256,
      tokenizerSha256,
    }),
  });
};

describe('committed refinement lineage authority', () => {
  it('keeps an empty committed document empty instead of minting fallback lineage', () => {
    const document = validateRefinementLineageAuthorityDocument({
      version: 1,
      lineages: [],
    });

    expect(document).toEqual({ version: 1, lineages: [] });
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.lineages)).toBe(true);
  });

  it('validates and freezes the complete exact serving/trainer tuple without paths', () => {
    const tuple = exactTuple();
    const document = validateRefinementLineageAuthorityDocument({
      version: 1,
      lineages: [tuple],
    });

    expect(document.lineages).toEqual([tuple]);
    expect(Object.isFrozen(document.lineages[0])).toBe(true);
    expect(document.lineages[0]).not.toHaveProperty('modelPath');
    expect(refinementServingLineageSha256(document.lineages[0]))
      .toMatch(/^[0-9a-f]{64}$/);
  });

  it('binds an adjacent trainer revision change to a different serving-lineage digest', () => {
    const tuple = exactTuple();
    const changed = Object.freeze({
      ...tuple,
      trainerRevision: 'b'.repeat(40),
    });

    expect(refinementServingLineageSha256(changed))
      .not.toBe(refinementServingLineageSha256(tuple));
  });

  it('rejects duplicate serving keys before any tuple can resolve ambiguously', () => {
    const tuple = exactTuple();

    expect(() => validateRefinementLineageAuthorityDocument({
      version: 1,
      lineages: [
        tuple,
        { ...tuple, servingArtifactSha256: sha256('other serving bytes') },
      ],
    })).toThrow(/duplicate serving key/);
  });

  it('accepts no caller-selected authority path or forged source authority', async () => {
    const operation = createRefinementProcessOperation({ timeoutMs: 30_000 });

    await expect(openCommittedRefinementLineageConfigAuthority({
      operation,
      sourceAuthority: Object.freeze({}),
      authorityPath: '/tmp/caller-selected-lineages.json',
    })).rejects.toThrow(/request is invalid/);
    await expect(openCommittedRefinementLineageConfigAuthority({
      operation,
      sourceAuthority: Object.freeze({}),
    })).rejects.toThrow(/source proof|source authority/);
  });
});
