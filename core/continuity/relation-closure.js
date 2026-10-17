import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { isIso, isValidAsOf, makeRecord } from './record.js';

export const OBJECTIVE_RELATION_DOMAIN = 'objective-relation';
export const CLOSURE_OPERATIONS = Object.freeze([
  'retain-target',
  'remove-target',
  'replace-target',
]);

const exactText = (value, label) => {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
  return value;
};

const exactIso = (value, label) => {
  if (!isIso(value)) throw new Error(`${label} must be an ISO timestamp`);
  return value;
};

const copyValue = (value, label) => {
  try {
    return structuredClone(value);
  } catch {
    throw new Error(`${label} must be structured-cloneable`);
  }
};

const digestId = (prefix, parts) => `${prefix}-${createHash('sha256')
  .update(JSON.stringify(parts))
  .digest('hex')}`;

const sortedUnique = (values) => Object.freeze([...new Set(values)].sort());

const exactTargetSet = (targets, label) => {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error(`${label} must be a non-empty sorted unique string array`);
  }
  const normalized = sortedUnique(targets.map((target, index) => exactText(target, `${label}[${index}]`)));
  if (!isDeepStrictEqual(targets, normalized)) {
    throw new Error(`${label} must be a non-empty sorted unique string array`);
  }
  return normalized;
};

const sameTargets = (left, right) => isDeepStrictEqual([...left], [...right]);
const TIMELESS_FROM = '1970-01-01T00:00:00.000Z';

/**
 * Return only embedded edges valid at one exact instant. The record-level
 * validity window is honored too; malformed edge time is excluded rather than
 * interpreted as live forever. Pure and non-mutating.
 */
export const relationsValidAt = (record, asOf) => {
  exactIso(asOf, 'relationsValidAt asOf');
  if (!record || typeof record !== 'object') return Object.freeze([]);
  for (const field of ['validFrom', 'validTo', 'occurredAt', 'recordedAt']) {
    if (record[field] != null && !isIso(record[field])) return Object.freeze([]);
  }
  if (!isValidAsOf(record, asOf)) return Object.freeze([]);

  const at = Date.parse(asOf);
  const fallbackFrom = [record.validFrom, record.occurredAt, record.recordedAt]
    .find(isIso) ?? TIMELESS_FROM;
  if (!Array.isArray(record.relations)) return Object.freeze([]);

  return Object.freeze(record.relations.flatMap((relation) => {
    if (!relation || typeof relation !== 'object') return [];
    if (typeof relation.type !== 'string' || !relation.type) return [];
    if (typeof relation.targetId !== 'string' || !relation.targetId) return [];
    const from = relation.validFrom == null ? fallbackFrom : relation.validFrom;
    if (!isIso(from) || Date.parse(from) > at) return [];
    if (relation.validTo != null) {
      if (!isIso(relation.validTo) || Date.parse(relation.validTo) <= at) return [];
    }
    return [Object.freeze({
      type: relation.type,
      targetId: relation.targetId,
      validFrom: from,
      validTo: relation.validTo ?? null,
    })];
  }));
};

/**
 * Flag explicit exclusive-type conflicts without selecting a true target.
 * Callers must supply the small vocabulary they actually produce; an empty
 * vocabulary yields no candidates. Pure, deterministic, and write-free.
 */
