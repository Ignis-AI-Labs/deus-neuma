import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ethers } = require('ethers');
const vaultCrypto = require('../../electron/wallet/vault-crypto.cjs');
const vaultStore = require('../../electron/wallet/vault-store.cjs');

const file = process.env.WALLET_VAULT_FILE;
const password = process.env.WALLET_VAULT_PASSWORD;
if (!file || !password) throw new Error('Missing vault-writer configuration');
const wallet = ethers.Wallet.createRandom();
const payload = { type: 'privateKey', secret: wallet.privateKey };
const params = { N: 1024, r: 8, p: 1, dkLen: 32 };
let count = 0;
console.log(JSON.stringify({ ready: true, address: wallet.address }));
for (;;) {
  const sealed = vaultCrypto.createVault(payload, password, { params, address: wallet.address });
  const envelope = { ...sealed, padding: 'x'.repeat(8 * 1024 * 1024), writeSequence: count++ };
  vaultStore.writeVault(file, envelope, { available: false });
}
