import { ethers } from 'ethers';
import { startAnvil, miniErc20Initcode, MINI_ERC20_ABI } from '../helpers/money-in-kit.js';
import { swapOutputFromReceipt } from '../../core/wallet/swap-receipt.js';

let anvil;
let provider;
let signer;
const nonce = () => provider.send('eth_getTransactionCount', [signer.address, 'pending']).then(Number);

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
  expect(swapOutputFromReceipt({ receipt: targetReceipt, tokenOut: token, wallet: recipient })).toBe('100');
  expect(swapOutputFromReceipt({ receipt: unrelatedReceipt, tokenOut: token, wallet: recipient })).toBe('25');
  expect(swapOutputFromReceipt({ receipt: targetReceipt, tokenOut: token, wallet: signer.address })).toBeNull();

  const other = await (await signer.sendTransaction({ data: miniErc20Initcode(1_000_000n), nonce: await nonce() })).wait();
  expect(swapOutputFromReceipt({ receipt: targetReceipt, tokenOut: other.contractAddress, wallet: recipient })).toBeNull();
});
