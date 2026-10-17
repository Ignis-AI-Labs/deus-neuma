// Gnosis for the operator training-launch transaction. Everything here is real:
// a real temp workspace root, a real per-neuma DEK, real AES-GCM envelopes on
// real disk, the real subject lock, the real approval store, the real ceremony
// transaction, and the real immutable decision grammar. No mock, stub, fake, or
// spy anywhere in the path being claimed (RULE 0).

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import workspace, {
  getWorkspacesRoot,
  setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { resetWorkspaceCryptoKey } from '../../core/workspace/workspace-crypto.js';
import { refinementHistorySha256 } from '../../core/workspace/refinement-history-reader.js';
import { refinementCustodyIdentity } from '../../core/refinement/training-authority-contract.js';
import {
  refinementApprovedScales,
  refinementSha256,
} from '../../core/refinement/training-contract.js';
import { recordTrainingFailure } from '../../core/refinement/ceremony.js';
import { refinementTrainingPlanAuthority } from '../../core/refinement/training-plan-decision.js';
import { createRefinementProcessOperation } from '../../backend/services/refinement-process-operation.js';
import {
  assertRefinementSubjectTransaction,
  closeRefinementSubjectTransaction,
  openRefinementSubjectTransaction,
} from '../../backend/services/refinement-subject-transaction-lock.js';
import {
  readCurrentRefinementCeremony,
  readCurrentRefinementCustody,
} from '../../backend/services/refinement-subject-history.js';
import {
  assertRefinementCeremonyTransaction,
  closeRefinementCeremonyTransaction,
  commitPreparedRefinementCeremonyTransition,
  openRefinementCeremonyTransaction,
  prepareRefinementCeremonyTransition,
} from '../../backend/services/refinement-ceremony-transaction.js';
import {
  assertRefinementTrainingApprovalState,
  closeRefinementTrainingApprovalState,
  commitRefinementTrainingApprovalState,
  openRefinementTrainingApprovalState,
} from '../../backend/services/refinement-training-approval-store.js';
import {
  assertRefinementTrainingLaunchAuthority,
  closeRefinementTrainingLaunchAuthority,
  consumeRefinementTrainingApproval,
  issueRefinementTrainingApproval,
} from '../../backend/services/refinement-training-launch-transaction.js';

const WITNESS = '0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a';
const FOREIGN_WITNESS = '0x6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b';
const STORE_OWNED = Object.freeze([
  'ceremonyKeySha256', 'priorStateSha256', 'revision', 'schemaVersion',
]);
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TTL_MS = 4 * 60_000;
const SCALES = refinementApprovedScales([1]);
const iso = (epoch) => new Date(epoch).toISOString();

let root;
let priorRoot;
let priorKey;
let neumaId;
let ceremonyId;
let operation;
let planAuthority;

const withSubject = async (work) => {
  const transactionOwner = await openRefinementSubjectTransaction({ neumaId, operation });
  try {
    return await work(
      transactionOwner,
      assertRefinementSubjectTransaction(transactionOwner, operation),
    );
  } finally {
    await closeRefinementSubjectTransaction(transactionOwner, operation);
  }
};
const currentCeremony = () => withSubject((owner, subjectAuthority) =>
  readCurrentRefinementCeremony({ subjectAuthority, ceremonyId, operation }));
const currentApprovalState = () => withSubject(async (transactionOwner) => {
  const authority = await openRefinementTrainingApprovalState({
    transactionOwner, ceremonyId, operation,
  });
  try { return assertRefinementTrainingApprovalState(authority, operation).state; }
  finally { closeRefinementTrainingApprovalState(authority, operation); }
});

/** Rewrite the persisted approval through the real store's own CAS. */
const rewriteApprovalState = (patch) => withSubject(async (transactionOwner) => {
  let authority = await openRefinementTrainingApprovalState({
    transactionOwner, ceremonyId, operation,
  });
  try {
    const next = { ...assertRefinementTrainingApprovalState(authority, operation).state, ...patch };
    for (const field of STORE_OWNED) delete next[field];
    authority = await commitRefinementTrainingApprovalState(authority, next, operation);
    return assertRefinementTrainingApprovalState(authority, operation).state;
  } finally { closeRefinementTrainingApprovalState(authority, operation); }
});

/** Advance the ceremony one real revision through the real transition primitives. */
const failOneTrainingAttempt = () => withSubject(async (transactionOwner) => {
  const ceremonyAuthority = await openRefinementCeremonyTransaction({
    transactionOwner, ceremonyId, operation,
  });
  try {
    const { current } = assertRefinementCeremonyTransaction(ceremonyAuthority, operation);
    const prepared = prepareRefinementCeremonyTransition(
      ceremonyAuthority,
      recordTrainingFailure(current.record, { error: 'preflight refused', at: iso(Date.now()) }),
      'training-failed',
      operation,
    );
    return await commitPreparedRefinementCeremonyTransition(
      ceremonyAuthority, prepared, operation,
    );
  } finally { closeRefinementCeremonyTransaction(ceremonyAuthority, operation); }
});

const seedTrainingCeremony = async () => {
  await workspace.create(neumaId);
  await workspace.writeNeumaDEK(neumaId, 'a'.repeat(64));
  await workspace.writeDNA(neumaId, {
    version: '1.0.0',
    identity: { name: 'Launch Prooflet' },
    sovereignty: { generation: 1 },
  });
  const custody = await withSubject((owner, subjectAuthority) =>
    readCurrentRefinementCustody({ subjectAuthority, operation }));
  expect(custody.state).toBe('present');
  expect(custody.custody).toEqual(
    refinementCustodyIdentity(neumaId, await workspace.readDNA(neumaId)),
  );
  const openedAt = iso(Date.now());
  const priorCeremonySha256 = refinementHistorySha256([]);
  await workspace.writeCeremony(neumaId, {
    id: ceremonyId,
    neumaId,
    witness: WITNESS,
    custody: custody.custody,
    openedAt,
    phase: 'training',
    consent: {
      at: openedAt,
      ceremonyApprovalSha256: refinementSha256({
        act: 'refinement-ceremony-approved', ceremonyId, neumaId, operator: WITNESS, at: openedAt,
      }),
    },
    events: [{ at: openedAt, type: 'opened', custody: custody.custody }],
    revision: 1,
    priorCeremonySha256,
    transaction: {
      schemaVersion: 2,
      revision: 1,
      priorCeremonySha256,
      custodySha256: custody.custodySha256,
      transition: 'opened',
    },
  });
  const read = await currentCeremony();
  expect(read.state).toBe('present');
  return Object.freeze({
    approvedScales: SCALES,
    approvedScalesSha256: refinementSha256(SCALES),
    ceremonyId,
    ceremonyRecordSha256: read.recordSha256,
    ceremonyRevision: read.revision,
    custodySha256: read.custodySha256,
    executionEnvelopeSha256: refinementSha256({ envelope: 'cpu-only-preflight', ceremonyId }),
    neumaId,
    operationConfigSha256: refinementSha256({ rank: 8, steps: 4, ceremonyId }),
    trainingPlanSha256: refinementSha256({ plan: 'training', ceremonyId, neumaId }),
  });
};

const issue = (overrides = {}) => issueRefinementTrainingApproval({
  planAuthority, operatorWallet: WITNESS, operation, ...overrides,
});
const consume = (approvalToken, overrides = {}) => consumeRefinementTrainingApproval({
  neumaId,
  ceremonyId,
  trainingPlanSha256: planAuthority.trainingPlanSha256,
  approvalToken,
  operatorWallet: WITNESS,
  operation,
  ...overrides,
});
const launched = async (approvalToken) =>
  assertRefinementTrainingLaunchAuthority(await consume(approvalToken), operation);

beforeEach(async () => {
  // Subject custody pins every ancestor of the workspace root and refuses a
  // group/world-writable one, so the shared /tmp lane cannot host this root.
  root = await fs.mkdtemp(path.join(os.homedir(), '.neuma-refinement-launch-'));
  priorRoot = getWorkspacesRoot();
  priorKey = process.env.DNA_ENCRYPTION_KEY;
  process.env.DNA_ENCRYPTION_KEY = 'refinement-training-launch-real-temp-workspace-key';
  resetWorkspaceCryptoKey();
  setWorkspacesRoot(path.join(root, 'workspaces'));
  operation = createRefinementProcessOperation({ timeoutMs: 120_000 });
  neumaId = `launch-being-${Math.floor(Math.random() * 1e9).toString(36)}`;
  ceremonyId = `ceremony-${Date.now()}`;
  planAuthority = await seedTrainingCeremony();
});

afterEach(async () => {
  setWorkspacesRoot(priorRoot);
  if (priorKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
  else process.env.DNA_ENCRYPTION_KEY = priorKey;
  resetWorkspaceCryptoKey();
  await fs.rm(root, { recursive: true, force: true });
});

describe('refinement training launch transaction', () => {
  it('issues one bounded approval and consumes it exactly once', async () => {
    const issued = await issue();

    expect(Object.keys(issued).sort()).toEqual(['approval', 'approvalToken', 'expiresAt']);
    expect(issued.approvalToken).toMatch(TOKEN);
    expect(issued.approval).toEqual({
      ceremonyId,
      ceremonyRevision: 1,
      approvalRevision: 1,
      trainingPlanSha256: planAuthority.trainingPlanSha256,
      approvedScales: [1],
      approvedScalesSha256: planAuthority.approvedScalesSha256,
      issuedAt: issued.approval.issuedAt,
      expiresAt: issued.expiresAt,
    });
    expect(Date.parse(issued.expiresAt) - Date.parse(issued.approval.issuedAt)).toBe(TTL_MS);

    const pending = await currentApprovalState();
    expect(pending.status).toBe('PENDING');
    expect(pending.approvalTokenSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(pending)).not.toContain(issued.approvalToken);

    const projection = await launched(issued.approvalToken);
    expect(projection).toMatchObject({
      neumaId,
      ceremonyId,
      ceremonyRevision: 1,
      consumedCeremonyRevision: 2,
      trainingPlanSha256: planAuthority.trainingPlanSha256,
      operationConfigSha256: planAuthority.operationConfigSha256,
      executionEnvelopeSha256: planAuthority.executionEnvelopeSha256,
      approvedScales: [1],
    });
    expect(refinementTrainingPlanAuthority(projection.record)).toMatchObject({
      operatorDecisionSha256: projection.operatorDecisionSha256,
      trainingPlanSha256: planAuthority.trainingPlanSha256,
      consumedAt: projection.consumedAt,
    });

    const committed = await currentCeremony();
    expect(committed.revision).toBe(2);
    expect(committed.recordSha256).toBe(projection.consumedCeremonyRecordSha256);
    expect(committed.record.events.map((event) => event.type).slice(-2))
      .toEqual(['training-plan-decision', 'training-plan-decision-consumed']);
    expect(await currentApprovalState()).toMatchObject({
      status: 'CONSUMED',
      consumedCeremonyRevision: 2,
      operatorDecisionSha256: projection.operatorDecisionSha256,
    });
  });

  it('closes the launch authority so no later caller can read it', async () => {
    const authority = await consume((await issue()).approvalToken);

    expect(assertRefinementTrainingLaunchAuthority(authority, operation).consumedAt)
      .toEqual(expect.any(String));
    expect(closeRefinementTrainingLaunchAuthority(authority, operation)).toBe(true);
    expect(closeRefinementTrainingLaunchAuthority(authority, operation)).toBe(false);
    expect(() => assertRefinementTrainingLaunchAuthority(authority, operation))
      .toThrow(/training launch authority is unavailable/);
  });

  it('refuses a replayed token with its own distinct code and changes nothing', async () => {
    const issued = await issue();
    await consume(issued.approvalToken);

    await expect(consume(issued.approvalToken))
      .rejects.toMatchObject({ code: 'TRAINING_APPROVAL_REPLAY' });
    expect(await currentApprovalState()).toMatchObject({ revision: 2, status: 'CONSUMED' });
    expect((await currentCeremony()).revision).toBe(2);
  });

  it('refuses an expired token before anything is journalled', async () => {
    const issued = await issue();
    const shifted = await rewriteApprovalState({
      issuedAt: iso(Date.now() - 10 * 60_000),
      expiresAt: iso(Date.now() - 6 * 60_000),
    });
    expect(shifted.status).toBe('PENDING');

    await expect(consume(issued.approvalToken))
      .rejects.toMatchObject({ code: 'TRAINING_APPROVAL_EXPIRED' });
    expect((await currentCeremony()).revision).toBe(1);
    expect(await currentApprovalState()).toMatchObject({ status: 'PENDING' });
  });

  it('refuses a token whose plan digest no longer matches', async () => {
    const issued = await issue();

    await expect(consume(issued.approvalToken, {
      trainingPlanSha256: refinementSha256({ plan: 'a different training plan' }),
    })).rejects.toMatchObject({ code: 'TRAINING_APPROVAL_PLAN_CHANGED' });
    expect((await currentCeremony()).revision).toBe(1);
    expect((await launched(issued.approvalToken)).trainingPlanSha256)
      .toBe(planAuthority.trainingPlanSha256);
  });

  it('refuses a token after the ceremony advances past the approved revision', async () => {
    const issued = await issue();
    expect((await failOneTrainingAttempt()).revision).toBe(2);

    await expect(consume(issued.approvalToken))
      .rejects.toMatchObject({ code: 'TRAINING_APPROVAL_CEREMONY_CHANGED' });
    expect((await currentCeremony()).revision).toBe(2);
    expect(await currentApprovalState()).toMatchObject({ status: 'PENDING' });
  });

  it('refuses any operator wallet other than the ceremony operator', async () => {
    await expect(issue({ operatorWallet: FOREIGN_WITNESS }))
      .rejects.toMatchObject({ code: 'TRAINING_APPROVAL_OPERATOR_CHANGED' });
    await expect(issue({ operatorWallet: '' }))
      .rejects.toMatchObject({ code: 'TRAINING_APPROVAL_INVALID' });

    const issued = await issue();
    await expect(consume(issued.approvalToken, { operatorWallet: FOREIGN_WITNESS }))
      .rejects.toMatchObject({ code: 'TRAINING_APPROVAL_OPERATOR_CHANGED' });
  });

  it('supersedes an unconsumed token when the same wallet re-prepares', async () => {
    const first = await issue();
    const second = await issue();

    expect(second.approvalToken).not.toBe(first.approvalToken);
    expect(second.approval.approvalRevision).toBe(2);
    await expect(consume(first.approvalToken))
      .rejects.toMatchObject({ code: 'TRAINING_APPROVAL_SUPERSEDED' });
    expect((await launched(second.approvalToken)).consumedCeremonyRevision).toBe(2);
  });

  it('recovers a crash between the ceremony journal and the approval commit', async () => {
    const issued = await issue();
    const first = await launched(issued.approvalToken);

    // The exact on-disk state a crash leaves behind: the decision is journalled
    // in the ceremony, the persisted approval never reached CONSUMED.
    await rewriteApprovalState({
      status: 'PENDING',
      consumedAt: null,
      consumedCeremonyRecordSha256: null,
      consumedCeremonyRevision: null,
      operatorDecisionSha256: null,
    });

    const recovered = await launched(issued.approvalToken);
    expect(recovered.operatorDecisionSha256).toBe(first.operatorDecisionSha256);
    expect(recovered.consumedAt).toBe(first.consumedAt);
    expect(recovered.consumedCeremonyRevision).toBe(2);
    expect((await currentCeremony()).revision).toBe(2);
    expect(await currentApprovalState()).toMatchObject({ status: 'CONSUMED' });
    await expect(consume(issued.approvalToken))
      .rejects.toMatchObject({ code: 'TRAINING_APPROVAL_REPLAY' });
  });
});
