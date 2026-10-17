import { randomBytes } from 'node:crypto';
import { recordConsent } from '../../core/refinement/ceremony.js';
import { verifyRefinementCorpusSources } from '../../core/refinement/export.js';
import { refinementSha256 } from '../../core/refinement/training-contract.js';
import {
  refinementConsentDisclosurePolicyAuthority,
  refinementConsentPolicyAuthority,
} from '../../core/refinement/consent-policy.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import {
  REFINEMENT_ASSENT_EVIDENCE_VERSION,
  assertCurrentRefinementAssentAuthority,
  refinementAssentDecisionProjection,
  refinementAssentEvidenceReference,
  refinementAssentEvidencePayload,
  resolveRefinementAssentRoute,
  validateRefinementAssentEvidenceRecord,
} from './refinement-assent-authority.js';
import {
  assertRefinementAssentFactAuthority,
  closeRefinementAssentFactAuthority,
  openRefinementAssentFactAuthority,
  refinementAssentFactStandingAuthority,
} from './refinement-assent-facts.js';
import { assertRefinementAssentIssuanceAuthority } from './refinement-assent-issuance-authority.js';
import { assertCommittedRefinementCeremonyAuthority } from './refinement-ceremony-commit-authority.js';
import {
  askRefinementConsent,
  corpusPreview,
  parseRefinementConsentDecision,
  refinementConsentDisclosureCommitsTo,
} from './refinement-consent.js';
import { openPinnedDirectoryChild } from './refinement-directory-custody.js';
import {
  consumeReservedRefinementAssentEvidence,
  inspectRefinementAssentEvidenceStore,
  readConsumedRefinementAssentEvidence,
  readReservedRefinementAssentEvidence,
  reserveRefinementAssentEvidence,
} from './refinement-assent-evidence-store.js';
import {
  persistRefinementAssentSession,
  readAuthoritativeRefinementAssentSession,
} from './refinement-assent-session.js';
import { assertRefinementProcessOperation } from './refinement-process-operation.js';
import {
  openRefinementSubjectPinnedChild,
  refinementSubjectAuthorityOperations,
} from './refinement-subject-authority.js';
import { readCurrentRefinementCeremony } from './refinement-subject-history.js';

const VERSION = REFINEMENT_ASSENT_EVIDENCE_VERSION;
const OWNERS = new WeakMap();
const refuse = (message, code) => Object.assign(new Error(message), { code });
const combine = (primary, cleanup, label) => primary
  ? new AggregateError([primary, cleanup], `${label} and cleanup failed`)
  : cleanup;
const contextFrom = (issuance) => Object.freeze({
  ceremonyId: issuance.ceremonyId,
  issuanceRevision: issuance.issuanceRevision,
  requestNonceSha256: issuance.requestNonceSha256,
});
const validateEvidence = (record, state) => validateRefinementAssentEvidenceRecord(
  record,
  {
    neumaId: state.neumaId,
    ...state.context,
    issuedAt: state.issuance.issuedAt,
    subjectSha256: state.store.subjectSha256,
  },
);
const stateFor = async (owner, operation) => {
  const active = assertRefinementProcessOperation(operation);
  const state = OWNERS.get(owner);
  if (!state || state.operation !== active || state.phase !== 'open') {
    throw new Error('refinement assent evidence owner is unavailable');
  }
  const issuance = assertRefinementAssentIssuanceAuthority(state.issuanceAuthority, active);
  if (issuance.subjectAuthority !== state.issuance.subjectAuthority
    || issuance.ceremonyId !== state.issuance.ceremonyId
    || issuance.issuanceRevision !== state.issuance.issuanceRevision
    || issuance.requestNonceSha256 !== state.issuance.requestNonceSha256) {
    throw new Error('refinement assent issuance authority changed');
  }
  await assertRefinementAssentFactAuthority(state.factAuthority, active);
  active.assertActive();
  return state;
};
const currentCeremony = async (state, requireConsent = false) => {
  const current = await readCurrentRefinementCeremony({
    subjectAuthority: state.issuance.subjectAuthority,
    ceremonyId: state.context.ceremonyId,
    operation: state.operation,
  });
  if (current.state !== 'present' || current.record.neumaId !== state.neumaId) {
    throw refuse('Ceremony is unavailable to its sovereign subject.', 'CEREMONY_NOT_FOUND');
  }
  if (requireConsent && current.record.phase !== 'consent') {
    throw refuse(
      `Ceremony is in phase '${current.record.phase}' — assent belongs to consent.`,
      'WRONG_PHASE',
    );
  }
  return current;
};
const authoritativeEvidence = async (state, stored) => {
  const record = validateEvidence(stored, state);
  const session = await readAuthoritativeRefinementAssentSession(
    state.store, state.context, state.neumaId,
  );
  if (!session || session.sessionId !== record.sessionId
    || session.userAt !== record.userAt || session.responseAt !== record.responseAt
    || session.promptSha256 !== record.promptSha256
    || session.responseSha256 !== record.responseSha256
    || session.sessionRowsSha256 !== record.sessionRowsSha256
    || session.sessionSha256 !== record.sessionSha256
    || session.custodyIdentitySha256 !== refinementSha256(record.custody)
    || session.routeSha256 !== record.routeSha256
    || session.servingAuthoritySha256 !== record.servingAuthoritySha256) {
    throw new Error('authoritative assent session no longer matches its evidence');
  }
  const parsed = parseRefinementConsentDecision(session.reply);
  if (!refinementConsentDisclosureCommitsTo(session.disclosure, record)
    || parsed?.decision !== record.decision || parsed?.condition !== record.condition) {
    throw new Error('authoritative assent response no longer matches its evidence');
  }
  return Object.freeze({ record, disclosure: session.disclosure, quote: session.reply });
};
const issuanceProjection = (record) => Object.freeze({
  evidenceId: record.evidenceId,
  decision: record.decision,
  finishReason: record.finishReason,
  attempts: record.attempts,
});
const assertExpectedAuthority = (state, record) => assertCurrentRefinementAssentAuthority(
  state.factAuthority,
  {
    routeSha256: record.routeSha256,
    custodySha256: refinementSha256(record.custody),
    servingAuthoritySha256: record.servingAuthoritySha256,
  },
  state.operation,
);
const closeOwnerParts = async (state, primary = null) => {
  for (const [field, close, label] of [
    ['factClosed', () => closeRefinementAssentFactAuthority(
      state.factAuthority, state.operation,
    ), 'assent fact authority release'],
    ['storeClosed', () => state.storeOwner.close(), 'assent evidence store release'],
    ['refinementClosed', () => state.refinementOwner.close(), 'assent refinement root release'],
  ]) {
    if (state[field]) continue;
    try { await close(); state[field] = true; }
    catch (cleanup) { primary = combine(primary, cleanup, label); }
  }
  return primary;
};