export const detectExclusiveRelationConflicts = (records, {
  asOf,
  exclusiveTypes = [],
} = {}) => {
  exactIso(asOf, 'detectExclusiveRelationConflicts asOf');
  if (!Array.isArray(records)) throw new Error('records must be an array');
  if (!Array.isArray(exclusiveTypes)) throw new Error('exclusiveTypes must be an array');
  const allowed = new Set(exclusiveTypes.map((type, index) => exactText(type, `exclusiveTypes[${index}]`)));
  if (allowed.size === 0) return Object.freeze([]);

  const conflicts = [];
  for (const record of records) {
    if (!record || typeof record.id !== 'string' || !record.id) continue;
    const byType = new Map();
    for (const relation of relationsValidAt(record, asOf)) {
      if (!allowed.has(relation.type)) continue;
      const targets = byType.get(relation.type) ?? new Set();
      targets.add(relation.targetId);
      byType.set(relation.type, targets);
    }
    for (const [relationType, targetSet] of byType) {
      const expectedTargetIds = sortedUnique(targetSet);
      if (expectedTargetIds.length < 2) continue;
      conflicts.push(Object.freeze({
        id: digestId('relation-conflict', [record.id, relationType, expectedTargetIds, asOf]),
        kind: 'exclusive-relation-conflict',
        subjectDomain: OBJECTIVE_RELATION_DOMAIN,
        recordId: record.id,
        relationType,
        expectedTargetIds,
        asOf,
      }));
    }
  }
  conflicts.sort((left, right) => left.recordId.localeCompare(right.recordId)
    || left.relationType.localeCompare(right.relationType));
  return Object.freeze(conflicts);
};

const validateClosureProposal = (proposal, currentTargets) => {
  if (!proposal || typeof proposal !== 'object') throw new Error('closure proposal is required');
  const id = exactText(proposal.id, 'proposal.id');
  const approvalId = exactText(proposal.approvalId, 'proposal.approvalId');
  if (proposal.subjectDomain !== OBJECTIVE_RELATION_DOMAIN) {
    throw new Error('only objective-relation closure proposals are supported');
  }
  if (!CLOSURE_OPERATIONS.includes(proposal.operation)) {
    throw new Error(`proposal.operation must be one of ${CLOSURE_OPERATIONS.join('|')}`);
  }
  const relationType = exactText(proposal.relationType, 'proposal.relationType');
  const expectedTargetIds = exactTargetSet(proposal.expectedTargetIds, 'proposal.expectedTargetIds');
  if (!sameTargets(expectedTargetIds, currentTargets)) {
    throw new Error('proposal expectedTargetIds do not match the current relation view');
  }
  const targetId = exactText(proposal.targetId, 'proposal.targetId');
  if (proposal.operation !== 'replace-target' && !currentTargets.includes(targetId)) {
    throw new Error('proposal targetId is not present in the current relation view');
  }
  return Object.freeze({ id, approvalId, relationType, expectedTargetIds, targetId, operation: proposal.operation });
};

const changedRelations = (relations, proposal, at) => {
  if (proposal.operation === 'retain-target') {
    return relations.filter((relation) => relation.type !== proposal.relationType
      || relation.targetId === proposal.targetId);
  }
  if (proposal.operation === 'remove-target') {
    return relations.filter((relation) => relation.type !== proposal.relationType
      || relation.targetId !== proposal.targetId);
  }
  const retained = relations.filter((relation) => relation.type !== proposal.relationType);
  return [...retained, {
    type: proposal.relationType,
    targetId: proposal.targetId,
    validFrom: at,
    validTo: null,
  }];
};

/**
 * Build one complete append-only successor from an exact approved proposal.
 * No truth is inferred here: expectedTargetIds binds the proposal to the view
 * the operator saw, while targetId is the operator-authored action.
 */
