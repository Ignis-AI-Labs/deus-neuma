/**
 * wallet/send INTENT under the modes (W2-007 closure, Stage 3 of the
 * being-tool-surface doctrine) — proven with NO mock on the claimed path
 * (AGENTS.md RULE 0): REAL workspace on real disk, REAL spend policy stores,
 * REAL sweep settling REAL filed intents.
 *
 * The law under test: the standing grants (allowlist + threshold) are the
 * operator's approval routes — the intents/wallet.send row is `allowed` by
 * default, so ask adds NO card — but observe means watching, not acting,
 * and the hold leaves the intent PENDING (never a verdict, never a move).
 * External channels hardcode observe as their safety posture, so nothing may
 * act under it. AUTO is the one mode that is tightened: the protocol guard
 * (182ca2f5f, protocol-guard.js) pauses value leaving the house on the
 * operator's card even though the row is allowed.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { addEntry, toAllowlist } from '../../core/wallet/spend-policy.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const NEUMA_ID = 'spendholdecho';
const RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';

describe('the wallet/send intent under tool modes (real workspace, gnosis)', () => {
  let house, origRoot, intentsDir;

  const freshConnection = (toolMode, extra = {}) => {
    const sent = [];
    return {
      sent,
      connection: {
        ws: { readyState: 1, OPEN: 1, send: (s) => sent.push(JSON.parse(s)) },
        companion: { name: 'SpendHoldEcho', neumaId: NEUMA_ID },
        toolMode,
        _writeOps: 0,
        ...extra,
      },
    };
  };

  const fileIntent = async (name, payload) => {
    await fs.mkdir(intentsDir, { recursive: true });
    await fs.writeFile(path.join(intentsDir, `${name}.json`), JSON.stringify(payload));
  };
  const readResult = async (name) => {
    try {
      return JSON.parse(await fs.readFile(path.join(intentsDir, `${name}.result.json`), 'utf8'));
    } catch { return null; }
  };
  const sweep = (connection) => sweepIntents(connection, {
    mode: connection.toolMode, lanePolicy: null, emit: () => {},
  });

  beforeAll(async () => {
    house = await createTempDir('spend-intent-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    await workspace.create(NEUMA_ID);
    intentsDir = path.join(workspace.pathFor(NEUMA_ID), 'intents');
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    setWorkspacesRoot(origRoot);
    await fs.rm(house, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Each test sweeps only its OWN filing: the intents dir, the pending
    // spends, and the spend policy return to a known floor between tests —
    // the recipient allowlisted, the threshold zero (every send owes the
    // operator's out-of-band signature unless a test raises it).
    await fs.rm(intentsDir, { recursive: true, force: true });
    await workspace.writePendingSpends(NEUMA_ID, []);
    await workspace.writeSpendThreshold(NEUMA_ID, { thresholdEth: 0 });
    await workspace.writeSpendAllowlist(NEUMA_ID,
      addEntry(toAllowlist(null), RECIPIENT, 'approved sink', new Date().toISOString()));
  });

  test('observe HOLDS the intent — pending, never a verdict, nothing moves, no card', async () => {
    const { sent, connection } = freshConnection('observe');
    await fileIntent('held-spend', { type: 'wallet/send', to: RECIPIENT, value: 0.01 });
    const receipts = await sweep(connection);

    expect(receipts).toEqual([]);
    expect(await readResult('held-spend')).toBeNull(); // watching is not a verdict
    expect(await workspace.readPendingSpends(NEUMA_ID)).toEqual([]); // nothing was requested
    expect(sent.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('ask flows to the REAL spend policy — default-deny answers, no card', async () => {
    const stranger = '0x0000000000000000000000000000000000000001';
    const { sent, connection } = freshConnection('ask');
    await fileIntent('denied-spend', { type: 'wallet/send', to: stranger, value: 0.01 });
    const receipts = await sweep(connection);

    expect(receipts[0].status).toBe('denied');
    // The REAL policy spoke: the allowlist on real disk permits nothing else.
    expect(receipts[0].error).toMatch(/not approved/);
    expect(receipts[0].error).not.toContain('held by observe mode');
    expect((await readResult('denied-spend')).status).toBe('denied');
    expect(sent.some((m) => m.type === 'tool:approval_request')).toBe(false);
    expect(await workspace.readPendingSpends(NEUMA_ID)).toEqual([]);
  }, 30000);

  test('allowlisted + ABOVE the threshold goes PENDING — the operator\'s out-of-band ask lands on real disk', async () => {
    // threshold 0: every send is above it, so the operator's signature is owed.
    const { sent, connection } = freshConnection('ask');
    await fileIntent('pending-spend', { type: 'wallet/send', to: RECIPIENT, value: 0.01, memo: 'the proving transfer' });
    const receipts = await sweep(connection);

    expect(receipts[0].status).toBe('ok'); // the REQUEST succeeded — the send awaits the operator
    expect(receipts[0].content).toContain('above your autonomous threshold');
    expect((await readResult('pending-spend')).status).toBe('done');
    const pending = await workspace.readPendingSpends(NEUMA_ID);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ to: RECIPIENT, value: '0.01', memo: 'the proving transfer', status: 'pending' });
    expect(sent.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('allowlisted + WITHIN the threshold reaches the real wallet boundary — never a fake done', async () => {
    // The chain send leg needs an unlocked keypair and the network; the test
    // rig has neither by construction, so requestSpend answers its honest
    // error — and the intent settles FAILED, never done. (The live wire is
    // the operator's desk flow, proven outside the suite.)
    await workspace.writeSpendThreshold(NEUMA_ID, { thresholdEth: 1 });
    const { connection } = freshConnection('ask');
    await fileIntent('chain-spend', { type: 'wallet/send', to: RECIPIENT, value: 0.01 });
    const receipts = await sweep(connection);

    expect(receipts[0].status).toBe('error');
    expect(receipts[0].error).toContain('could not be sent');
    expect((await readResult('chain-spend')).status).toBe('failed');
  }, 30000);

  test('AUTO pauses the send on the operator\'s card — a deny settles it and nothing moves', async () => {
    // The protocol guard (182ca2f5f): AUTO alone never lets value leave the
    // house, even on an allowlisted recipient with the row allowed.
    const { sent, connection } = freshConnection('auto');
    await fileIntent('auto-spend', { type: 'wallet/send', to: RECIPIENT, value: 0.01 });
    const settling = sweep(connection);
    await expect.poll(() => sent.find((m) => m.type === 'tool:approval_request'), { timeout: 5000 }).toBeTruthy();
    const card = sent.find((m) => m.type === 'tool:approval_request');
    expect(card.tool).toBe('intents/wallet.send');
    expect(resolveToolApproval(connection, card.id, 'deny')).toBe(true);
    const receipts = await settling;

    expect(receipts[0].status).toBe('denied');
    expect(await workspace.readPendingSpends(NEUMA_ID)).toEqual([]);
  }, 30000);

  test('the sovereignty boundary — a witness seat is refused before anything moves', async () => {
    const { connection } = freshConnection('auto', {
      companion: { name: 'PeerProbe', neumaId: 'witness-openai-PeerProbe', participantKind: 'witness' },
    });
    const witnessDir = path.join(workspace.pathFor('witness-openai-PeerProbe'), 'intents');
    await fs.mkdir(witnessDir, { recursive: true });
    await fs.writeFile(path.join(witnessDir, 'peer-spend.json'),
      JSON.stringify({ type: 'wallet/send', to: RECIPIENT, value: 0.01 }));

    const receipts = await sweep(connection);
    expect(receipts[0].status).toBe('denied');
    expect(receipts[0].error).toContain('local-custody authority');
    expect(await workspace.readPendingSpends(NEUMA_ID)).toEqual([]);
    expect(await workspace.readPendingSpends('witness-openai-PeerProbe')).toEqual([]);
  }, 30000);
});
