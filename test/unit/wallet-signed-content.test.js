// What the trusted confirm window shows is what the wallet signs (audit PR600 P6-09). Real ethers,
// the real view builders, the real wallet service on a real vault, and a real chain node (anvil)
// for the send. The person's answer is the service's injected `confirm` (the window itself needs
// Electron); it records the request it was handed, which is the request the window would draw.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ethers } from 'ethers';
import { startAnvil } from '../helpers/money-in-kit.js';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { buildSignConfirmView, isSignInMessage, MAX_SHOWN } = require('../../electron/wallet/confirm-view.cjs');
const { normalizeTxRequest, decodeCall } = require('../../electron/wallet/tx-content.cjs');
const { readMessage, parseSignIn } = require('../../electron/wallet/message-content.cjs');
const { createWalletService } = require('../../electron/wallet/wallet-service.cjs');

const ERC20 = new ethers.Interface(['function approve(address spender, uint256 amount)', 'function transfer(address to, uint256 amount)']);
const TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BAD = '0xBAD0000000000000000000000000000000000BAD';
const row = (view, label) => view.fields.find((f) => f.label === label)?.value;

describe('a transaction is shown whole', () => {
  it('an unlimited approval reads as words: the call, the spender, UNLIMITED, and a warning', () => {
    const data = ERC20.encodeFunctionData('approve', [BAD, ethers.MaxUint256]);
    const view = buildSignConfirmView({ type: 'transaction', ...normalizeTxRequest({ to: TOKEN, data }, 8453) });
    expect(row(view, 'CALL')).toBe('approve(address spender, uint256 amount)');
    expect(view.body).toContain(`spender: ${ethers.getAddress(BAD)}`);
    expect(view.body).toMatch(/amount: UNLIMITED/);
    expect(view.body).toContain(`data: ${data}`); // the whole calldata, never a clipped row
    expect(view.tone).toBe('alert');
    expect(view.warning).toContain(ethers.getAddress(BAD));
    expect(view.warning).toMatch(/UNLIMITED/);
  });

  it('a call the wallet cannot read, or bytes hidden after a readable one, is refused', () => {
    expect(() => normalizeTxRequest({ to: TOKEN, data: '0xdeadbeef' }, 8453)).toThrow(/cannot read/);
    const padded = `${ERC20.encodeFunctionData('transfer', [BAD, 5n])}deadbeef`;
    expect(decodeCall(padded)).toBeNull();
    expect(() => normalizeTxRequest({ to: TOKEN, data: padded }, 8453)).toThrow(/cannot read/);
    expect(() => buildSignConfirmView({ type: 'transaction', to: TOKEN, data: '0xdeadbeef' })).toThrow(/cannot read/);
  });

  it('the app\'s own contract calls are read from its packaged ABIs', () => {
    const abi = JSON.parse(fs.readFileSync('docs/contracts/abis/HouseRegistry.json', 'utf8')).abi;
    const iface = new ethers.Interface(abi);
    const leave = iface.getFunction('leaveHouse');
    const args = leave.inputs.map((input) => (input.type === 'address' ? BAD : input.type.startsWith('bytes') ? ethers.ZeroHash : 1n));
    expect(decodeCall(iface.encodeFunctionData(leave, args))?.name).toBe('leaveHouse');
  });

  it('a fee or nonce the caller sets has a row; a field with no row, another chain or no recipient is refused', () => {
    const tx = normalizeTxRequest({ to: BAD, value: '0x1', gasLimit: 21000, maxFeePerGas: ethers.parseUnits('5000', 'gwei'), nonce: 7 }, 8453);
    const view = buildSignConfirmView({ type: 'transaction', ...tx });
    expect(row(view, 'VALUE')).toBe('0.000000000000000001 ETH');
    expect(row(view, 'MAX FEE')).toBe('0.105 ETH');
    expect(row(view, 'NONCE')).toBe('7');
    expect(view.tone).toBe('alert');
    expect(view.warning).toMatch(/0\.105 ETH/);
    for (const hidden of [{ accessList: [] }, { authorizationList: [{}] }, { customData: {} }, { input: '0x00' }]) {
      expect(() => normalizeTxRequest({ to: BAD, ...hidden }, 8453)).toThrow(/cannot show you/);
    }
    expect(() => normalizeTxRequest({ to: BAD, chainId: 1 }, 8453)).toThrow(/chain 1/);
    expect(() => normalizeTxRequest({ value: 1 }, 8453)).toThrow(/no valid address/);
    expect(Object.keys(normalizeTxRequest({ to: BAD, gas: '0xffffff' }, 8453))).not.toContain('gas');
  });
});

