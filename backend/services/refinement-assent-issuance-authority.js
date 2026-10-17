import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import { assertRefinementSubjectAuthority } from './refinement-subject-authority.js';

const CEREMONY_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const AUTHORITIES = new WeakMap();
const refuse = () => Object.assign(
  new Error('refinement assent issuance authority is invalid'),
  { code: 'ASSENT_ISSUANCE_STALE' },
);
const exactIso = (value) => ISO.test(String(value || ''))
  && new Date(Date.parse(value)).toISOString() === value;

/** Brand only the same-operation subject and persisted issuance projection. */
export const issueRefinementAssentIssuanceAuthority = ({
  subjectAuthority, ceremonyId, issuedAt, issuanceRevision, requestNonceSha256, operation,
}) => {
  const activeOperation = assertRefinementProcessOperation(operation);
  assertRefinementSubjectAuthority(subjectAuthority, activeOperation);
  if (!CEREMONY_ID.test(String(ceremonyId || '')) || !exactIso(issuedAt)
    || !Number.isSafeInteger(issuanceRevision) || issuanceRevision < 1
    || !SHA256.test(String(requestNonceSha256 || ''))) throw refuse();
  const projection = Object.freeze({
    subjectAuthority, ceremonyId, issuedAt, issuanceRevision, requestNonceSha256,
  });
  const authority = Object.freeze({ kind: 'refinement-assent-issuance-authority-v2' });
  AUTHORITIES.set(authority, Object.freeze({ operation: activeOperation, projection }));
  return authority;
};

export const assertRefinementAssentIssuanceAuthority = (authority, operation) => {
  const state = AUTHORITIES.get(authority);
  if (!state || state.operation !== assertRefinementProcessOperation(operation)) throw refuse();
  assertRefinementSubjectAuthority(state.projection.subjectAuthority, state.operation);
  return state.projection;
};