/** Open one opaque issuance-bound evidence owner with held subject facts and private store. */
export const openRefinementAssentAuthority = async (issuanceAuthority, operation) => {
  const active = assertRefinementProcessOperation(operation);
  const issuance = assertRefinementAssentIssuanceAuthority(issuanceAuthority, active);
  let refinementOwner = null;
  let storeOwner = null;
  let factAuthority = null;
  let primary;
  try {
    refinementOwner = await openRefinementSubjectPinnedChild(issuance.subjectAuthority, {
      name: 'refinement', label: 'refinement assent private root', mode: 0o700,
      create: true, createMode: 0o700,
    }, active);
    storeOwner = await openPinnedDirectoryChild(refinementOwner, {
      name: 'assent-evidence', label: 'refinement assent evidence store', mode: 0o700,
      create: true, createMode: 0o700,
    });
    factAuthority = await openRefinementAssentFactAuthority(
      issuance.subjectAuthority, active,
    );
    const facts = await refinementAssentFactStandingAuthority(factAuthority, active);
    const subjectOps = refinementSubjectAuthorityOperations(
      issuance.subjectAuthority, active,
    );
    const store = Object.freeze({
      owner: storeOwner,
      operation: active,
      subjectSha256: facts.factAuthority.subjectSha256,
      encrypt: subjectOps.encrypt,
      decrypt: subjectOps.decrypt,
    });
    await inspectRefinementAssentEvidenceStore(store);
    const owner = Object.freeze({ kind: 'refinement-assent-evidence-owner-v2' });
    OWNERS.set(owner, {
      issuanceAuthority,
      issuance,
      context: contextFrom(issuance),
      operation: active,
      neumaId: facts.neumaId,
      factAuthority,
      refinementOwner,
      storeOwner,
      store,
      phase: 'open',
      factClosed: false,
      storeClosed: false,
      refinementClosed: false,
    });
    return owner;
  } catch (error) { primary = error; }
  const partial = {
    factAuthority, refinementOwner, storeOwner, operation: active,
    factClosed: !factAuthority, storeClosed: !storeOwner, refinementClosed: !refinementOwner,
  };
  primary = await closeOwnerParts(partial, primary);
  throw primary;
};

