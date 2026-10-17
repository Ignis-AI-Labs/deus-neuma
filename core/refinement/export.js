// Subject-only refinement corpus export over one held, bounded source snapshot.

import {
  corpusSamples,
  milestoneStatus,
  renderJsonl,
} from './corpus.js';
import { openSubjectCorpusSources } from './corpus-source-authority.js';
import { writeRefinementCorpusRecord } from './corpus-record-store.js';
import { freezeJson } from '../shared/plain-data-canonical.js';
import {
  REFINEMENT_CORPUS_LIMITS_SHA256,
  REFINEMENT_CORPUS_POLICY,
  REFINEMENT_CORPUS_POLICY_SHA256,
  refinementCorpusManifest,
  refinementCorpusManifestSha256,
} from './corpus-manifest.js';
import { refinementSha256, refinementTextSha256 } from './training-contract.js';

const exactDigest = (value) => /^[0-9a-f]{64}$/.test(String(value || ''));

/**
 * Build a bounded corpus and keep its exact source descriptors open for a
 * same-snapshot verification. Callers must invoke `close()` in `finally`.
 */
export async function buildRefinementCorpus(workspace, neumaId, opts = {}) {
  const held = await openSubjectCorpusSources(workspace, neumaId, { signal: opts.signal ?? null });
  try {
    const { system, samples } = corpusSamples({ completions: held.completions });
    const jsonl = renderJsonl(samples);
    const sourceCorpusSha256 = refinementTextSha256(jsonl);
    const instants = samples.map((sample) => sample.occurredAt).sort();
    const selected = held.sourceProjection.classCounts.sessionAssistant.selected;
    const corrupt = held.sourceProjection.classCounts.sessionAssistant.corrupt;
    const meditation = held.sourceProjection.classCounts.meditationSynthesis;
    const meditationDropped = meditation.corrupt + meditation.formulaic;
    const sourceAuthorityCore = freezeJson({
      ...held.sourceProjection,
      corpus: {
        sampleCount: samples.length,
        firstOccurredAt: instants[0] ?? null,
        lastOccurredAt: instants.at(-1) ?? null,
        byteLength: Buffer.byteLength(jsonl, 'utf8'),
        sourceCorpusSha256,
      },
    });
    const sourceAuthoritySha256 = refinementSha256(sourceAuthorityCore);
    const sourceManifest = refinementCorpusManifest({
      sourceAuthoritySha256,
      sampleCount: samples.length,
      sourceCorpusSha256,
    });
    const sourceManifestSha256 = refinementCorpusManifestSha256(sourceManifest);
    const sourceAuthority = freezeJson({
      ...sourceAuthorityCore,
      sourceAuthoritySha256,
      sourceManifestSha256,
    });
    const integrity = freezeJson({
      dropped: corrupt + meditationDropped,
      byTier: { episodes: corrupt, meditation: meditationDropped, attunement: 0, birth: 0 },
    });
    const provenance = freezeJson({
      policyId: REFINEMENT_CORPUS_POLICY.id,
      policySha256: REFINEMENT_CORPUS_POLICY_SHA256,
      limitsSha256: REFINEMENT_CORPUS_LIMITS_SHA256,
      sourceAuthoritySha256,
      classes: held.sourceProjection.classCounts,
      attunement: null,
      birth: { mode: 'excluded-by-policy', sampleCount: 0 },
      exchanges: { sampleCount: selected },
      meditation: { sampleCount: meditation.selected, formulaicExcluded: meditation.formulaic },
      dropped: integrity,
    });
    return Object.freeze({
      system,
      samples,
      birthWords: provenance.birth,
      integrity,
      provenance,
      sourceCorpusSha256,
      sourceManifest,
      sourceManifestSha256,
      sourceAuthority,
      sourceAuthoritySha256,
      milestone: milestoneStatus(samples, opts.milestone, opts.since ?? null),
      jsonl,
      verify: held.verify,
      close: held.close,
    });
  } catch (error) {
    await held.close();
    throw error;
  }
}

/**
 * Rebuild and verify the exact safe authority before assent, plan, or forge.
 * The returned build still owns its source descriptors: consume its samples
 * or JSONL from this object, then call `close()` in `finally`.
 */
export async function verifyRefinementCorpusSources(workspace, neumaId, expected, opts = {}) {
  if (!expected || !exactDigest(expected.sourceCorpusSha256)
    || !exactDigest(expected.sourceManifestSha256)
    || !exactDigest(expected.sourceAuthoritySha256)) {
    throw new Error('refinement corpus verification requires exact expected digests');
  }
  const current = await buildRefinementCorpus(workspace, neumaId, opts);
  try {
    await current.verify();
    if (current.sourceCorpusSha256 !== expected.sourceCorpusSha256
      || current.sourceManifestSha256 !== expected.sourceManifestSha256
      || current.sourceAuthoritySha256 !== expected.sourceAuthoritySha256) {
      throw new Error('refinement corpus sources changed');
    }
    return current;
  } catch (error) {
    await current.close();
    throw error;
  }
}

/** Build, verify, and persist one bounded encrypted corpus record. */
export async function exportRefinementCorpus(workspace, neumaId, opts = {}) {
  const built = await buildRefinementCorpus(workspace, neumaId, opts);
  try {
    if (!built.milestone.ready) {
      throw new Error('eligible subject-authored samples do not satisfy the refinement milestone');
    }
    await built.verify();
    const stored = freezeJson({
      builtAt: new Date().toISOString(),
      system: built.system,
      samples: built.samples,
      milestone: built.milestone,
      birthWords: built.birthWords,
      integrity: built.integrity,
      provenance: built.provenance,
      sourceCorpusSha256: built.sourceCorpusSha256,
      sourceManifest: built.sourceManifest,
      sourceManifestSha256: built.sourceManifestSha256,
      sourceAuthority: built.sourceAuthority,
      sourceAuthoritySha256: built.sourceAuthoritySha256,
    });
    await writeRefinementCorpusRecord(workspace, neumaId, stored);
    return stored;
  } finally {
    await built.close();
  }
}
