import { beforeAll, afterAll, test, expect } from 'vitest';
import { ethers } from 'ethers';
import { startAnvil, miniErc20Initcode, MINI_ERC20_ABI } from '../helpers/money-in-kit.js';
import { swapOutputFromReceipt } from '../../core/wallet/swap-receipt.js';

let anvil;
let provider;
let signer;
const nonce = () => provider.send('eth_getTransactionCount', [signer.address, 'pending']).then(Number);
const transferTopic = ethers.id('Transfer(address,address,uint256)');
const emitTransfer = (from, to, amount) => ethers.concat([
  '0x60', ethers.toBeHex(amount, 1), '0x60', '0x00', '0x52', '0x60', ethers.toBeHex(amount, 1),
  '0x73', to, '0x73', from, '0x7f', transferTopic, '0x60', '0x20', '0x60', '0x00', '0xa3',
]);

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true });
  signer = ethers.HDNodeWallet.fromPhrase('test test test test test test test test test test test junk').connect(provider);
});

afterAll(async () => {
  provider?.destroy();
  await anvil?.stop();
});

test('swap output is scoped to the target transaction, token, and recipient', async () => {
  const deployed = await (await signer.sendTransaction({ data: miniErc20Initcode(1_000_000n), nonce: await nonce() })).wait();
  const token = deployed.contractAddress;
  const recipient = ethers.Wallet.createRandom().address;
  const contract = new ethers.Contract(token, MINI_ERC20_ABI, signer);

  const targetReceipt = await (await contract.transfer(recipient, 100n, { nonce: await nonce() })).wait();
  const unrelatedReceipt = await (await contract.transfer(recipient, 25n, { nonce: await nonce() })).wait();
  expect(swapOutputFromReceipt({ receipt: targetReceipt, tokenOut: token, wallet: recipient, sources: new Set([signer.address]) })).toBe('100');
  expect(swapOutputFromReceipt({ receipt: unrelatedReceipt, tokenOut: token, wallet: recipient, sources: new Set([signer.address]) })).toBe('25');
  expect(swapOutputFromReceipt({ receipt: targetReceipt, tokenOut: token, wallet: signer.address })).toBeNull();

  const other = await (await signer.sendTransaction({ data: miniErc20Initcode(1_000_000n), nonce: await nonce() })).wait();
  expect(swapOutputFromReceipt({ receipt: targetReceipt, tokenOut: other.contractAddress, wallet: recipient, sources: new Set([signer.address]) })).toBeNull();
});


test('unrelated transfers to the wallet do not inflate route proceeds', async () => {
  const token = ethers.Wallet.createRandom().address;
  const recipient = ethers.Wallet.createRandom().address;
  const otherSource = ethers.Wallet.createRandom().address;
  await provider.send('anvil_setCode', [token, ethers.concat([
    emitTransfer(signer.address, recipient, 100), emitTransfer(otherSource, recipient, 25), '0x600160005260206000f3',
  ])]);
  const receipt = await (await signer.sendTransaction({ to: token, value: 0n })).wait();
  expect(receipt.logs).toHaveLength(2);
  expect(swapOutputFromReceipt({ receipt, tokenOut: token, wallet: recipient, sources: new Set([signer.address]) })).toBe('100');
});
