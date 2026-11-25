import { ethers } from 'ethers';
import { returnContract } from './evm-return-contract.js';
import { UMBRAE_CODE_PINS, pinLpProductionProvider } from '../../backend/services/umbrae-lp/lp-contract-integrity.js';

const CREATE = 'createPositionWithStrategy(address,address,uint16,uint16,uint256,uint256,uint8,uint24,uint8,uint24,bool,uint24,uint24,uint256,address,uint256)';
const INCREASE = 'increasePositionWithStrategy(uint256,uint256,uint256,uint24,bool,uint24,uint24,uint256,uint256)';
const QUOTE_STATE = 'getQuoteState()';
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export const installLpPool = async (provider, address, baseFactor = 5000, tokenX = WETH, tokenY = USDC, binStep = 25, activeId = 8_388_608) => {
  const active = ethers.AbiCoder.defaultAbiCoder().encode(['uint24'], [activeId]);
  const quote = ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(uint16,uint16,uint16,uint16,uint16,uint24,uint16)', 'uint128', 'uint24', 'uint40', 'uint256', 'uint256', 'address'],
    [[baseFactor, 0, 0, 0, 0, 0, 0], 0, 0, 0, 0, 0, ethers.ZeroAddress],
  );
  const routes = {
    [ethers.id('getBinStep()').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['uint16'], [binStep]),
    [ethers.id(QUOTE_STATE).slice(0, 10)]: quote,
    [ethers.id('getTokenX()').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [tokenX]),
    [ethers.id('getTokenY()').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [tokenY]),
  };
  await provider.send('anvil_setCode', [address, returnContract({ fallback: active, routes })]);
};

export const installLpManager = async (provider, address, balance = 0n, position = null) => {
  const distribution = ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256[]'], [0n, [5_000_000n]]);
  const increase = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[5_000_000n]]);
  const close = ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [0n, 5_000_000n]);
  const positionRoutes = position ? {
    [ethers.id('getPosition(uint256)').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [position.pair]),
    [ethers.id('ownerOf(uint256)').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [position.owner]),
  } : {};
  const code = returnContract({
    fallback: close,
    routes: {
      [ethers.id(CREATE).slice(0, 10)]: distribution,
      [ethers.id(INCREASE).slice(0, 10)]: increase,
      [ethers.id('balanceOf(address)').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [balance]),
      ...positionRoutes,
    },
  });
  await provider.send('anvil_setCode', [address, code]);
};


const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

// Register the actual executable fixture on a real local chain, never a production bypass.
export const registerLpIntegrityPins = async (provider) => {
  const implementationCode = '0x6000';
  for (const name of ['positionManager', 'router']) {
    const pin = UMBRAE_CODE_PINS[name];
    await provider.send('anvil_setCode', [pin.implementation, implementationCode]);
    await provider.send('anvil_setStorageAt', [pin.address, IMPLEMENTATION_SLOT, ethers.zeroPadValue(pin.implementation, 32)]);
  }
  const pins = {};
  for (const [name, pin] of Object.entries(UMBRAE_CODE_PINS)) {
    const code = await provider.send('eth_getCode', [pin.address, 'latest']);
    pins[name] = name === 'factory'
      ? { address: pin.address, code: ethers.keccak256(code) }
      : { address: pin.address, implementation: pin.implementation, proxyCode: ethers.keccak256(code), implementationCode: ethers.keccak256(implementationCode) };
  }
  return pinLpProductionProvider(provider, pins);
};
