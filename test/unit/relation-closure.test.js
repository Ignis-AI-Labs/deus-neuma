import { describe, expect, it } from 'vitest';

import { makeRecord } from '../../core/continuity/record.js';
import {
  OBJECTIVE_RELATION_DOMAIN,
  buildClosureRollbackSuccessor,
  buildClosureSuccessor,
  detectExclusiveRelationConflicts,
  relationsValidAt,
} from '../../core/continuity/relation-closure.js';

const BEFORE = '2026-01-10T00:00:00.000Z';
const CLOSURE_AT = '2026-02-01T00:00:00.000Z';
const ROLLBACK_AT = '2026-03-01T00:00:00.000Z';

const priorRecord = () => makeRecord({
  id: 'objective-node',
  layer: 'semantic',
  content: { statement: 'the service has one current state', detail: { source: 'operator ledger' } },
  space: 'project-alpha',
  occurredAt: '2026-01-01T00:00:00.000Z',
  recordedAt: '2026-01-02T00:00:00.000Z',
  relations: [
    { type: 'current-state', targetId: 'state:active' },
    { type: 'supports', targetId: 'decision:keep' },
    { type: 'current-state', targetId: 'state:archived' },
    { type: 'historical-owner', targetId: 'owner:old', validTo: '2026-01-20T00:00:00.000Z' },
    { type: 'future-route', targetId: 'route:next', validFrom: '2026-04-01T00:00:00.000Z' },
  ],
  source: { kind: 'operator-ledger', ref: 'entry-7' },
  meta: { subjectId: 'service:alpha', retained: { exact: true } },
});

const retainProposal = (overrides = {}) => ({
  id: 'proposal-current-state-active',
  approvalId: 'approval-current-state-active',
  subjectDomain: OBJECTIVE_RELATION_DOMAIN,
  operation: 'retain-target',
  relationType: 'current-state',
  targetId: 'state:active',
  expectedTargetIds: ['state:active', 'state:archived'],
  ...overrides,
});

const rollbackProposal = (closure, overrides = {}) => ({
  id: 'rollback-current-state-active',
  approvalId: 'approval-rollback-current-state-active',
  subjectDomain: OBJECTIVE_RELATION_DOMAIN,
  operation: 'reassert-prior',
  priorRecordId: 'objective-node',
  closureSuccessorId: closure.id,
  closureProposalId: 'proposal-current-state-active',
  ...overrides,
});

