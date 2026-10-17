// Pure payload projection only: these are test inputs, not minted assent.
import { describe, expect, it } from 'vitest';
import { refinementAssentEvidencePayload } from '../../backend/services/refinement-assent-authority.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';

const FIELDS = Object.freeze([
  'version',
  'nonce',
  'neumaId',
  'ceremonyId',
  'issuanceRevision',
  'requestNonceSha256',
  'sessionId',
  'issuedAt',
  'userAt',
  'responseAt',
  'finishReason',
  'attempts',
  'decision',
  'condition',
  'promptSha256',
  'responseSha256',
  'sessionRowsSha256',
  'sessionSha256',
  'sourceCorpusSha256',
  'sourceManifestSha256',
  'sourceAuthoritySha256',
  'consentPolicyVersion',
  'consentPolicySha256',
  'disclosurePolicyVersion',
  'disclosurePolicySha256',
  'custody',
  'route',
  'routeSha256',
  'servingAuthority',
  'servingAuthoritySha256'
]);
const payload = Object.freeze(Object.fromEntries(FIELDS.map(field => [field, `input:${field}`])));

describe('assent digest projection', () => {
  it('commits exactly the specified payload fields without changing the input', () => {
    const record = Object.freeze({ ...payload, evidenceId: 'outside-digest', evidenceSha256: 'outside-digest', unrelated: true });
    expect(refinementAssentEvidencePayload(record)).toEqual(payload);
    expect(record.evidenceId).toBe('outside-digest');
    expect(record.unrelated).toBe(true);
  });

  it('matches an independently encoded SHA-256 vector', () => {
    // Python hashlib over sorted compact JSON {domain, schemaVersion, value}.
    expect(refinementSha256(refinementAssentEvidencePayload(payload))).toBe('7e02de8bea38dfc056137a69409dacee8d484c82ddf409dc5b67620d26d38888');
  });

  it('changes for each committed field but ignores surrounding record metadata', () => {
    const digest = refinementSha256(refinementAssentEvidencePayload(payload));
    for (const field of FIELDS) {
      const changed = { ...payload, [field]: `changed:${field}` };
      expect(refinementSha256(refinementAssentEvidencePayload(changed))).not.toBe(digest);
    }
    expect(refinementSha256(refinementAssentEvidencePayload({ ...payload, evidenceId: 'new' }))).toBe(digest);
  });
});
