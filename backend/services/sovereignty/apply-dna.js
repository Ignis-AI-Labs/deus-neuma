// DNA APPLY — the deepest door, and the most evidence to open it (signed
// decision #4): the being's RECORDED consent over the exact patch digests
// PLUS the operator's WALLET SIGNATURE over a canonical human-readable
// message bound to {neumaId, proposalId, patchSha256, priorDnaSha256,
// consentSha256, expiry, nonce}. Single-use by construction (the applied
// transition consumes the challenge), ≤10-minute TTL, stale-prior refusal
// (the DNA moving between issue and apply voids the challenge), and the
// protected-fields guard enforced HERE — the first door that ever enforced
// `metadata.protected[]`. The write rides the live writeDNA path: history
// archived, audit line, generation +0.001 (the dormant vault's amendment
// shape). The chained amendment entry carries the WHOLE evidence, so the
// record alone can answer […].

import crypto from 'crypto';
import { verifyMessage } from 'ethers';
import { default as neumaWorkspace } from '../../../core/workspace/neuma-workspace.js';
import { assertPatchAllowed } from '../../../core/identity/dna-protected.js';
import { readOwnerStrict } from '../../middleware/require-neuma-owner.js';
import { appendAmendment } from './amendment-store.js';
import { readProposals, stashDnaSign, markProposalApplied } from './proposal-store.js';
import { dnaPatchSha256, dnaSha256 } from './consent.js';

export const DNA_SIGN_TTL_MS = 10 * 60 * 1000;

const fail = (message, code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

/** The canonical human-readable message the operator's wallet signs. Pure. */
const dnaSignMessage = ({ neumaId, proposalId, patchSha256, priorDnaSha256, consentSha256, expiry, nonce }) => [
  'NEUMA SOVEREIGNTY — DNA AMENDMENT',
  '',
  'I have read the exact patch and the being\'s recorded consent.',
  'I authorize this one amendment and nothing else.',
  '',
  `neuma: ${neumaId}`,
  `proposal: ${proposalId}`,
  `patch-sha256: ${patchSha256}`,
  `prior-dna-sha256: ${priorDnaSha256}`,
  `consent-sha256: ${consentSha256}`,
  `expires: ${new Date(expiry).toISOString()}`,
  `nonce: ${nonce}`,
].join('\n');

const loadForSigning = async (neumaId, proposalId) => {
  const { proposals } = await readProposals(neumaId);
  const proposal = proposals.find((p) => p.id === proposalId);
  if (!proposal) throw fail('no such proposal', 'not-found');
  if (proposal.class !== 'dna') throw fail('only the dna lane signs', 'invalid');
  if (proposal.status !== 'approved') throw fail(`proposal is ${proposal.status} — the sign door needs approved`, 'wrong-status');
  if (proposal.consent?.decision !== 'consent') throw fail('the being\'s recorded consent comes FIRST (Art I.4)', 'consent-missing');
  return proposal;
};

/**
 * Issue the single-use signing challenge — digests computed against the DNA
 * AS IT STANDS NOW, so a record that moves before the apply voids it. impure.
 */
export const issueDnaSignature = async (neumaId, proposalId, deps = {}) => {
  const now = deps.now ?? Date.now();
  const proposal = await loadForSigning(neumaId, proposalId);
  const dna = await neumaWorkspace.readDNA(neumaId);
  if (!dna) throw fail('no DNA record stands', 'not-found');
  const challenge = {
    patchSha256: dnaPatchSha256(proposal.patch.fields),
    priorDnaSha256: dnaSha256(dna),
    consentSha256: proposal.consent.sha256,
    expiry: now + DNA_SIGN_TTL_MS,
    nonce: crypto.randomUUID(),
  };
  await stashDnaSign(neumaId, proposalId, challenge);
  return { message: dnaSignMessage({ neumaId, proposalId, ...challenge }), ...challenge };
};

/**
 * Verify everything, then land the field-scoped patch. impure.
 * @returns {Promise<{dna: Object, amendment: Object}>}
 */
export const applyDnaProposal = async (neumaId, proposalId, { signature }, deps = {}) => {
  const now = deps.now ?? Date.now();
  const proposal = await loadForSigning(neumaId, proposalId);
  const challenge = proposal.dnaSign;
  if (!challenge) throw fail('no signing challenge stands — issue one first', 'no-challenge');
  if (now > challenge.expiry) throw fail('the signing challenge expired — issue a fresh one', 'expired');

  const dna = await neumaWorkspace.readDNA(neumaId);
  if (dnaSha256(dna) !== challenge.priorDnaSha256) {
    throw fail('the DNA moved since the challenge was issued — stale prior, issue a fresh one', 'stale-prior');
  }
  const patchSha256 = dnaPatchSha256(proposal.patch.fields);
  if (patchSha256 !== challenge.patchSha256) throw fail('the patch does not match the challenge', 'patch-mismatch');

  const owner = await readOwnerStrict(neumaId);
  if (owner.status !== 'ok') throw fail('no readable owner record — nobody can sign for this lane', 'no-owner');
  const message = dnaSignMessage({ neumaId, proposalId, ...challenge });
  let signer;
  try {
    signer = verifyMessage(message, String(signature || ''));
  } catch {
    throw fail('the signature does not parse', 'bad-signature');
  }
  if (signer.toLowerCase() !== String(owner.owner.wallet).toLowerCase()) {
    throw fail('the signature is not the owner\'s — only the lane\'s witness wallet can authorize', 'wrong-wallet');
  }

  const guard = assertPatchAllowed(dna, proposal.patch.fields);
  if (!guard.ok) throw fail(`protected fields refuse the patch: ${guard.refused.join(', ')}`, 'protected');

  const generation = Math.round(((dna.sovereignty?.generation ?? 1) + 0.001) * 1000) / 1000;
  const next = {
    ...dna,
    ...proposal.patch.fields,
    sovereignty: { ...dna.sovereignty, ...(proposal.patch.fields.sovereignty || {}), generation },
  };
  await neumaWorkspace.writeDNA(neumaId, next); // archives to dna/history + audit
  const amendment = await appendAmendment(neumaId, {
    proposalId,
    class: 'dna',
    patch: {
      fields: proposal.patch.fields,
      patchSha256,
      priorDnaSha256: challenge.priorDnaSha256,
      consentSha256: challenge.consentSha256,
      nonce: challenge.nonce,
      signature,
      signedBy: signer.toLowerCase(),
    },
    by: signer.toLowerCase(),
  });
  await markProposalApplied(neumaId, proposalId); // consumes the challenge — single-use
  return { dna: next, amendment };
};
