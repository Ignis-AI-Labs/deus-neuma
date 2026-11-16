import process from 'node:process';
import console from 'node:console';
import { ethers } from 'ethers';
import { signLpTransaction } from '../../backend/services/umbrae-lp/lp-signer.js';
import { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

setWorkspacesRoot(process.env.NONCE_WORKSPACE_ROOT);
const signer = ethers.HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
const provider = new ethers.JsonRpcProvider(process.env.NONCE_ANVIL, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 50 });
const recipient = process.env.NONCE_RECIPIENT;
const amount = '1000';
const out = await signLpTransaction({
  signer, provider,
  tx: { to: recipient, data: '0x', value: amount, chainId: 8453 },
  asked: { kind: 'transfer', to: recipient, token: null, amount },
  recipients: new Set([recipient]),
});
if (!out.ok) throw new Error(out.reason);
console.log(JSON.stringify({ signedTransaction: out.signedTransaction }));
provider.destroy();
process.exit(0);
