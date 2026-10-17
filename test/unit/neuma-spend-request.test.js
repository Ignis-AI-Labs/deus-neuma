/**
 * Neuma-initiated spend — the autonomous send loop's policy core + pending
 * approval lifecycle. Autonomous spending is OFF by default: a neuma can only
 * send to a witness-approved recipient, and only within a witness-set threshold;
 * anything above goes to an async pending-approval the witness signs out-of-band.
 *
 * Pure policy is unit-tested directly; the lifecycle runs against a real temp
 * workspace (no mocked data path). The actual on-chain send + witness-approved
 * execution are verified on the Base fork (need a chain + an unlocked key).
 */

import { createTempDir } from '../helpers/temp-fs.js';
import { classifySpend } from '../../core/wallet/spend-policy.js';

const ALICE = '0x1111111111111111111111111111111111111111';
const MALLORY = '0x2222222222222222222222222222222222222222';
const allowlistOf = (...addrs) => ({ version: 1, entries: addrs.map((a) => ({ address: a.toLowerCase(), label: '', addedAt: 'x' })) });

describe('classifySpend (pure) — autonomous OFF by default', () => {
  test('denied: recipient not on the allowlist (even below threshold)', () => {
    expect(classifySpend(allowlistOf(ALICE), 1, { to: MALLORY, value: 0.01 })).toBe('denied');
    expect(classifySpend(null, 99, { to: ALICE, value: 0.01 })).toBe('denied'); // empty/unset = deny
  });
  test('pending: allowlisted but above the autonomous threshold', () => {
    expect(classifySpend(allowlistOf(ALICE), 0, { to: ALICE, value: 0.01 })).toBe('pending'); // threshold 0 = everything pends
    expect(classifySpend(allowlistOf(ALICE), 0.1, { to: ALICE, value: 0.5 })).toBe('pending');
  });
  test('autonomous: allowlisted and at/under the threshold', () => {
    expect(classifySpend(allowlistOf(ALICE), 1, { to: ALICE, value: 0.5 })).toBe('autonomous');
    expect(classifySpend(allowlistOf(ALICE), 0.5, { to: ALICE, value: 0.5 })).toBe('autonomous'); // boundary inclusive
  });
});

describe('spendOutcome (pure) — BE-141: the being reads the SAME truth as the desk', () => {
  let spendOutcome;
  beforeAll(async () => {
    ({ spendOutcome } = await import('../../backend/services/intents/wallet-send.js'));
  });

  test('sent → ok, with the transaction narrative', () => {
    const { ok, content } = spendOutcome({ status: 'sent', receipt: { hash: '0xdead' } }, { to: ALICE, value: 0.5 });
    expect(ok).toBe(true);
    expect(content).toContain('0xdead');
  });

  test('pending → ok: the REQUEST succeeded and awaits the operator', () => {
    const { ok, content } = spendOutcome({ status: 'pending' }, { to: ALICE, value: 2 });
    expect(ok).toBe(true); // pending is a successful request, not a failure
    expect(content).toMatch(/operator/i);
  });

  test('denied → NOT ok: the being is told it failed, never ok', () => {
    const { ok, content } = spendOutcome({ status: 'denied' }, { to: MALLORY, value: 0.01 });
    expect(ok).toBe(false);
    expect(content).toMatch(/not approved/i);
  });

  test('error → NOT ok: the reason is surfaced', () => {
    const { ok, content } = spendOutcome({ status: 'error', reason: 'insufficient funds' }, { to: ALICE, value: 0.5 });
    expect(ok).toBe(false);
    expect(content).toContain('insufficient funds');
  });

  test('an unknown status falls through to a failure, never ok', () => {
    const { ok, content } = spendOutcome({ status: 'weird' }, { to: ALICE, value: 0.5 });
    expect(ok).toBe(false);
    expect(content).toMatch(/could not be sent/i);
  });
});

describe('spend-request lifecycle over the real workspace', () => {
  let wallet, workspace;

  beforeEach(async () => {
    const tempDir = await createTempDir(`spend-${Math.random().toString(36).slice(2)}`);
    workspace = (await import('../../core/index.js')).neumaWorkspace;
    workspace.root = tempDir;
    wallet = await import('../../backend/services/neuma-wallet.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const setup = async (neumaId, { allow = [], thresholdEth = 0 } = {}) => {
    await workspace.create(neumaId);
    await workspace.writeSpendAllowlist(neumaId, allowlistOf(...allow));
    await workspace.writeSpendThreshold(neumaId, { thresholdEth });
  };

  test('rejects invalid input without touching policy', async () => {
    await setup('n1', { allow: [ALICE] });
    expect((await wallet.requestSpend('n1', { to: 'not-an-address', value: 1 })).status).toBe('error');
    expect((await wallet.requestSpend('n1', { to: ALICE, value: 0 })).status).toBe('error');
    expect((await wallet.requestSpend('n1', { to: ALICE, value: -5 })).status).toBe('error');
  });

  test('denied: a neuma cannot send to an unapproved recipient', async () => {
    await setup('n2', { allow: [ALICE], thresholdEth: 99 });
    const out = await wallet.requestSpend('n2', { to: MALLORY, value: 0.01 });
    expect(out.status).toBe('denied');
    expect(await wallet.listPendingSpends('n2')).toEqual([]); // nothing recorded
  });

  test('pending: above-threshold request is recorded for the witness (async, not failed closed)', async () => {
    await setup('n3', { allow: [ALICE], thresholdEth: 0 });
    const out = await wallet.requestSpend('n3', { to: ALICE, value: '0.5', memo: 'server costs' });
    expect(out.status).toBe('pending');
    expect(out.request).toMatchObject({ to: ALICE, value: '0.5', memo: 'server costs', status: 'pending' });
    expect(out.request.nonce).toBeTruthy();
    expect(out.request.expiry).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const pending = await wallet.listPendingSpends('n3');
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(out.request.id);

    // The witness-signed message binds the exact request (no replay/retarget).
    const msg = wallet.pendingApprovalMessage('n3', out.request);
    expect(msg).toContain(ALICE.toLowerCase());
    expect(msg).toContain('0.5 ETH');
    expect(msg).toContain(out.request.nonce);
  });

  test('reject: a witness can decline a pending request; nothing is sent', async () => {
    await setup('n4', { allow: [ALICE], thresholdEth: 0 });
    const { request } = await wallet.requestSpend('n4', { to: ALICE, value: '0.5' });
    const rejected = await wallet.rejectPendingSpend('n4', request.id);
    expect(rejected.status).toBe('rejected');
    expect(await wallet.listPendingSpends('n4')).toEqual([]); // gone from the open list
  });

  test('approve/reject guard against missing or already-resolved requests', async () => {
    await setup('n5', { allow: [ALICE], thresholdEth: 0 });
    await expect(wallet.approvePendingSpend('n5', 'nope', '0xsig')).rejects.toThrow(/not found/);
    await expect(wallet.rejectPendingSpend('n5', 'nope')).rejects.toThrow(/not found/);

    const { request } = await wallet.requestSpend('n5', { to: ALICE, value: '0.5' });
    await wallet.rejectPendingSpend('n5', request.id);
    await expect(wallet.rejectPendingSpend('n5', request.id)).rejects.toThrow(/already rejected/);
  });
});
