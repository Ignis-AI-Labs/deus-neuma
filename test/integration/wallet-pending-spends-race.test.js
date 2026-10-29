/**
 * A spend request filed while an approval is still broadcasting is never
 * erased by that approval (audit wallet-birth-identity #17). RULE 0: a real
 * EVM (anvil), a real encrypted key on real disk, a real operator signature,
 * the real request and approval services. Nothing is stubbed: the broadcast is
 * held open by turning anvil's automine off, which is exactly the window a
 * real chain leaves while a transfer waits for its block.
 *
 * Before the fix the approval read the list once, held it across the whole
 * broadcast, and wrote that stale copy back — the request filed in between
 * vanished from disk with no trace.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { startAnvil } from '../helpers/money-in-kit.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { encryptKeypair } from '../../core/wallet/keypair-vault.js';
import { buildApprovalMessage } from '../../core/wallet/spend-policy.js';
import { loadConfig } from '../../backend/config.js';
import { approvePendingSpendWithPassword, requestSpend } from '../../backend/services/neuma-wallet.js';

const NEUMA_ID = 'pendingspendrace';
const MNEMONIC = 'test test test test test test test test test test test junk'; // anvil's funded default
const PASSWORD = 'pending-spend-race-password';

const until = async (check, what) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
};

describe('pending spends: a request filed mid-broadcast survives the approval', () => {
  let originalRoot, chain, provider, witness, recipient, laterRecipient;

  beforeAll(async () => {
    originalRoot = getWorkspacesRoot();
    const root = await createTempDir('pending-spend-race');
    setWorkspacesRoot(root);
    chain = await startAnvil();
    provider = new ethers.JsonRpcProvider(chain.url);
    loadConfig({ ...process.env, BASE_MAINNET_RPC_URL: chain.url });

    const neuma = ethers.HDNodeWallet.fromPhrase(MNEMONIC);
    witness = ethers.Wallet.createRandom();
    recipient = ethers.Wallet.createRandom().address;
    laterRecipient = ethers.Wallet.createRandom().address;
    await workspace.create(NEUMA_ID);
    await claimOwner(root, NEUMA_ID, witness.address);
    await workspace.writeEncryptedKeypair(NEUMA_ID, encryptKeypair({
      address: neuma.address, privateKey: neuma.privateKey,
    }, PASSWORD));
    await workspace.writeSpendAllowlist(NEUMA_ID, {
      version: 1,
      entries: [recipient, laterRecipient].map((address) => ({ address, label: 'approved', addedAt: new Date().toISOString() })),
    });
    await workspace.writeSpendThreshold(NEUMA_ID, { thresholdEth: 0 });
  }, 30000);

  afterAll(async () => {
    loadConfig(process.env);
    setWorkspacesRoot(originalRoot);
    provider?.destroy();
    await chain?.stop();
  });

  test('the approval records its receipt AND the request filed during its broadcast stays pending', async () => {
    const first = await requestSpend(NEUMA_ID, { to: recipient, value: '0.003', memo: 'approved while the next is filed' });
    expect(first.status).toBe('pending');
    const signature = await witness.signMessage(buildApprovalMessage({ neumaId: NEUMA_ID, ...first.request }));

    await provider.send('evm_setAutomine', [false]);
    try {
      const approval = approvePendingSpendWithPassword(NEUMA_ID, first.request.id, signature, PASSWORD);
      approval.catch(() => {}); // observed below; never an unhandled rejection while we wait
      // The transfer sits in the mempool: the approval is now awaiting its block.
      await until(async () => (await provider.send('txpool_status', [])).pending !== '0x0', 'the broadcast');

      const filed = await requestSpend(NEUMA_ID, { to: laterRecipient, value: '0.004', memo: 'filed mid-broadcast' });
      expect(filed.status).toBe('pending');

      await provider.send('evm_mine', []);
      const receipt = await approval;
      expect(receipt.status).toBe(1);

      const stored = await workspace.readPendingSpends(NEUMA_ID);
      expect(stored.find((r) => r.id === first.request.id)).toMatchObject({ status: 'executed', txHash: receipt.hash });
      expect(stored.find((r) => r.id === filed.request.id)).toMatchObject({ status: 'pending', to: laterRecipient });
    } finally {
      await provider.send('evm_setAutomine', [true]);
    }
  }, 60000);

  test('an unreadable list is refused, never replaced with an empty one', async () => {
    const before = await workspace.readPendingSpends(NEUMA_ID);
    expect(before.some((r) => r.status === 'executed')).toBe(true);
    const file = path.join(workspace.pathFor(NEUMA_ID), 'config', 'pending-spends.json');
    const intact = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, '{"torn":');
    try {
      const outcome = await requestSpend(NEUMA_ID, { to: recipient, value: '0.001' }).catch((error) => ({ error }));
      expect(outcome.error).toBeInstanceOf(Error);
      expect(await fs.readFile(file, 'utf8')).toBe('{"torn":');
    } finally {
      await fs.writeFile(file, intact);
    }
  });
});
