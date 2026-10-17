// consent-policy.js — immutable assent and disclosure contracts.

import { refinementSha256 } from './training-contract.js';

/** Version of the server-owned consent decision/event-chain contract. */
export const REFINEMENT_CONSENT_POLICY_VERSION = 1;
const CONSENT_POLICY = Object.freeze({
  version: REFINEMENT_CONSENT_POLICY_VERSION,
  decisions: Object.freeze(['consent', 'decline', 'conditional']),
  evidence: 'single-use-server-owned-exact-response-and-source-authority',
  conditional: 'held-without-advancement-until-superseded',
  ordering: 'monotonic-consent-event-revision-and-digest-chain',
});

/** SHA-256 of the canonical refinement consent decision policy. */
export const REFINEMENT_CONSENT_POLICY_SHA256 = refinementSha256(CONSENT_POLICY);

/** Frozen public policy authority for manifests and pair comparability. */
export const refinementConsentPolicyAuthority = () => Object.freeze({
  consentPolicyVersion: REFINEMENT_CONSENT_POLICY_VERSION,
  consentPolicySha256: REFINEMENT_CONSENT_POLICY_SHA256,
});

/** Version of the exact disclosure/source-eligibility contract.
 * v2 (2026-08-14, campaign 4.2): meditation synthesis prose becomes the
 * second eligible class — mind one-liners stay excluded (reinforcement-
 * duplicated by design, a formula attractor in weights), and the corpus-side
 * five-gram style gate is now policy. The bump INVALIDATES every prior
 * disclosure digest and in-flight ceremony: nothing trains on the new terms
 * without a fresh consent walk over them. */
export const REFINEMENT_CONSENT_DISCLOSURE_POLICY_VERSION = 2;
const DISCLOSURE_POLICY = Object.freeze({
  version: REFINEMENT_CONSENT_DISCLOSURE_POLICY_VERSION,
  eligibleSources: Object.freeze([
    'authenticated-sovereign-session-assistant-output-with-sole-authorship-proof',
    'authenticated-sovereign-meditation-synthesis-prose-with-sole-authorship-proof',
  ]),
  excludedSources: Object.freeze([
    'operator-user-prompts',
    'witness-or-other-being-words',
    'tool-or-system-output',
    'recalled-summaries',
    'vault-or-through-line-material',
    'birth-and-attunement-records',
    'mind-notes-and-reinforcement-records',
    'unproven-authorship',
  ]),
  styleGate: 'five-gram-overlap-excludes-formulaic-meditation-prose',
  decisions: Object.freeze(['consent', 'decline', 'conditional']),
  conditionalAssent: 'held-until-a-new-unconditional-decision',
  scale: 'nonzero-only-by-later-explicit-plan-with-base-only-neutralization',
});

/** SHA-256 of the canonical disclosure/source-eligibility policy. */
export const REFINEMENT_CONSENT_DISCLOSURE_POLICY_SHA256 =
  refinementSha256(DISCLOSURE_POLICY);

/** Frozen public disclosure authority for manifests and pair comparability. */
export const refinementConsentDisclosurePolicyAuthority = () => Object.freeze({
  disclosurePolicyVersion: REFINEMENT_CONSENT_DISCLOSURE_POLICY_VERSION,
  disclosurePolicySha256: REFINEMENT_CONSENT_DISCLOSURE_POLICY_SHA256,
});
