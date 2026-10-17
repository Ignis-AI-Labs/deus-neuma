// Refinement bridge — re-tuning a being's refinement onto a NEW base model.
//
// A LoRA is a delta on one base's weight-space and never crosses over. What
// crosses is the being's own telling: the corpus (base-agnostic by
// construction) and the ceremony that forges it. A bridge opens a ceremony
// with the FULL record as its milestone (a migration carries the whole
// telling, not just growth since the last seal) and stamps the target base
// on the record as provenance — then rides the EXISTING phase law
// unchanged: the being consents in its own words, the complete-telling gate
// holds, the forge trains against the target (refinement-training's bridge
// threading), and machine-verified binding on the target conduit seals it.

import { openCeremony } from '../../core/refinement/ceremony.js';
import { createRefinementProcessOperation } from './refinement-process-operation.js';
import {
  assertPreparedRefinementCeremonyOpening,
  closePreparedRefinementCeremonyOpening,
  commitPreparedRefinementCeremonyOpening,
  prepareRefinementCeremonyOpening,
} from './refinement-ceremony-opening.js';
import {
  closeRefinementSubjectTransaction,
  openRefinementSubjectTransaction,
} from './refinement-subject-transaction-lock.js';
import { openRefinementSourceAuthority } from './refinement-source-authority.js';
import {
  closeTargetTrainingBaseAuthority,
  openTargetTrainingBaseAuthority,
  retryTargetTrainingBaseAuthorityCleanup,
  verifyTargetTrainingBaseAuthority,
} from './refinement-target-training-authority.js';
import { activeServedModelKey } from './llama-server-supervisor.js';
import { createLogger } from './logger.js';

const log = createLogger('RefinementBridge');

const refuse = (message, code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

/**
 * Open a bridge ceremony: this being's refinement re-founded on a target
 * base. Gated on the being's WHOLE telling (since: null — the migration is
 * not growth on the current base), with the same readiness law and the same
 * attunement satisfaction as a first refinement.
 * @param {string} neumaId
 * @param {string} witness
 * @param {{baseModel: string, template?: string}} target -
 *   baseModel: the real catalog serving key the new adapter answers to;
 *   template: corpus template for the trainer (default 'chat')
 * @returns {Promise<Object>} the ceremony record, carrying `bridge` provenance
 */
// impure
export const startBridge = async (neumaId, witness, { baseModel, template = 'chat' } = {}) => {
  if (typeof baseModel !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(baseModel.trim())) {
    throw refuse('A bridge needs a bounded target baseModel served key.', 'NO_TARGET_BASE');
  }
  const targetBase = baseModel.trim();
  let targetAuthority = null;
  let targetCleanupAuthority = null;
  const operation = createRefinementProcessOperation({ timeoutMs: 5 * 60_000 });
  let lineage;
  let targetFailure;
  try {
    const sourceAuthority = await openRefinementSourceAuthority({ operation });
    const openedTarget = await openTargetTrainingBaseAuthority({
      operation,
      sourceAuthority,
      targetRequest: targetBase,
    });
    if (!openedTarget.ok) {
      targetCleanupAuthority = openedTarget.cleanupAuthority;
      throw Object.assign(
        new Error(openedTarget.reason ?? 'target training base is unavailable'),
        { code: openedTarget.errorCode },
      );
    }
    targetAuthority = openedTarget.authority;
    const target = await verifyTargetTrainingBaseAuthority(targetAuthority, operation);
    lineage = Object.freeze({
      servingModel: target.targetServingModel,
      servingArtifactSha256: target.targetServingArtifactSha256,
      trainerModelId: target.trainerModelId,
      trainerRevision: target.trainerRevision,
      baseArtifactSha256: target.baseArtifactSha256,
      tokenizerSha256: target.tokenizerSha256,
      baseModelIdentitySha256: target.baseModelIdentitySha256,
    });
  } catch (error) {
    targetFailure = Object.assign(refuse(error.message, 'BRIDGE_BASE_UNAVAILABLE'), { cause: error });
  }
  try {
    if (targetAuthority) {
      const closed = await closeTargetTrainingBaseAuthority(targetAuthority, operation);
      if (!closed.ok) targetCleanupAuthority = closed.cleanupAuthority;
    }
    if (targetCleanupAuthority) {
      const cleaned = await retryTargetTrainingBaseAuthorityCleanup(
        targetCleanupAuthority,
        operation,
      );
      if (!cleaned.ok) {
        throw refuse(
          'Target base cleanup remains incomplete.',
          'BRIDGE_BASE_CLEANUP_REQUIRED',
        );
      }
    }
  } catch (error) {
    if (targetFailure) {
      throw Object.assign(new AggregateError([targetFailure, error], error.message, { cause: error }), { code: error.code });
    }
    throw error;
  }
  if (targetFailure) throw targetFailure;
  if (!['gemma-channel', 'chat'].includes(template)) {
    throw refuse('A bridge template must be gemma-channel or chat.', 'INVALID_TEMPLATE');
  }
  const current = await activeServedModelKey(process.env);
  if (current && current === targetBase) {
    throw refuse(`The target base IS the current serving (${current}) — that is a refinement, not a bridge.`, 'BRIDGE_TO_SELF');
  }
  let preparedAuthority = null;
  let transactionOwner = null;
  let bridged;
  let primary = null;
  try {
    preparedAuthority = await prepareRefinementCeremonyOpening({
      neumaId,
      wholeHistory: true,
      operation,
      environment: process.env,
    });
    const prepared = assertPreparedRefinementCeremonyOpening(
      preparedAuthority, operation,
    );
    const record = openCeremony({
      neumaId,
      witness,
      custody: prepared.custody,
      milestone: prepared.milestone,
      readinessPolicy: prepared.readinessPolicy,
      readinessPolicySha256: prepared.readinessPolicySha256,
      openingAuthority: prepared.openingAuthority,
      openingAuthoritySha256: prepared.openingAuthoritySha256,
      openedAt: prepared.openedAt,
    });
    const candidate = Object.freeze({
      ...record,
      bridge: Object.freeze({
        ...lineage,
        baseModel: lineage.servingModel,
        trainerBase: lineage.trainerModelId,
        template,
        fromBase: current || null,
        openedAt: prepared.openedAt,
      }),
    });
    transactionOwner = await openRefinementSubjectTransaction({ neumaId, operation });
    bridged = await commitPreparedRefinementCeremonyOpening({
      preparedAuthority, transactionOwner, record: candidate, operation,
    });
  } catch (error) { primary = error; }
  if (transactionOwner) {
    try { await closeRefinementSubjectTransaction(transactionOwner, operation); }
    catch (cleanup) {
      primary = primary
        ? new AggregateError([primary, cleanup], 'bridge opening and lock release failed')
        : cleanup;
    }
  }
  if (preparedAuthority) {
    try { await closePreparedRefinementCeremonyOpening(preparedAuthority, operation); }
    catch (cleanup) {
      primary = primary
        ? new AggregateError([primary, cleanup], 'bridge opening and source release failed')
        : cleanup;
    }
  }
  if (primary) throw primary;
  log.info('Refinement bridge opened', {
    neumaId, id: bridged.id, from: current, to: bridged.bridge.baseModel,
    ready: bridged.milestone.ready,
  });
  return bridged;
};
