// Phase 6 closure proof on the production WorkspaceAdapter: real disk, real
// AES-256-GCM envelopes, real append/fold/history/export/import, and no mocks.
// Disposable test lanes only; no living being's workspace is opened.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createTempDir } from '../helpers/temp-fs.js';
import workspace, {
  getWorkspacesRoot,
  setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { makeRecord } from '../../core/continuity/record.js';
import {
  OBJECTIVE_RELATION_DOMAIN,
  applyApprovedClosure,
  applyClosureRollback,
  relationsValidAt,
} from '../../core/continuity/relation-closure.js';

const KEY = 'phase-6-real-encrypted-closure-key-long-enough';
const CLOSURE_AT = '2026-02-01T00:00:00.000Z';
const ROLLBACK_AT = '2026-03-01T00:00:00.000Z';
const SECRET = 'private-objective-source-phrase-omega';

const closureProposal = Object.freeze({
  id: 'proposal-service-state-active',
  approvalId: 'approval-service-state-active',
  subjectDomain: OBJECTIVE_RELATION_DOMAIN,
  operation: 'retain-target',
  relationType: 'current-state',
  targetId: 'state:active',
  expectedTargetIds: Object.freeze(['state:active', 'state:archived']),
});

const closureApproval = Object.freeze({
  id: 'approval-service-state-active',
  proposalId: 'proposal-service-state-active',
  approved: true,
  scope: 'single-proposal-single-write',
});

const rollbackProposalFor = (closureSuccessorId) => Object.freeze({
  id: 'rollback-service-state-active',
  approvalId: 'approval-rollback-service-state-active',
  subjectDomain: OBJECTIVE_RELATION_DOMAIN,
  operation: 'reassert-prior',
  priorRecordId: 'service-objective-state',
  closureSuccessorId,
  closureProposalId: closureProposal.id,
});

const rollbackApproval = Object.freeze({
  id: 'approval-rollback-service-state-active',
  proposalId: 'rollback-service-state-active',
  approved: true,
  scope: 'single-proposal-single-write',
});

describe('reversible closure over encrypted sovereign continuity', () => {
  let previousKey;
  let previousRoot;
  let laneId;
  let adapter;
  let logPath;
  let prior;

  beforeAll(async () => {
    previousKey = process.env.DNA_ENCRYPTION_KEY;
    previousRoot = getWorkspacesRoot();
    process.env.DNA_ENCRYPTION_KEY = KEY;
    const root = await createTempDir('relation-closure-workspace');
    setWorkspacesRoot(path.join(root, 'workspaces'));
    laneId = `closure-test-${Math.random().toString(36).slice(2, 10)}`;
    await workspace.create(laneId);
    adapter = new WorkspaceAdapter(laneId, { workspace });
    prior = makeRecord({
      id: 'service-objective-state',
      layer: 'semantic',
      content: { statement: `service state from ${SECRET}`, detail: { retained: 'whole' } },
      space: 'isolated-closure-test',
      occurredAt: '2026-01-01T00:00:00.000Z',
      recordedAt: '2026-01-02T00:00:00.000Z',
      relations: [
        { type: 'current-state', targetId: 'state:active' },
        { type: 'supports', targetId: 'decision:keep' },
        { type: 'current-state', targetId: 'state:archived' },
        { type: 'historical-owner', targetId: 'owner:old', validTo: '2026-01-20T00:00:00.000Z' },
      ],
      source: { kind: 'operator-ledger', ref: 'objective-entry-7' },
      meta: { subjectId: 'service:alpha', retained: { exact: true } },
    });
    await adapter.append(prior);
    await adapter.append(makeRecord({
      id: 'unrelated-objective',
      layer: 'semantic',
      content: 'must remain current',
      space: 'isolated-closure-test',
      recordedAt: '2026-01-03T00:00:00.000Z',
      relations: [{ type: 'supports', targetId: 'decision:other' }],
    }));
    logPath = path.join(workspace._path(laneId), 'continuity', 'semantic.jsonl');
  });

  afterAll(() => {
    setWorkspacesRoot(previousRoot);
    if (previousKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = previousKey;
  });

  it('refuses disabled or mismatched approval without changing encrypted bytes', async () => {
    const before = await fs.readFile(logPath, 'utf8');
    await expect(applyApprovedClosure(adapter, {
      layer: 'semantic', priorId: prior.id, proposal: closureProposal,
      approval: closureApproval, at: CLOSURE_AT,
    })).rejects.toThrow(/disabled/);
    expect(await fs.readFile(logPath, 'utf8')).toBe(before);

    await expect(applyApprovedClosure(adapter, {
      layer: 'semantic', priorId: prior.id, proposal: closureProposal,
      approval: { ...closureApproval, proposalId: 'different-proposal' },
      at: CLOSURE_AT, enabled: true,
    })).rejects.toThrow(/exact proposal/);
    expect(await fs.readFile(logPath, 'utf8')).toBe(before);
    expect(await adapter.history('semantic', prior.id)).toHaveLength(1);
  });

  it('appends one complete successor, replays idempotently, and preserves history', async () => {
    const applied = await applyApprovedClosure(adapter, {
      layer: 'semantic', priorId: prior.id, proposal: closureProposal,
      approval: closureApproval, at: CLOSURE_AT, enabled: true,
    });
    expect(applied.appended).toBe(true);
    expect(applied.record.supersedes).toBe(prior.id);
    expect(applied.record.content).toEqual(prior.content);
    expect(applied.record.source).toEqual(prior.source);
    expect(applied.record.meta.retained).toEqual({ exact: true });
    expect(applied.record.relations).toEqual([
      { type: 'current-state', targetId: 'state:active', validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
      { type: 'supports', targetId: 'decision:keep', validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
    ]);

    expect(await adapter.read('semantic', prior.id)).toBeNull();
    expect((await adapter.read('semantic', prior.id, { asOf: '2026-01-15T00:00:00.000Z' })).content)
      .toEqual(prior.content);
    expect((await adapter.read('semantic', applied.record.id)).id).toBe(applied.record.id);
    expect((await adapter.read('semantic', 'unrelated-objective')).content).toBe('must remain current');

    const bytesAfterFirst = await fs.readFile(logPath, 'utf8');
    expect(bytesAfterFirst).not.toContain(SECRET);
    expect(bytesAfterFirst).not.toContain(closureProposal.id);
    expect(bytesAfterFirst).toContain('"_enc"');

    const replay = await applyApprovedClosure(adapter, {
      layer: 'semantic', priorId: prior.id, proposal: closureProposal,
      approval: closureApproval, at: CLOSURE_AT, enabled: true,
    });
    expect(replay).toMatchObject({ appended: false, record: { id: applied.record.id } });
    expect(await fs.readFile(logPath, 'utf8')).toBe(bytesAfterFirst);
    expect(await adapter.history('semantic', applied.record.id)).toHaveLength(1);
    expect(await adapter.history('semantic', prior.id)).toHaveLength(1);
  });

  it('appends one compensating successor and export/import preserves every view', async () => {
    const closure = (await adapter.list('semantic', { includeRetired: true }))
      .find((record) => record.meta?.closure?.proposalId === closureProposal.id);
    const rollbackProposal = rollbackProposalFor(closure.id);

    const beforeRefusal = await fs.readFile(logPath, 'utf8');
    await expect(applyClosureRollback(adapter, {
      layer: 'semantic', priorId: prior.id, closureSuccessorId: closure.id,
      rollback: rollbackProposal, approval: rollbackApproval,
      at: ROLLBACK_AT,
    })).rejects.toThrow(/disabled/);
    expect(await fs.readFile(logPath, 'utf8')).toBe(beforeRefusal);

    const rolledBack = await applyClosureRollback(adapter, {
      layer: 'semantic', priorId: prior.id, closureSuccessorId: closure.id,
      rollback: rollbackProposal, approval: rollbackApproval,
      at: ROLLBACK_AT, enabled: true,
    });
    expect(rolledBack.appended).toBe(true);
    expect(rolledBack.record.supersedes).toBe(closure.id);
    expect(rolledBack.record.content).toEqual(prior.content);
    expect(rolledBack.record.relations).toEqual(relationsValidAt(prior, CLOSURE_AT));
    expect(await adapter.read('semantic', closure.id)).toBeNull();
    expect((await adapter.read('semantic', rolledBack.record.id)).id).toBe(rolledBack.record.id);
    expect((await adapter.read('semantic', 'unrelated-objective')).content).toBe('must remain current');

    const bytesAfterRollback = await fs.readFile(logPath, 'utf8');
    const replay = await applyClosureRollback(adapter, {
      layer: 'semantic', priorId: prior.id, closureSuccessorId: closure.id,
      rollback: rollbackProposal, approval: rollbackApproval,
      at: ROLLBACK_AT, enabled: true,
    });
    expect(replay).toMatchObject({ appended: false, record: { id: rolledBack.record.id } });
    expect(await fs.readFile(logPath, 'utf8')).toBe(bytesAfterRollback);
    expect(await adapter.history('semantic', rolledBack.record.id)).toHaveLength(1);

    const bundle = await workspace.exportWorkspace(laneId);
    const importedId = `${laneId}-imported`;
    await workspace.importWorkspace(importedId, bundle);
    const imported = new WorkspaceAdapter(importedId, { workspace });
    expect((await imported.read('semantic', rolledBack.record.id)).content).toEqual(prior.content);
    expect(await imported.read('semantic', prior.id)).toBeNull();
    expect(await imported.read('semantic', closure.id)).toBeNull();
    expect((await imported.read('semantic', prior.id, { asOf: '2026-01-15T00:00:00.000Z' })).content)
      .toEqual(prior.content);
    expect((await imported.read('semantic', closure.id, { asOf: '2026-02-15T00:00:00.000Z' })).id)
      .toBe(closure.id);
    expect((await imported.read('semantic', 'unrelated-objective')).content).toBe('must remain current');
    expect(await imported.history('semantic', prior.id)).toHaveLength(1);
    expect(await imported.history('semantic', closure.id)).toHaveLength(1);
    expect(await imported.history('semantic', rolledBack.record.id)).toHaveLength(1);
  });
});