const issueEvidence = async (state, response, authority) => {
  const corpus = await corpusPreview(state.neumaId, { excerpts: 0 });
  if (!refinementConsentDisclosureCommitsTo(response.disclosure, corpus)) {
    throw refuse(
      'The proposed corpus changed during assent; carry the question again.',
      'ASSENT_CORPUS_CHANGED',
    );
  }
  const session = await persistRefinementAssentSession(state.store, state.context, {
    neumaId: state.neumaId,
    disclosure: response.disclosure,
    reply: response.reply,
    issuedAt: state.issuance.issuedAt,
    finishReason: response.finishReason,
    attempts: response.attempts,
    custodyIdentitySha256: authority.custodySha256,
    routeSha256: authority.routeSha256,
    servingAuthoritySha256: authority.servingAuthoritySha256,
  });
  await assertCurrentRefinementAssentAuthority(
    state.factAuthority, authority, state.operation,
  );
  await currentCeremony(state, true);
  const nonce = randomBytes(32).toString('hex');
  const base = {
    version: VERSION,
    nonce,
    neumaId: state.neumaId,
    ...state.context,
    sessionId: session.sessionId,
    issuedAt: state.issuance.issuedAt,
    userAt: session.userAt,
    responseAt: session.responseAt,
    finishReason: session.finishReason,
    attempts: session.attempts,
    decision: response.decision,
    condition: response.condition,
    promptSha256: session.promptSha256,
    responseSha256: session.responseSha256,
    sessionRowsSha256: session.sessionRowsSha256,
    sessionSha256: session.sessionSha256,
    sourceCorpusSha256: corpus.sourceCorpusSha256,
    sourceManifestSha256: corpus.sourceManifestSha256,
    sourceAuthoritySha256: corpus.sourceAuthoritySha256,
    ...refinementConsentPolicyAuthority(),
    ...refinementConsentDisclosurePolicyAuthority(),
    custody: authority.custody,
    route: authority.standing,
    routeSha256: authority.routeSha256,
    servingAuthority: authority.servingAuthority,
    servingAuthoritySha256: authority.servingAuthoritySha256,
  };
  const record = { ...base };
  record.evidenceSha256 = refinementSha256(refinementAssentEvidencePayload(record));
  record.evidenceId = refinementSha256({
    domain: 'neuma.refinement.assent-evidence-v2',
    subjectSha256: state.store.subjectSha256,
    issuanceRevision: record.issuanceRevision,
    requestNonceSha256: record.requestNonceSha256,
    nonce,
    evidenceSha256: record.evidenceSha256,
  });
  validateEvidence(record, state);
  const durable = await reserveRefinementAssentEvidence(
    state.store, state.context, record,
  );
  return (await authoritativeEvidence(state, durable)).record;
};

/** Ask once or recover the exact prior response, then reserve one opaque evidence id. */
export const askAndReserveRefinementAssentEvidence = async (owner, operation) => {
  const state = await stateFor(owner, operation);
  if (await readConsumedRefinementAssentEvidence(state.store, state.context)) {
    throw refuse('Assent evidence has already been consumed.', 'ASSENT_EVIDENCE_CONSUMED');
  }
  const reserved = await readReservedRefinementAssentEvidence(state.store, state.context);
  if (reserved) return issuanceProjection((await authoritativeEvidence(state, reserved)).record);
  const ceremony = await currentCeremony(state, true);
  const before = await resolveRefinementAssentRoute(state.factAuthority, state.operation);
  const recovered = await readAuthoritativeRefinementAssentSession(
    state.store, state.context, state.neumaId,
  );
  let response;
  if (recovered) {
    const parsed = parseRefinementConsentDecision(recovered.reply);
    if (!parsed) throw new Error('persisted assent response no longer closes a decision');
    response = Object.freeze({
      disclosure: recovered.disclosure,
      reply: recovered.reply,
      finishReason: recovered.finishReason,
      attempts: recovered.attempts,
      ...parsed,
    });
  } else {
    response = await askRefinementConsent({
      factAuthority: state.factAuthority,
      witness: ceremony.record.witness,
      ceremonyId: state.context.ceremonyId,
      operation: state.operation,
    });
  }
  const after = await assertCurrentRefinementAssentAuthority(
    state.factAuthority, before, state.operation,
  );
  return issuanceProjection(await issueEvidence(state, response, after));
};

/** Project the exact opaque locator owned by this issuance; never content or paths. */
export const assertRefinementAssentEvidenceLocator = async (owner, operation) => {
  const state = await stateFor(owner, operation);
  const reserved = await readReservedRefinementAssentEvidence(state.store, state.context);
  if (!reserved) throw new Error('refinement assent evidence reservation is unavailable');
  const record = (await authoritativeEvidence(state, reserved)).record;
  return Object.freeze({ evidenceId: record.evidenceId, evidenceSha256: record.evidenceSha256 });
};

