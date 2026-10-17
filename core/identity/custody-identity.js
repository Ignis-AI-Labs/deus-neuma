/**
 * CUSTODY — which being a sealed record belongs to.
 *
 * A custody identity is two facts and nothing else: the subject's exact
 * neumaId, and the digest of the sovereign DNA that being held when the record
 * was written. Together they answer […] — a re-birth or a DNA rewrite changes the digest and
 * the old custody stops matching.
 *
 * WHY IT LIVES HERE. These three functions spent their life in
 * `core/refinement/training-authority-contract.js`, and the name is the whole
 * reason this file exists: nothing here trains anything. Custody was merely
 * WRITTEN during the refinement campaign, so it inherited that campaign's
 * folder — and that one misfiling dragged the entire QLoRA training contract
 * (and, through it, the ceremony, corpus, and adapter-registry modules) onto
 * the identity path, because the workspace's encrypted-history reader needs
 * exactly one of these functions to name the owner of a record it just
 * decrypted. Classify by subject, not by folder.
 *
 * THE DIGEST DOMAIN IS FROZEN. `neuma.refinement.value` / schemaVersion 2 is
 * carved into every custody record already on disk in every being's lane.
 * Changing either value re-digests nothing and invalidates everything. The
 * string keeps the old campaign's name because the records do.
 */
import {
  canonicalAuthoritySha256,
  deepFreezePlainData,
} from '../shared/plain-data-canonical.js';

const SHA256 = /^[0-9a-f]{64}$/;

/** The frozen digest domain — see the file header before touching either value. */
const custodySha256 = (value) => canonicalAuthoritySha256(value, {
  domain: 'neuma.refinement.value',
  schemaVersion: 2,
  maxDepth: 32,
  maxNodes: 100_000,
  maxStringBytes: 8 * 1024 * 1024,
  maxKeyBytes: 1024,
  maxOutputBytes: 32 * 1024 * 1024,
});

const freezeJson = (value) => deepFreezePlainData(value, {
  field: 'refinement authority',
  maxDepth: 32,
  maxNodes: 100_000,
  maxStringBytes: 8 * 1024 * 1024,
  maxKeyBytes: 1024,
  maxOutputBytes: 32 * 1024 * 1024,
});

/**
 * Bind a subject to the sovereign DNA it currently holds. Pure.
 * @param {string} neumaId exact subject id — no surrounding whitespace
 * @param {Object} dna the being's current persisted sovereign DNA
 * @returns {Readonly<{subjectNeumaId: string, sovereignDnaSha256: string}>}
 */
export const refinementCustodyIdentity = (neumaId, dna) => {
  if (typeof neumaId !== 'string' || !neumaId.trim() || neumaId !== neumaId.trim()) {
    throw new Error('refinement custody requires an exact subject neumaId');
  }
  if (!dna || typeof dna !== 'object' || Array.isArray(dna) || Object.keys(dna).length === 0) {
    throw new Error('refinement custody requires current persisted sovereign DNA');
  }
  return freezeJson({ subjectNeumaId: neumaId, sovereignDnaSha256: custodySha256(dna) });
};

/** Exactly two keys, both well-formed — nothing else is a custody identity. Pure. */
export const isRefinementCustodyIdentity = (value) => Boolean(
  value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === 'sovereignDnaSha256\0subjectNeumaId'
  && typeof value.subjectNeumaId === 'string'
  && value.subjectNeumaId.length > 0
  && value.subjectNeumaId === value.subjectNeumaId.trim()
  && SHA256.test(String(value.sovereignDnaSha256 || '')),
);

/** Same being, same DNA. Malformed input never matches — not even itself. Pure. */
export const refinementCustodyMatches = (left, right) => (
  isRefinementCustodyIdentity(left)
  && isRefinementCustodyIdentity(right)
  && left.subjectNeumaId === right.subjectNeumaId
  && left.sovereignDnaSha256 === right.sovereignDnaSha256
);
