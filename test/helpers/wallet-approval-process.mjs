import fs from 'node:fs/promises';
import { ethers } from 'ethers';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { cacheDecryptedKey } from '../../backend/routes/neuma-auth-routes.js';
import { sendTransaction } from '../../backend/services/neuma-wallet-spend.js';
import { buildApprovalMessage } from '../../core/wallet/spend-policy.js';
import { loadConfig } from '../../backend/config.js';
import { claimOwner } from './claim-owner.js';

const root = process.env.WALLET_TEST_ROOT;
const stateFile = process.env.WALLET_TEST_STATE;
const phase = process.env.WALLET_TEST_PHASE;
if (!root || !stateFile || !['setup', 'send'].includes(phase)) throw new Error('Missing approval test configuration');

setWorkspacesRoot(root);
loadConfig({ ...process.env, NODE_ENV: 'test', BASE_MAINNET_RPC_URL: process.env.WALLET_TEST_ANVIL, BASE_PUBLIC_RPC_URL: '' });
const neuma = ethers.HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
const neumaId = 'approval-restart-probe';
cacheDecryptedKey(neumaId, { address: neuma.address, publicKey: neuma.publicKey, privateKey: neuma.privateKey });

if (phase === 'setup') {
  const owner = ethers.Wallet.createRandom();
  const recipient = ethers.Wallet.createRandom().address;
  const value = '0.02';
  const approval = { nonce: ethers.hexlify(ethers.randomBytes(16)), expiry: Math.floor(Date.now() / 1000) + 3600 };
  await workspace.create(neumaId);
  await claimOwner(root, neumaId, owner.address);
  await workspace.writeSpendAllowlist(neumaId, { version: 1, entries: [{ address: recipient, label: 'test recipient', addedAt: new Date().toISOString() }] });
  await workspace.writeSpendThreshold(neumaId, { thresholdEth: 0 });
  approval.signature = await owner.signMessage(buildApprovalMessage({ neumaId, to: recipient, value, ...approval }));
  await fs.writeFile(stateFile, JSON.stringify({ recipient, value, approval }));
  console.log(JSON.stringify({ phase, ready: true }));
} else {
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  try {
    const receipt = await sendTransaction(neumaId, { to: state.recipient, value: state.value, approval: state.approval });
    console.log(JSON.stringify({ phase, sent: true, hash: receipt.hash }));
  } catch (error) {
    if (error.message !== 'Operator approval already used') throw error;
    console.log(JSON.stringify({ phase, sent: false, reason: error.message }));
  }
}

process.exit(0);