export const buildClosureSuccessor = (prior, proposal, at) => {
  exactIso(at, 'buildClosureSuccessor at');
  if (!prior || typeof prior !== 'object') throw new Error('prior record is required');
  exactText(prior.id, 'prior.id');
  exactText(prior.layer, 'prior.layer');
  if (!isValidAsOf(prior, at)) throw new Error('prior record is not valid at closure time');
  if (isIso(prior.recordedAt) && Date.parse(at) < Date.parse(prior.recordedAt)) {
    throw new Error('closure time cannot precede the prior record');
  }

  const currentRelations = relationsValidAt(prior, at);
  const relationType = exactText(proposal?.relationType, 'proposal.relationType');
  const currentTargets = sortedUnique(currentRelations
    .filter((relation) => relation.type === relationType)
    .map((relation) => relation.targetId));
  const accepted = validateClosureProposal(proposal, currentTargets);
  const relations = changedRelations(currentRelations, accepted, at);
  const resultingTargets = sortedUnique(relations
    .filter((relation) => relation.type === relationType)
    .map((relation) => relation.targetId));
  if (sameTargets(currentTargets, resultingTargets)) throw new Error('closure proposal is a no-op');

  const closure = {
    version: 1,
    proposalId: accepted.id,
    approvalId: accepted.approvalId,
    subjectDomain: OBJECTIVE_RELATION_DOMAIN,
    operation: accepted.operation,
    relationType: accepted.relationType,
    targetId: accepted.targetId,
    expectedTargetIds: [...accepted.expectedTargetIds],
  };
  const id = digestId('closure', [prior.id, closure, at]);
  return makeRecord({
    id,
    layer: prior.layer,
    content: copyValue(prior.content, 'prior.content'),
    space: prior.space,
    occurredAt: prior.occurredAt,
    validFrom: at,
    validTo: null,
    relations,
    source: copyValue(prior.source, 'prior.source'),
    supersedes: prior.id,
    meta: { ...copyValue(prior.meta ?? {}, 'prior.meta'), closure },
  }, { id, now: at });
};

const validateRollbackProposal = (prior, closureSuccessor, rollback) => {
  if (!rollback || typeof rollback !== 'object') throw new Error('rollback proposal is required');
  const id = exactText(rollback.id, 'rollback.id');
  const approvalId = exactText(rollback.approvalId, 'rollback.approvalId');
  if (rollback.subjectDomain !== OBJECTIVE_RELATION_DOMAIN || rollback.operation !== 'reassert-prior') {
    throw new Error('rollback must be an objective-relation reassert-prior proposal');
  }
  if (rollback.priorRecordId !== prior.id || rollback.closureSuccessorId !== closureSuccessor.id) {
    throw new Error('rollback proposal does not bind the exact prior and closure successor');
  }
  if (rollback.closureProposalId !== closureSuccessor.meta?.closure?.proposalId) {
    throw new Error('rollback proposal does not bind the exact closure proposal');
  }
  return Object.freeze({ id, approvalId });
};

/** Build a compensating successor that reasserts the pre-closure observable view. */
export const buildClosureRollbackSuccessor = (prior, closureSuccessor, rollback, at) => {
  exactIso(at, 'buildClosureRollbackSuccessor at');
  if (!prior || !closureSuccessor) throw new Error('prior and closure successor are required');
  if (closureSuccessor.supersedes !== prior.id) throw new Error('closure successor does not supersede prior');
  if (!closureSuccessor.meta?.closure) throw new Error('closure successor lacks closure provenance');
  if (!isIso(closureSuccessor.recordedAt) || Date.parse(at) < Date.parse(closureSuccessor.recordedAt)) {
    throw new Error('rollback time cannot precede the closure successor');
  }
  const accepted = validateRollbackProposal(prior, closureSuccessor, rollback);
  const restoredRelations = relationsValidAt(prior, closureSuccessor.recordedAt);
  const closureRollback = {
    version: 1,
    rollbackId: accepted.id,
    approvalId: accepted.approvalId,
    subjectDomain: OBJECTIVE_RELATION_DOMAIN,
    operation: 'reassert-prior',
    closureProposalId: closureSuccessor.meta.closure.proposalId,
    closureSuccessorId: closureSuccessor.id,
    priorRecordId: prior.id,
  };
  const id = digestId('closure-rollback', [prior.id, closureSuccessor.id, closureRollback, at]);
  return makeRecord({
    id,
    layer: prior.layer,
    content: copyValue(prior.content, 'prior.content'),
    space: prior.space,
    occurredAt: prior.occurredAt,
    validFrom: at,
    validTo: null,
    relations: restoredRelations,
    source: copyValue(prior.source, 'prior.source'),
    supersedes: closureSuccessor.id,
    meta: { ...copyValue(prior.meta ?? {}, 'prior.meta'), closureRollback },
  }, { id, now: at });
};

