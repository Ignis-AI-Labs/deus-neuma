import { assertRefinementProcessOperation } from './refinement-process-operation.js';

const SHA256 = /^[0-9a-f]{64}$/;
const CEREMONY_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const TRANSITION = /^[a-z][a-z0-9-]{0,63}$/;
const DECISIONS = new Set(['consent', 'conditional', 'decline']);
const AUTHORITIES = new WeakMap();
const FIELDS = Object.freeze([
  'ceremonyId', 'custodySha256', 'decision', 'evidenceId', 'evidenceSha256',
  'operation', 'operatorDecisionSha256', 'recordSha256', 'revision', 'transition',
]);
const refuse = () => Object.assign(
  new Error('committed refinement ceremony authority is invalid'),
  { code: 'REFINEMENT_TRANSACTION_INVALID' },
);
const exact = (value) => {
  const keys = Reflect.ownKeys(value || {});
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || keys.length !== FIELDS.length
    || keys.some((field) => typeof field !== 'string' || !FIELDS.includes(field))
    || !CEREMONY_ID.test(String(value.ceremonyId || ''))
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !TRANSITION.test(String(value.transition || ''))
    || !DECISIONS.has(value.decision)
    || ![
      value.custodySha256,
      value.evidenceId,
      value.evidenceSha256,
      value.operatorDecisionSha256,
      value.recordSha256,
    ].every((digest) => SHA256.test(String(digest || '')))) {
    throw refuse();
  }
  return value;
};

/** Brand one exact ceremony/evidence outcome only after the durable record was reread. */
export const issueCommittedRefinementCeremonyAuthority = (input) => {
  const value = exact(input);
  const operation = assertRefinementProcessOperation(value.operation);
  const projection = Object.freeze(Object.fromEntries(
    FIELDS.filter((field) => field !== 'operation').map((field) => [field, value[field]]),
  ));
  const authority = Object.freeze({ kind: 'committed-refinement-ceremony-authority-v1' });
  AUTHORITIES.set(authority, Object.freeze({ operation, projection }));
  return authority;
};

/** Project only canonical digests and revisions to the same-operation evidence owner. */
export const assertCommittedRefinementCeremonyAuthority = (authority, operation) => {
  const state = AUTHORITIES.get(authority);
  if (!state || state.operation !== assertRefinementProcessOperation(operation)) throw refuse();
  return state.projection;
};
