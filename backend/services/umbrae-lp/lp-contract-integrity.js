import { ethers } from 'ethers';
import { UMBRAE_FACTORY } from '../../../core/wallet/pool-policy.js';
import { UMBRAE_ROUTER } from '../../../core/wallet/trade-policy.js';
import { UMBRAE_BASE } from '../../../core/wallet/lp-tx-policy.js';

const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const PROXY_CODE = '0x2c32c32e01d4d32f6e4772c83ec9655b4a606c8db6f5f9dad30fed12cf7fdf10';

// Read-only Base proof, 2026-11-17: proxy code, implementation code, and factory code.
export const UMBRAE_CODE_PINS = Object.freeze({
  positionManager: Object.freeze({
    address: UMBRAE_BASE.positionManager,
    implementation: '0x5a3675Ee2A4447031fA8F52e88D77578973d2e91',
    proxyCode: PROXY_CODE,
    implementationCode: '0xad1d51a6cec3c51a63fe4e72a3456cc8f191dc3742bb0946ae29f2216555f5ac',
  }),
  router: Object.freeze({
    address: UMBRAE_ROUTER,
    implementation: '0x9cF4eBa914c67966De2A20e44eD8D864fF306e38',
    proxyCode: PROXY_CODE,
    implementationCode: '0x4ea033b1b36e532969914fe5f58b6e108522c438c38c1b0cb333cabc1d00d31b',
  }),
  factory: Object.freeze({
    address: UMBRAE_FACTORY,
    code: '0x3d5937c30e4bef59d792b28b377ba08051d5d2c58f4a714ea1b8085ef449ad73',
  }),
});

const productionProviders = new WeakMap();
export const markLpProductionProvider = (provider) => {
  if (provider && !productionProviders.has(provider)) productionProviders.set(provider, UMBRAE_CODE_PINS);
  return provider;
};

// A real local chain may register the executable code it actually runs; production keeps the Base pins.
export const pinLpProductionProvider = (provider, pins) => {
  productionProviders.set(provider, pins);
  return provider;
};

const same = (a, b) => ethers.isAddress(a) && ethers.isAddress(b) && ethers.getAddress(a) === ethers.getAddress(b);
const required = (verdict) => {
  if (['deposit', 'exit'].includes(verdict?.kind)) return ['positionManager'];
  if (verdict?.kind === 'create-pool') return ['factory'];
  if (verdict?.kind === 'swap') return verdict.via === 'kyberswap' ? [] : ['router'];
  if (verdict?.kind !== 'approval') return [];
  return Object.entries(UMBRAE_CODE_PINS).filter(([, pin]) => same(verdict.spender, pin.address)).map(([name]) => name);
};

const verifyPin = async (provider, pin) => {
  const code = await provider.send('eth_getCode', [pin.address, 'latest']);
  if (pin.code) return ethers.keccak256(code) === pin.code;
  if (ethers.keccak256(code) !== pin.proxyCode) return false;
  const slot = await provider.send('eth_getStorageAt', [pin.address, IMPLEMENTATION_SLOT, 'latest']);
  const implementation = ethers.getAddress(ethers.dataSlice(slot, 12));
  if (implementation !== pin.implementation) return false;
  return ethers.keccak256(await provider.send('eth_getCode', [implementation, 'latest'])) === pin.implementationCode;
};

// impure — injected local-chain providers are unmarked; every normal live LP provider is marked by lpBase.
export const assertUmbraeContractIntegrity = async (provider, verdict, pins = null) => {
  if (!productionProviders.has(provider)) return Object.freeze({ ok: true });
  const expected = pins ?? productionProviders.get(provider);
  try {
    for (const name of required(verdict)) {
      if (!(await verifyPin(provider, expected[name]))) {
        return Object.freeze({ ok: false, reason: `Umbrae's ${name} code has changed. Nothing was signed; the new implementation needs review.` });
      }
    }
    return Object.freeze({ ok: true });
  } catch (error) {
    return Object.freeze({ ok: false, reason: `Umbrae's contract code could not be verified. Nothing was signed: ${error.shortMessage || error.message}` });
  }
};