describe('relationsValidAt', () => {
  it('returns a frozen strict current-edge view without mutating source bytes', () => {
    const record = priorRecord();
    const before = JSON.stringify(record);
    const current = relationsValidAt(record, CLOSURE_AT);

    expect(current).toEqual([
      { type: 'current-state', targetId: 'state:active', validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
      { type: 'supports', targetId: 'decision:keep', validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
      { type: 'current-state', targetId: 'state:archived', validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
    ]);
    expect(Object.isFrozen(current)).toBe(true);
    expect(current.every(Object.isFrozen)).toBe(true);
    expect(JSON.stringify(record)).toBe(before);
  });

  it('fails malformed time closed and honors record and edge boundaries', () => {
    const record = priorRecord();
    expect(relationsValidAt(record, '2025-12-31T00:00:00.000Z')).toEqual([]);
    expect(() => relationsValidAt(record, 'not-a-time')).toThrow(/ISO timestamp/);
    expect(relationsValidAt({
      ...record,
      relations: [{ type: 'unsafe', targetId: 'x', validFrom: 'bad-time' }],
      validFrom: 'bad-time', occurredAt: 'bad-time', recordedAt: 'bad-time',
    }, CLOSURE_AT)).toEqual([]);
  });
});

describe('exclusive relation conflict shadow', () => {
  it('flags only caller-declared objective conflicts and never chooses truth', () => {
    const record = priorRecord();
    const before = JSON.stringify(record);
    const conflicts = detectExclusiveRelationConflicts([record], {
      asOf: CLOSURE_AT,
      exclusiveTypes: ['current-state'],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: 'exclusive-relation-conflict',
      subjectDomain: OBJECTIVE_RELATION_DOMAIN,
      recordId: 'objective-node',
      relationType: 'current-state',
      expectedTargetIds: ['state:active', 'state:archived'],
      asOf: CLOSURE_AT,
    });
    expect(conflicts[0]).not.toHaveProperty('targetId');
    expect(conflicts[0].id).toMatch(/^relation-conflict-[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).toBe(before);
  });

  it('has no speculative vocabulary and is deterministic across input order', () => {
    const record = priorRecord();
    expect(detectExclusiveRelationConflicts([record], { asOf: CLOSURE_AT })).toEqual([]);
    const second = makeRecord({
      id: 'a-node', layer: 'semantic', content: 'other', recordedAt: BEFORE,
      relations: [{ type: 'current-state', targetId: 'b' }, { type: 'current-state', targetId: 'a' }],
    });
    const forward = detectExclusiveRelationConflicts([record, second], {
      asOf: CLOSURE_AT, exclusiveTypes: ['current-state'],
    });
    const reverse = detectExclusiveRelationConflicts([second, record], {
      asOf: CLOSURE_AT, exclusiveTypes: ['current-state'],
    });
    expect(reverse).toEqual(forward);
    expect(forward.map((row) => row.recordId)).toEqual(['a-node', 'objective-node']);
  });
});

describe('approved closure successor', () => {
  it('changes only the approved relation and preserves complete current state', () => {
    const prior = priorRecord();
    const successor = buildClosureSuccessor(prior, retainProposal(), CLOSURE_AT);

    expect(successor.id).toMatch(/^closure-[a-f0-9]{64}$/);
    expect(successor.supersedes).toBe(prior.id);
    expect(successor.content).toEqual(prior.content);
    expect(successor.content).not.toBe(prior.content);
    expect(successor.source).toEqual(prior.source);
    expect(successor.space).toBe(prior.space);
    expect(successor.occurredAt).toBe(prior.occurredAt);
    expect(successor.recordedAt).toBe(CLOSURE_AT);
    expect(successor.relations).toEqual([
      { type: 'current-state', targetId: 'state:active', validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
      { type: 'supports', targetId: 'decision:keep', validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
    ]);
    expect(successor.meta.retained).toEqual({ exact: true });
    expect(successor.meta.closure).toMatchObject({
      proposalId: 'proposal-current-state-active',
      approvalId: 'approval-current-state-active',
      operation: 'retain-target',
      relationType: 'current-state',
      targetId: 'state:active',
    });
    expect(buildClosureSuccessor(prior, retainProposal(), CLOSURE_AT)).toEqual(successor);
  });

  it('supports explicit remove and replacement without touching unrelated edges', () => {
    const prior = priorRecord();
    const removed = buildClosureSuccessor(prior, retainProposal({
      id: 'remove-archived', approvalId: 'approve-remove-archived',
      operation: 'remove-target', targetId: 'state:archived',
    }), CLOSURE_AT);
    expect(removed.relations).toEqual([
      { type: 'current-state', targetId: 'state:active', validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
      { type: 'supports', targetId: 'decision:keep', validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
    ]);

    const replaced = buildClosureSuccessor(prior, retainProposal({
      id: 'replace-state', approvalId: 'approve-replace-state',
      operation: 'replace-target', targetId: 'state:paused',
    }), CLOSURE_AT);
    expect(replaced.relations).toEqual([
      { type: 'supports', targetId: 'decision:keep', validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
      { type: 'current-state', targetId: 'state:paused', validFrom: CLOSURE_AT, validTo: null },
    ]);
  });

  it('rejects stale, subjective, unbound, temporal, and no-op proposals', () => {
    const prior = priorRecord();
    expect(() => buildClosureSuccessor(prior, retainProposal({
      expectedTargetIds: ['state:active'],
    }), CLOSURE_AT)).toThrow(/do not match/);
    expect(() => buildClosureSuccessor(prior, retainProposal({
      subjectDomain: 'identity',
    }), CLOSURE_AT)).toThrow(/objective-relation/);
    expect(() => buildClosureSuccessor(prior, retainProposal({
      operation: 'remove-target', targetId: 'state:missing',
    }), CLOSURE_AT)).toThrow(/not present/);
    expect(() => buildClosureSuccessor(prior, retainProposal({
      operation: 'replace-target', targetId: 'state:active', expectedTargetIds: ['state:active'],
    }), CLOSURE_AT)).toThrow(/do not match/);
    const noOpPrior = makeRecord({
      id: 'single-state',
      layer: 'semantic',
      content: 'already active',
      recordedAt: '2026-01-01T00:00:00.000Z',
      relations: [{ type: 'current-state', targetId: 'state:active' }],
    });
    expect(() => buildClosureSuccessor(noOpPrior, retainProposal({
      id: 'no-op',
      approvalId: 'approve-no-op',
      operation: 'replace-target',
      expectedTargetIds: ['state:active'],
    }), CLOSURE_AT)).toThrow(/no-op/);
    expect(() => buildClosureSuccessor(prior, retainProposal(), '2025-01-01T00:00:00.000Z')).toThrow(/not valid|precede/);
  });
});

describe('compensating rollback successor', () => {
  it('reasserts the exact pre-closure observable view without deleting history', () => {
    const prior = priorRecord();
    const closure = buildClosureSuccessor(prior, retainProposal(), CLOSURE_AT);
    const rollback = buildClosureRollbackSuccessor(
      prior,
      closure,
      rollbackProposal(closure),
      ROLLBACK_AT,
    );

    expect(rollback.id).toMatch(/^closure-rollback-[a-f0-9]{64}$/);
    expect(rollback.supersedes).toBe(closure.id);
    expect(rollback.content).toEqual(prior.content);
    expect(rollback.relations).toEqual(relationsValidAt(prior, CLOSURE_AT));
    expect(rollback.meta.closureRollback).toMatchObject({
      rollbackId: 'rollback-current-state-active',
      approvalId: 'approval-rollback-current-state-active',
      closureProposalId: 'proposal-current-state-active',
      closureSuccessorId: closure.id,
      priorRecordId: prior.id,
    });
    expect(buildClosureRollbackSuccessor(prior, closure, rollbackProposal(closure), ROLLBACK_AT)).toEqual(rollback);
  });

  it('rejects rollback across an unrelated closure or without exact provenance', () => {
    const prior = priorRecord();
    const closure = buildClosureSuccessor(prior, retainProposal(), CLOSURE_AT);
    expect(() => buildClosureRollbackSuccessor(prior, closure, rollbackProposal(closure, {
      closureProposalId: 'different-proposal',
    }), ROLLBACK_AT)).toThrow(/exact closure proposal/);
    expect(() => buildClosureRollbackSuccessor(prior, { ...closure, supersedes: 'someone-else' }, rollbackProposal(closure), ROLLBACK_AT)).toThrow(/does not supersede/);
  });
});