/** Reverify source/route/session and derive one complete unstamped ceremony transition. */
export const prepareRefinementAssentEvidence = async (owner, operation) => {
  const state = await stateFor(owner, operation);
  if (await readConsumedRefinementAssentEvidence(state.store, state.context)) {
    throw refuse('Assent evidence has already been consumed.', 'ASSENT_EVIDENCE_CONSUMED');
  }
  const reserved = await readReservedRefinementAssentEvidence(state.store, state.context);
  if (!reserved) throw new Error('refinement assent evidence reservation is unavailable');
  const authoritative = await authoritativeEvidence(state, reserved);
  const current = await currentCeremony(state, true);
  const sources = await verifyRefinementCorpusSources(
    neumaWorkspace, state.neumaId, authoritative.record,
  );
  let advanced;
  let primary = null;
  try {
    await assertExpectedAuthority(state, authoritative.record);
    advanced = recordConsent(current.record, {
      decision: authoritative.record.decision,
      condition: authoritative.record.condition,
      operatorAcknowledged: true,
      quote: authoritative.quote,
      ...refinementAssentEvidenceReference(authoritative.record),
      at: new Date().toISOString(),
    });
  } catch (error) { primary = error; }
  try { await sources.close(); }
  catch (cleanup) { primary = combine(primary, cleanup, 'assent source authority release'); }
  if (primary) throw primary;
  const decision = refinementAssentDecisionProjection(authoritative.record);
  return Object.freeze({
    record: advanced,
    decision: decision.decision,
    transition: decision.transition,
    evidenceId: decision.evidenceId,
    evidenceSha256: decision.evidenceSha256,
    operatorDecisionSha256: decision.operatorDecisionSha256,
  });
};

const assertDurableDecision = (current, record, committed) => {
  const settled = record.decision === 'consent' ? current.record.consent
    : record.decision === 'decline' ? current.record.decline
      : current.record.conditionalAssent;
  const expectedPhase = record.decision === 'consent' ? 'corpus'
    : record.decision === 'decline' ? 'declined' : 'consent';
  if (current.record.phase !== expectedPhase || !settled
    || refinementSha256(settled.evidence)
      !== refinementSha256(refinementAssentEvidenceReference(record))
    || settled.authority?.assentEvidenceId !== record.evidenceId
    || settled.authority?.assentEvidenceSha256 !== record.evidenceSha256
    || (settled.condition || null) !== record.condition
    || current.recordSha256 !== committed.recordSha256
    || current.revision !== committed.revision
    || current.custodySha256 !== committed.custodySha256
    || current.record.transaction?.transition !== committed.transition) {
    throw new Error('durable ceremony decision does not match assent evidence');
  }
};

/** Authenticate a durable ceremony outcome, then atomically publish consumed provenance. */
export const consumeRefinementAssentDecision = async (
  owner,
  committedAuthority,
  operation,
) => {
  const state = await stateFor(owner, operation);
  const committed = assertCommittedRefinementCeremonyAuthority(
    committedAuthority, state.operation,
  );
  const consumed = await readConsumedRefinementAssentEvidence(state.store, state.context);
  const reserved = consumed || await readReservedRefinementAssentEvidence(
    state.store, state.context,
  );
  if (!reserved) throw new Error('refinement assent evidence reservation is unavailable');
  const record = (await authoritativeEvidence(state, reserved)).record;
  const expected = refinementAssentDecisionProjection(record, Boolean(consumed));
  if (committed.ceremonyId !== state.context.ceremonyId
    || committed.evidenceId !== expected.evidenceId
    || committed.evidenceSha256 !== expected.evidenceSha256
    || committed.decision !== expected.decision
    || committed.operatorDecisionSha256 !== expected.operatorDecisionSha256
    || committed.transition !== expected.transition) {
    throw new Error('committed ceremony authority belongs to another assent decision');
  }
  const current = await currentCeremony(state, false);
  assertDurableDecision(current, record, committed);
  if (!consumed) {
    await consumeReservedRefinementAssentEvidence(
      state.store, state.context, record.evidenceId,
    );
  }
  const durable = await readConsumedRefinementAssentEvidence(state.store, state.context);
  if (!durable || (await authoritativeEvidence(state, durable)).record.evidenceId
    !== record.evidenceId) {
    throw new Error('refinement assent evidence consumption is not durable');
  }
  return Object.freeze({
    evidenceId: record.evidenceId,
    evidenceSha256: record.evidenceSha256,
    consumed: true,
  });
};

/** Retryably release the private store and every held subject fact descriptor. */
export const closeRefinementAssentAuthority = async (owner, operation) => {
  const active = assertRefinementProcessOperation(operation);
  const state = OWNERS.get(owner);
  if (!state || state.operation !== active || state.phase === 'closed') {
    throw new Error('refinement assent evidence owner is invalid');
  }
  state.phase = 'closing';
  const primary = await closeOwnerParts(state);
  state.phase = primary ? 'cleanup-failed' : 'closed';
  if (primary) throw primary;
  return true;
};
