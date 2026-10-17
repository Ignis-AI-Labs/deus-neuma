import { validateRefinementAdapter } from '../../core/refinement/training-authority-contract.js';
import {
  assertCommittedRefinementLineageEvidence,
} from './refinement-lineage-authority.js';

/** Bind one canonical digest-only adapter record to one committed serving lineage authority. */
export const assertAdapterArtifactIntegrity = async ({
  adapter,
  lineageConfigAuthority,
  operation,
  servingArtifactSha256,
  servingModel,
}) => {
  const candidate = validateRefinementAdapter(adapter);
  if (candidate.baseModel !== servingModel
    || candidate.binding.servingArtifactSha256 !== servingArtifactSha256) {
    throw new Error('registered adapter does not match the requested serving tuple');
  }
  await assertCommittedRefinementLineageEvidence({
    evidence: candidate.provenance.servingLineage,
    lineageConfigAuthority,
    operation,
    servingArtifactSha256,
    servingModel,
  });
  return candidate;
};