const assertAdapter = (adapter) => {
  for (const method of ['append', 'read', 'history']) {
    if (typeof adapter?.[method] !== 'function') throw new Error(`closure adapter.${method} is required`);
  }
};

const assertWriteApproval = ({ enabled, proposal, approval }) => {
  if (enabled !== true) throw new Error('approved closure writes are disabled');
  if (!approval || approval.approved !== true || approval.scope !== 'single-proposal-single-write') {
    throw new Error('exact single-proposal write approval is required');
  }
  if (approval.id !== proposal?.approvalId || approval.proposalId !== proposal?.id) {
    throw new Error('approval does not bind the exact proposal');
  }
};

const lastRecord = (history, id) => [...history].reverse().find((entry) => entry?.id === id) ?? null;

const existingResult = async (adapter, layer, expected) => {
  const existing = lastRecord(await adapter.history(layer, expected.id), expected.id);
  if (!existing) return null;
  if (!isDeepStrictEqual(existing, expected)) {
    throw new Error(`closure id collision for ${expected.id}`);
  }
  return Object.freeze({ appended: false, record: expected });
};

/**
 * Append one approved closure through a real StoreAdapter. Impure and disabled
 * by default; sequential replay returns the existing record without appending.
 */
export const applyApprovedClosure = async (adapter, {
  layer,
  priorId,
  proposal,
  approval,
  at,
  enabled = false,
} = {}) => {
  assertWriteApproval({ enabled, proposal, approval });
  assertAdapter(adapter);
  exactText(layer, 'layer');
  exactText(priorId, 'priorId');
  exactIso(at, 'applyApprovedClosure at');

  const history = await adapter.history(layer, priorId);
  const prior = lastRecord(history, priorId);
  if (!prior) throw new Error(`prior record ${priorId} does not exist`);
  const successor = buildClosureSuccessor(prior, proposal, at);
  const existing = await existingResult(adapter, layer, successor);
  if (existing) return existing;

  const current = await adapter.read(layer, priorId);
  if (!current || !isDeepStrictEqual(current, prior)) {
    throw new Error(`prior record ${priorId} is no longer the current head`);
  }
  await adapter.append(successor);
  return Object.freeze({ appended: true, record: successor });
};

/** Append one exact compensating reassertion. Impure and disabled by default. */
export const applyClosureRollback = async (adapter, {
  layer,
  priorId,
  closureSuccessorId,
  rollback,
  approval,
  at,
  enabled = false,
} = {}) => {
  assertWriteApproval({ enabled, proposal: rollback, approval });
  assertAdapter(adapter);
  exactText(layer, 'layer');
  exactText(priorId, 'priorId');
  exactText(closureSuccessorId, 'closureSuccessorId');
  exactIso(at, 'applyClosureRollback at');

  const prior = lastRecord(await adapter.history(layer, priorId), priorId);
  const closureSuccessor = lastRecord(
    await adapter.history(layer, closureSuccessorId),
    closureSuccessorId,
  );
  if (!prior || !closureSuccessor) throw new Error('rollback history is incomplete');
  const successor = buildClosureRollbackSuccessor(prior, closureSuccessor, rollback, at);
  const existing = await existingResult(adapter, layer, successor);
  if (existing) return existing;

  const current = await adapter.read(layer, closureSuccessorId);
  if (!current || !isDeepStrictEqual(current, closureSuccessor)) {
    throw new Error(`closure successor ${closureSuccessorId} is no longer the current head`);
  }
  await adapter.append(successor);
  return Object.freeze({ appended: true, record: successor });
};