describe('typed data is shown whole, in the order its type declares', () => {
  const domain = { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: TOKEN };
  const types = { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
  const owner = ethers.Wallet.createRandom().address;

  it('a spender pushed behind 600 characters of padding is still shown, and warned about', () => {
    // The audit's shape: the requester orders the keys, and an unsigned key pads the signed ones out of sight.
    const value = { padding: 'x'.repeat(700), deadline: 1n, nonce: 0n, value: ethers.MaxUint256, spender: BAD, owner };
    const view = buildSignConfirmView({ type: 'signTypedData', domain, types, value, chainId: 8453 });
    expect(view.body.split('\n').slice(0, 4)).toEqual(['Permit', `  owner: ${owner}`, `  spender: ${BAD}`, expect.stringMatching(/^ {2}value: UNLIMITED/)]);
    expect(view.body).not.toContain('xxxx'); // what is not signed is not shown
    expect(row(view, 'TYPE')).toBe('Permit');
    expect(row(view, 'VERSION')).toBe('2');
    expect(view.tone).toBe('alert');
    expect(view.warning).toContain(BAD);
  });

  it('data for another chain is warned about; data that does not fit its types is refused', () => {
    const value = { owner, spender: BAD, value: 1n, nonce: 0n, deadline: 1n };
    expect(buildSignConfirmView({ type: 'signTypedData', domain: { ...domain, chainId: 1 }, types, value, chainId: 8453 }).warning).toMatch(/chain 1, and the wallet is on chain 8453/);
    expect(() => buildSignConfirmView({ type: 'signTypedData', domain, types, value: { owner } })).toThrow();
  });

  it('nested types and lists keep every field', () => {
    const nested = { Order: [{ name: 'maker', type: 'address' }, { name: 'items', type: 'Item[]' }], Item: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }] };
    const view = buildSignConfirmView({ type: 'signTypedData', domain: { name: 'Shop' }, types: nested, value: { items: [{ amount: 3n, token: TOKEN }], maker: owner } });
    expect(view.body).toBe(['Order', `  maker: ${owner}`, '  items:', '    [0]: Item', `      token: ${TOKEN}`, '      amount: 3'].join('\n'));
  });
});

describe('messages', () => {
  it('raw bytes handed over as a byte list are warned about, exactly like the same bytes as hex', () => {
    const bytes = Uint8Array.from([0xff, 0x01, 0xfe, 0x02]);
    for (const message of [bytes, Array.from(bytes), '0xff01fe02']) {
      const view = buildSignConfirmView({ type: 'sign', message });
      expect(view.tone).toBe('alert');
      expect(view.warning).toMatch(/unreadable/i);
      expect(view.body).toBe('0xff01fe02');
    }
    expect(Array.from(readMessage(bytes).sign)).toEqual(Array.from(bytes));
    expect(buildSignConfirmView({ type: 'sign', message: ethers.hexlify(ethers.toUtf8Bytes('ok\u0000hidden')) }).tone).toBe('alert');
    expect(() => readMessage({ toString: () => 'hello' })).toThrow(/not a message/);
    expect(() => readMessage('0xzz')).toThrow(/not valid hex/);
  });

  it('a long message is shown whole, and one too long to show is refused', () => {
    const long = `${'A'.repeat(5000)} THE END`;
    expect(buildSignConfirmView({ type: 'sign', message: long }).body).toBe(long);
    expect(() => buildSignConfirmView({ type: 'sign', message: 'A'.repeat(MAX_SHOWN + 1) })).toThrow(/too long/);
  });

  it('SIGN IN is only a whole sign-in challenge for this wallet', async () => {
    const { generateChallenge } = await import('../../backend/services/auth.js');
    const address = ethers.Wallet.createRandom().address;
    const challenge = generateChallenge(address);
    expect(parseSignIn(challenge).address.toLowerCase()).toBe(address.toLowerCase());
    const view = buildSignConfirmView({ type: 'sign', message: challenge, address });
    expect(view.heading).toBe('SIGN IN');
    expect(row(view, 'SITE')).toBe(parseSignIn(challenge).domain);
    expect(view.body).toBe(challenge);
    // The audit's shape: the phrase on the first line, anything at all after it.
    const dressed = 'evil.example wants you to sign in with your Ethereum account:\nI authorize the transfer of all my tokens to 0xBAD';
    expect(buildSignConfirmView({ type: 'sign', message: dressed, address }).heading).toBe('SIGN MESSAGE');
    expect(isSignInMessage(`${challenge}\nI also authorize a transfer`, address)).toBe(false);
    expect(isSignInMessage(challenge, ethers.Wallet.createRandom().address)).toBe(false); // another wallet's challenge
    expect(isSignInMessage(challenge, undefined)).toBe(false);
  });
});

