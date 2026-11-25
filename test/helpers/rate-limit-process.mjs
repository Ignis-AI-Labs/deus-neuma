import process from 'node:process';
import console from 'node:console';
import { setTimeout } from 'node:timers';
import { ethers } from 'ethers';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { cacheDecryptedKey } from '../../backend/routes/neuma-auth-routes.js';
import { sendTransaction } from '../../backend/services/neuma-wallet-spend.js';
import { loadConfig } from '../../backend/config.js';

setWorkspacesRoot(process.env.RATE_LIMIT_ROOT);
loadConfig({ ...process.env, NODE_ENV: 'test', BASE_MAINNET_RPC_URL: process.env.RATE_LIMIT_ANVIL, BASE_PUBLIC_RPC_URL: '' });
const neuma = ethers.HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
let sent = 0; let refusal = null;
for (let i = 0; i < Number(process.env.RATE_LIMIT_ATTEMPTS || 11); i += 1) {
  try {
    cacheDecryptedKey('rate-limit-proof', { address: neuma.address, publicKey: neuma.publicKey, privateKey: neuma.privateKey });
    await sendTransaction('rate-limit-proof', { to: process.env.RATE_LIMIT_RECIPIENT, value: '0.000001' });
    await new Promise((resolve) => { setTimeout(resolve, 350); });
    sent += 1;
  } catch (error) {
    refusal = error.message;
    break;
  }
}
console.log(JSON.stringify({ sent, refusal }));
process.exit(0);
