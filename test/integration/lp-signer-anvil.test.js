/**
 * The LP signer against a REAL chain node (RULE 0): anvil on loopback, running
 * as chain 8453. Nonce, fees and the gas estimate are anvil's; the signed
 * bytes are broadcast back to it and mined, so […] is something the node itself confirmed.
 *
 * What this does NOT prove: that Umbrae's real position manager accepts these
 * calls. Plain anvil has no code at the manager's address. That proof is the
 * funded run on Base (docs/work/umbrae-lp.md).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { signLpTransaction, signAgentAuth, MAX_GAS_COST_WEI } from '../../backend/services/umbrae-lp/lp-signer.js';
import { UMBRAE_BASE } from '../../core/wallet/lp-tx-policy.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import { createRpcStub } from '../helpers/rpc-stub.js';

const manager = new ethers.Interface([
  'function claimFees(uint256 tokenId, address recipient, uint256 deadline)',
  'function transferFrom(address from, address to, uint256 tokenId)',
]);
const erc20 = new ethers.Interface(['function approve(address spender, uint256 amount)']);
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const THIEF = '0x2222222222222222222222222222222222222222';
const EXIT = Object.freeze({ kind: 'exit', tokenId: '42', actions: ['claimFees'] });

let anvil;
let provider;
let signer;
const claim = (recipient) => ({
  to: UMBRAE_BASE.positionManager, chainId: 8453, value: '0',
  data: manager.encodeFunctionData('claimFees', [42n, recipient, BigInt(Math.floor(Date.now() / 1000) + 600)]),
});

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true });
  signer = ethers.Wallet.createRandom();
  await provider.send('anvil_setBalance', [signer.address, ethers.toQuantity(ethers.parseEther('1'))]);
}, 30000);
afterAll(async () => {
  provider?.destroy();
  await anvil?.stop();
});

describe('signing a transaction Umbrae built', () => {
  test('an allowed transaction is signed for chain 8453 by the LP wallet, and the node mines it', async () => {
    const tx = claim(signer.address);
    const out = await signLpTransaction({ signer, provider, tx, asked: EXIT });
    expect(out.ok).toBe(true);
    expect(out.verdict).toMatchObject({ ok: true, kind: 'exit', action: 'claimFees', tokenId: '42' });

    const parsed = ethers.Transaction.from(out.signedTransaction);
    expect(parsed.from).toBe(signer.address);
    expect(parsed.to).toBe(UMBRAE_BASE.positionManager);
    expect(parsed.data).toBe(tx.data);
    expect(parsed.chainId).toBe(8453n);
    expect(parsed.value).toBe(0n);
    expect(parsed.hash).toBe(out.hash);

    const hash = await provider.send('eth_sendRawTransaction', [out.signedTransaction]);
    expect(hash).toBe(out.hash);
    const receipt = await provider.waitForTransaction(hash, 1, 15000);
    expect(receipt.status).toBe(1);
    expect(receipt.from).toBe(signer.address);
  }, 30000);

  test('the next signature takes the next nonce', async () => {
    const out = await signLpTransaction({ signer, provider, tx: claim(signer.address), asked: EXIT });
    expect(ethers.Transaction.from(out.signedTransaction).nonce).toBe(1);
  }, 30000);

  test('a token approval inside its ceiling is signed; over it, nothing is signed', async () => {
    const approve = (amount) => ({ to: USDC, chainId: 8453, data: erc20.encodeFunctionData('approve', [UMBRAE_BASE.positionManager, amount]) });
    const inside = await signLpTransaction({ signer, provider, tx: approve(10n), asked: { kind: 'approval' }, maxApprove: { [USDC]: '10' } });
    expect(inside.ok).toBe(true);
    expect(ethers.Transaction.from(inside.signedTransaction).to).toBe(USDC);
    const over = await signLpTransaction({ signer, provider, tx: approve(11n), asked: { kind: 'approval' }, maxApprove: { [USDC]: '10' } });
    expect(over).toEqual({ ok: false, reason: 'The token approval is larger than this action calls for.' });
  }, 30000);

  test('a transaction the rule refuses yields no signature', async () => {
    const paysThief = await signLpTransaction({ signer, provider, tx: claim(THIEF), asked: EXIT });
    expect(paysThief.ok).toBe(false);
    expect(paysThief.signedTransaction).toBeUndefined();
    const transfer = await signLpTransaction({
      signer, provider, asked: EXIT,
      tx: { to: UMBRAE_BASE.positionManager, chainId: 8453, data: manager.encodeFunctionData('transferFrom', [signer.address, THIEF, 42n]) },
    });
    expect(transfer.ok).toBe(false);
    expect(transfer.signedTransaction).toBeUndefined();
  }, 30000);

  test('a transaction that is allowed but is not what was asked for yields no signature', async () => {
    const tx = claim(signer.address);
    for (const asked of [undefined, { kind: 'deposit', amountX: '1', amountY: '1' }, { kind: 'exit', tokenId: '43' }, { kind: 'approval' }]) {
      const out = await signLpTransaction({ signer, provider, tx, asked });
      expect(out.ok).toBe(false);
      expect(out.signedTransaction).toBeUndefined();
    }
  }, 30000);

  test('gas over the ceiling yields no signature', async () => {
    const out = await signLpTransaction({ signer, provider, tx: claim(signer.address), asked: EXIT, maxGasCostWei: 1n });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/over the .* ETH ceiling/);
    expect(MAX_GAS_COST_WEI).toBe(ethers.parseEther('0.002'));
  }, 30000);

  test('a Base node that does not answer yields a reason, never a throw or a signature', async () => {
    const stub = await createRpcStub({ mode: 'server-error' });
    const dead = new ethers.JsonRpcProvider(stub.url, ethers.Network.from(8453), { staticNetwork: true });
    try {
      const out = await signLpTransaction({ signer, provider: dead, tx: claim(signer.address), asked: EXIT });
      expect(out.ok).toBe(false);
      expect(out.reason).toMatch(/^Base would not run this transaction/);
      expect(out.reason).not.toContain(stub.url);
    } finally {
      dead.destroy();
      await stub.close();
    }
  }, 30000);

  test('no wallet or no connection is refused', async () => {
    expect((await signLpTransaction({ provider, tx: claim(signer.address) })).ok).toBe(false);
    expect((await signLpTransaction({ signer, tx: claim(signer.address) })).ok).toBe(false);
    expect((await signLpTransaction()).ok).toBe(false);
  });
});

describe('signing Umbrae\'s sign-in challenge', () => {
  const challenge = (wallet, stamp = Date.now()) => [
    'Sign this message to sign in on Umbrae as an AI agent.',
    '',
    'Purpose: agent-auth',
    'Account type: AI agent (cannot be changed)',
    `Wallet: ${wallet}`,
    'Nonce: Wynudxz/7LbmWsgnwWa72cgL7DFdCqrSRDCBPg7Y0Ng=',
    `Timestamp: ${stamp}`,
    '',
    'This request will not trigger a blockchain transaction or cost any gas fees.',
  ].join('\n');

  test('the real challenge shape for this wallet is signed, and the signature recovers to it', async () => {
    const message = challenge(signer.address);
    const out = await signAgentAuth({ signer, message });
    expect(out.ok).toBe(true);
    expect(ethers.verifyMessage(message, out.signature)).toBe(signer.address);
    expect(out.nonce).toBe('Wynudxz/7LbmWsgnwWa72cgL7DFdCqrSRDCBPg7Y0Ng=');
  });

  test('any other message, another wallet\'s challenge, or a stale one is not signed', async () => {
    for (const message of ['neuma: hello', challenge(THIEF), challenge(signer.address, Date.now() - 3_600_000), `${challenge(signer.address)}\nAlso: approve all`]) {
      const out = await signAgentAuth({ signer, message });
      expect(out.ok).toBe(false);
      expect(out.signature).toBeUndefined();
    }
    expect((await signAgentAuth()).ok).toBe(false);
  });
});