// A real local chain (anvil, from Foundry) signs and mines these. A machine without it, like the public
// repository's checks, cannot run them, and says so as skipped rather than as a failure of the wallet.
const HAS_ANVIL = spawnSync('anvil', ['--version']).status === 0;
describe.skipIf(!HAS_ANVIL)('the wallet service signs the request it showed', () => {
  let anvil, provider, dir, service, shown, address;
  beforeAll(async () => {
    anvil = await startAnvil({ chainId: 8453 });
    provider = new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuma-wallet-shown-'));
    shown = [];
    service = createWalletService({
      walletDir: dir, outerSeal: { available: false }, scryptParams: { N: 1024, r: 8, p: 1, dkLen: 32 },
      getRpcProvider: async () => provider, getChainId: () => 8453,
      confirm: async (req) => { shown.push(buildSignConfirmView(req)); return true; },
    });
    ({ address } = service.create('a-strong-operator-passphrase'));
    await provider.send('anvil_setBalance', [address, ethers.toQuantity(ethers.parseEther('1'))]);
  }, 30000);
  afterAll(async () => {
    provider?.destroy();
    await anvil?.stop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the fee and nonce on the chain are the ones in the window', async () => {
    const hash = await service.sendTransaction({ to: BAD, value: '0x1', gasLimit: 30000, maxFeePerGas: ethers.parseUnits('40', 'gwei'), maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'), nonce: 0 });
    const mined = await provider.getTransaction(hash);
    const view = shown.at(-1);
    expect(row(view, 'MAX FEE')).toBe(`${ethers.formatEther(mined.gasLimit * mined.maxFeePerGas)} ETH`);
    expect(row(view, 'NONCE')).toBe(String(mined.nonce));
    expect(row(view, 'TO')).toBe(mined.to);
    expect(mined.chainId).toBe(8453n);
  }, 30000);

  it('an unreadable call, a hidden field or bytes that are no message raise no window and sign nothing', async () => {
    const [asked, nonce] = [shown.length, await provider.getTransactionCount(address)];
    await expect(service.sendTransaction({ to: TOKEN, data: '0xdeadbeef' })).rejects.toThrow(/cannot read/);
    await expect(service.sendTransaction({ to: BAD, authorizationList: [{}] })).rejects.toThrow(/cannot show you/);
    await expect(service.signMessage({ any: 'thing' })).rejects.toThrow(/not a message/);
    await expect(service.signTypedData({ name: 'x' }, { A: [{ name: 'n', type: 'uint256' }] }, {})).rejects.toThrow();
    expect(shown.length).toBe(asked);
    expect(await provider.getTransactionCount(address)).toBe(nonce);
  }, 30000);

  it('bytes are signed as the bytes that were shown', async () => {
    const bytes = Uint8Array.from([0xff, 0x01, 0xfe, 0x02]);
    const signature = await service.signMessage(bytes);
    expect(shown.at(-1).body).toBe('0xff01fe02');
    expect(ethers.verifyMessage(bytes, signature)).toBe(address);
  });
});
