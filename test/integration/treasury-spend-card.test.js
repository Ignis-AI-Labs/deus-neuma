/**
 * THE SPEND CARD (#586), end to end through the real wallet spend path on a
 * LOCAL chain (anvil as Base, test keys only — never a public network):
 *
 *   a being asks → the request stands in WAITING ON YOU (never one-press) and
 *   as a SPEND card with everything the decision rests on → DENY with a note
 *   moves nothing and the being is told the note → APPROVE through the real
 *   signature-and-password flow sends exactly the amount, recorded with the
 *   being's reason, and the being is told → the refusals stand as before
 *   (over the cap, off the allowlist, calldata) → an unseen request expires,
 *   leaves the account, cannot be approved, and the being is told.
 *
 * RULE 0: real routes, real session tokens, real encrypted key on real temp
 * disk, real EIP-191 signatures, a real EVM. No mock anywhere on the path.
 */
import request from 'supertest';
import { ethers } from 'ethers';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { standTreasury, PASSWORD } from '../helpers/treasury-kit.js';

describe('the SPEND card — a being\'s pending spend reaches the operator and is decided there', () => {
  let kit, operator, quill, recipient, stranger;
  let wallet, records, news;

  beforeAll(async () => {
    kit = await standTreasury('treasury-spend-card');
    operator = kit.operator();
    recipient = ethers.Wallet.createRandom().address;
    stranger = ethers.Wallet.createRandom().address;
    quill = await kit.addBeing({ laneId: 'quill', owner: operator, keyIndex: 0, name: 'Quill', recipients: [{ address: recipient, label: 'the printer' }] });
    wallet = await import('../../backend/services/neuma-wallet.js');
    records = await import('../../backend/services/treasury/spend-records.js');
    news = await import('../../backend/services/treasury/spend-news.js');
  }, 60000);

  afterAll(async () => { await kit?.stop(); });

  const waiting = async (who = operator) => (await request(kit.app).get('/api/v1/waiting').set(who.auth)).body;
  const cards = async (who = operator) => {
    const res = await request(kit.app).get('/api/v1/treasury/spends').set(who.auth);
    expect(res.status).toBe(200);
    return res.body.spends;
  };
  const balance = async (address) => kit.baseProvider.getBalance(address);

  test('a request stands in WAITING ON YOU and as a whole SPEND card', async () => {
    const before = await balance(quill.address);
    const asked = await wallet.requestSpend('quill', { to: recipient, value: '0.012345678901234567', memo: 'Printing the launch flyers.' });
    expect(asked.status).toBe('pending');

    const account = await waiting();
    const item = account.items.find((i) => i.kind === 'spend');
    expect(item).toMatchObject({
      id: `spend:quill:${asked.request.id}`, who: { laneId: 'quill', name: 'Quill' },
      where: { app: 'treasury', neumaId: 'quill', spendId: asked.request.id },
    });
    expect(item.title).toContain('0.012345678901234567 ETH');
    expect(item.title).toContain('Printing the launch flyers.');
    // Never a one-press approve: the band shows OPEN only (bandMayApprove needs oneTap).
    expect(item.oneTap).toBeUndefined();

    const [card] = await cards();
    expect(card).toMatchObject({
      id: asked.request.id, neumaId: 'quill', who: { name: 'Quill' },
      reason: 'Printing the launch flyers.', amount: '0.012345678901234567', amountValid: true,
      asset: 'ETH', network: 'base', chain: 'Base mainnet',
      recipient: { address: recipient, label: 'the printer', standing: 'approved', firstTime: true, priorSends: 0 },
      limits: { thresholdEth: 0, capEth: '0.1', signatureNeeded: true }, review: null,
    });
    // The balance and the balance after are exact, in wei — never rounded.
    expect(card.from.address).toBe(quill.address);
    expect(card.from.balanceEth).toBe(ethers.formatEther(before));
    expect(card.from.balanceAfterEth).toBe(ethers.formatEther(before - ethers.parseEther('0.012345678901234567')));
    expect(card.secondsLeft).toBeGreaterThan(24 * 3600 - 60);
    expect(card.approval).toMatchObject({ to: recipient, value: '0.012345678901234567', nonce: asked.request.nonce });
  });

  test('DENY with a note: nothing moves, the account drops it, the being is told the note', async () => {
    const [card] = await cards();
    const beingBefore = await balance(quill.address);
    const res = await request(kit.app).post(`/api/v1/neuma/quill/wallet/pending/${card.id}/reject`).set(operator.auth)
      .send({ note: 'Not this week — we print after the copy is final.' });
    expect(res.status).toBe(200);
    expect((await waiting()).items.some((i) => i.kind === 'spend')).toBe(false);
    expect(await cards()).toEqual([]);
    expect(await balance(recipient)).toBe(0n);
    expect(await balance(quill.address)).toBe(beingBefore);

    const told = await news.spendNewsFor('quill');
    expect(told.ids).toEqual([card.id]);
    expect(told.text).toContain('DECLINED');
    expect(told.text).toContain('"Not this week — we print after the copy is final."');
    expect(told.text).toContain('Nothing was sent.');
    // Told once: marked, it is history.
    await records.markSpendsTold('quill', told.ids);
    expect((await news.spendNewsFor('quill')).text).toBe('');
  });

  test('APPROVE through the real signature and password: exactly the amount goes out, recorded with its reason', async () => {
    const asked = await wallet.requestSpend('quill', { to: recipient, value: '0.0123', memo: 'The flyers, final copy.' });
    const [card] = await cards();
    const message = (await import('../../core/wallet/spend-policy.js')).buildApprovalMessage({ neumaId: 'quill', ...card.approval });

    // A wrong password moves nothing and leaves the request decidable.
    const signature = await operator.wallet.signMessage(message);
    const wrong = await request(kit.app).post(`/api/v1/neuma/quill/wallet/pending/${card.id}/approve`).set(operator.auth)
      .send({ signature, password: 'not-the-password' });
    expect(wrong.status).toBe(401);
    expect(await balance(recipient)).toBe(0n);

    const res = await request(kit.app).post(`/api/v1/neuma/quill/wallet/pending/${card.id}/approve`).set(operator.auth)
      .send({ signature, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await balance(recipient)).toBe(ethers.parseEther('0.0123'));
    const record = (await records.readSpendRecords('quill')).find((r) => r.id === asked.request.id);
    expect(record).toMatchObject({ status: 'executed', memo: 'The flyers, final copy.', txHash: res.body.hash });
    expect((await waiting()).items.some((i) => i.kind === 'spend')).toBe(false);

    const told = await news.spendNewsFor('quill');
    expect(told.text).toContain(`APPROVED: your operator signed and sent 0.0123 ETH to ${recipient}`);
    expect(told.text).toContain(res.body.hash);
    await records.markSpendsTold('quill', told.ids);

    // The next request to the same address is no longer a first time.
    await wallet.requestSpend('quill', { to: recipient, value: '0.001', memo: 'Reprint.' });
    const [next] = await cards();
    expect(next.recipient).toMatchObject({ firstTime: false, priorSends: 1 });
    await request(kit.app).post(`/api/v1/neuma/quill/wallet/pending/${next.id}/reject`).set(operator.auth).send({});
    await records.markSpendsTold('quill', (await news.spendNewsFor('quill')).ids);
  });

  test('an approval signed by anyone but the operator is refused — the being\'s own key included', async () => {
    const asked = await wallet.requestSpend('quill', { to: recipient, value: '0.002', memo: 'Self-approved?' });
    const [card] = await cards();
    const message = (await import('../../core/wallet/spend-policy.js')).buildApprovalMessage({ neumaId: 'quill', ...card.approval });
    const forged = await quill.key.signMessage(message);
    const before = await balance(recipient);
    const res = await request(kit.app).post(`/api/v1/neuma/quill/wallet/pending/${card.id}/approve`).set(operator.auth)
      .send({ signature: forged, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not signed by the owner/);
    expect(await balance(recipient)).toBe(before);
    // A refused broadcast settles failed (never retried) and the being is told.
    expect((await records.readSpendRecords('quill')).find((r) => r.id === asked.request.id).status).toBe('failed');
    const told = await news.spendNewsFor('quill');
    expect(told.text).toContain('FAILED');
    await records.markSpendsTold('quill', told.ids);
  });

  test('the refusals stand as before: off the allowlist, over the cap, calldata', async () => {
    expect(await wallet.requestSpend('quill', { to: stranger, value: '0.001' })).toMatchObject({ status: 'denied' });
    // A standing threshold lets small sends go without a signature — the 0.1 ETH cap still refuses one over it.
    await kit.workspace.writeSpendThreshold('quill', { thresholdEth: 0.5 });
    const over = await wallet.requestSpend('quill', { to: recipient, value: '0.2', memo: 'Too much at once.' });
    expect(over.status).toBe('error');
    expect(over.reason).toMatch(/exceeds max 0\.1 ETH/);
    // …and the refused autonomous send is on the record of money out, already told.
    const recorded = (await records.readSpendRecords('quill')).at(-1);
    expect(recorded).toMatchObject({ status: 'failed', autonomous: true, value: '0.2', memo: 'Too much at once.' });
    expect(recorded.toldAt).toBeTruthy();
    const { decryptKeypair } = await import('../../core/wallet/keypair-vault.js');
    const key = decryptKeypair(await kit.workspace.readEncryptedKeypair('quill'), PASSWORD);
    await expect(wallet.sendTransaction('quill', { to: recipient, value: '0.001', data: '0xa9059cbb' }, key))
      .rejects.toThrow(/calldata not permitted/);
    await expect(wallet.signTransaction()).rejects.toThrow();
    await kit.workspace.writeSpendThreshold('quill', { thresholdEth: 0 });
    expect(await balance(stranger)).toBe(0n);
  });

  test('a request left unseen expires: it leaves the account, cannot be approved, and the being is told', async () => {
    const asked = await wallet.requestSpend('quill', { to: recipient, value: '0.003', memo: 'Before the deadline.' });
    // Its 24 hours pass (the record's own expiry moved into the past).
    await kit.workspace.updatePendingSpends('quill', (list) => list.map((r) => (r.id === asked.request.id ? { ...r, expiry: Math.floor(Date.now() / 1000) - 5 } : r)));
    expect((await waiting()).items.some((i) => i.id === `spend:quill:${asked.request.id}`)).toBe(false);
    expect(await cards()).toEqual([]);
    expect((await records.readSpendRecords('quill')).find((r) => r.id === asked.request.id).status).toBe('expired');

    const message = (await import('../../core/wallet/spend-policy.js')).buildApprovalMessage({ neumaId: 'quill', ...asked.request, expiry: Math.floor(Date.now() / 1000) - 5 });
    const res = await request(kit.app).post(`/api/v1/neuma/quill/wallet/pending/${asked.request.id}/approve`).set(operator.auth)
      .send({ signature: await operator.wallet.signMessage(message), password: PASSWORD });
    expect(res.status).toBe(409);
    const told = await news.spendNewsFor('quill');
    expect(told.text).toContain('EXPIRED');
    expect(told.text).toContain('Nothing was sent.');
  });

  test('another house sees none of it, and cannot decide it', async () => {
    const other = kit.operator();
    const asked = await wallet.requestSpend('quill', { to: recipient, value: '0.004' });
    expect((await waiting(other)).items.some((i) => i.kind === 'spend')).toBe(false);
    expect(await cards(other)).toEqual([]);
    const res = await request(kit.app).post(`/api/v1/neuma/quill/wallet/pending/${asked.request.id}/reject`).set(other.auth).send({});
    expect(res.status).toBe(403);
    expect((await cards()).map((c) => c.id)).toContain(asked.request.id);
  });
});
