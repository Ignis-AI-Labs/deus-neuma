import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ethers } from 'ethers';
import { startAnvil } from '../helpers/money-in-kit.js';
import { assertUmbraeContractIntegrity, markLpProductionProvider, UMBRAE_CODE_PINS } from '../../backend/services/umbrae-lp/lp-contract-integrity.js';
import { signLpTransaction } from '../../backend/services/umbrae-lp/lp-signer.js';
import { UMBRAE_BASE } from '../../core/wallet/lp-tx-policy.js';

const SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const MANAGER_IMPL = '0x1111111111111111111111111111111111111111';
const ROUTER_IMPL = '0x2222222222222222222222222222222222222222';
const MANAGER_CODE = '0x600060005260206000f3';
const ROUTER_CODE = '0x600160005260206000f3';
const FACTORY_CODE = '0x600260005260206000f3';
let anvil;
let provider;

const install = async () => {
  for (const [proxy, implementation, code] of [
    [UMBRAE_BASE.positionManager, MANAGER_IMPL, MANAGER_CODE],
    [UMBRAE_BASE.router, ROUTER_IMPL, ROUTER_CODE],
  ]) {
    await provider.send('anvil_setCode', [proxy, '0x6080']);
    await provider.send('anvil_setCode', [implementation, code]);
    await provider.send('anvil_setStorageAt', [proxy, SLOT, ethers.zeroPadValue(implementation, 32)]);
  }
  await provider.send('anvil_setCode', [UMBRAE_CODE_PINS.factory.address, FACTORY_CODE]);
};

const pins = async () => ({
  positionManager: { address: UMBRAE_BASE.positionManager, implementation: MANAGER_IMPL, proxyCode: ethers.keccak256('0x6080'), implementationCode: ethers.keccak256(MANAGER_CODE) },
  router: { address: UMBRAE_BASE.router, implementation: ROUTER_IMPL, proxyCode: ethers.keccak256('0x6080'), implementationCode: ethers.keccak256(ROUTER_CODE) },
  factory: { address: UMBRAE_CODE_PINS.factory.address, code: ethers.keccak256(FACTORY_CODE) },
});

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 8453 });
  provider = markLpProductionProvider(new ethers.JsonRpcProvider(anvil.url, ethers.Network.from(8453), { staticNetwork: true, pollingInterval: 100 }));
});

afterAll(async () => {
  provider?.destroy();
  await anvil?.stop();
});

describe('P6-30 executable code pins', () => {
  test('matching manager, router, and factory code pass on a real local chain', async () => {
    await install();
    const localPins = await pins();
    expect(await assertUmbraeContractIntegrity(provider, { kind: 'deposit' }, localPins)).toEqual({ ok: true });
    expect(await assertUmbraeContractIntegrity(provider, { kind: 'swap', via: 'umbrae' }, localPins)).toEqual({ ok: true });
    expect(await assertUmbraeContractIntegrity(provider, { kind: 'create-pool' }, localPins)).toEqual({ ok: true });
  });

  test('changed implementation code fails closed', async () => {
    await install();
    await provider.send('anvil_setCode', [MANAGER_IMPL, '0x600360005260206000f3']);
    expect(await assertUmbraeContractIntegrity(provider, { kind: 'exit' }, await pins())).toMatchObject({ ok: false, reason: /positionManager code has changed/ });
  });

  test('changed proxy and factory code fail closed', async () => {
    await install();
    await provider.send('anvil_setCode', [UMBRAE_BASE.router, '0x6081']);
    expect(await assertUmbraeContractIntegrity(provider, { kind: 'swap', via: 'umbrae' }, await pins())).toMatchObject({ ok: false, reason: /router code has changed/ });
    await install();
    await provider.send('anvil_setCode', [UMBRAE_CODE_PINS.factory.address, '0x6003']);
    expect(await assertUmbraeContractIntegrity(provider, { kind: 'create-pool' }, await pins())).toMatchObject({ ok: false, reason: /factory code has changed/ });
  });

  test('the signer consults production pins before producing a signature', async () => {
    await install();
    const signer = ethers.Wallet.createRandom().connect(provider);
    const manager = new ethers.Interface(['function claimFees(uint256 tokenId,address recipient,uint256 deadline)']);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const out = await signLpTransaction({
      signer, provider,
      tx: { to: UMBRAE_BASE.positionManager, chainId: 8453, data: manager.encodeFunctionData('claimFees', [42n, signer.address, deadline]) },
      asked: { kind: 'exit', tokenId: '42', actions: ['claimFees'] },
    });
    expect(out).toMatchObject({ ok: false, reason: /positionManager code has changed/ });
    expect(out.signedTransaction).toBeUndefined();
  });
});
