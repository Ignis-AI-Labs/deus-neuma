import { ethers } from 'ethers';
import { returnContract } from './evm-return-contract.js';
import { POOL, WETH, USDC } from './umbrae-stand-in.js';

/** A local pool with the token identity and active bin the price verifier reads. */
export const installPricePool = async (provider, activeId = 8_388_608) => {
  const active = ethers.AbiCoder.defaultAbiCoder().encode(['uint24'], [activeId]);
  const quote = ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(uint16,uint16,uint16,uint16,uint16,uint24,uint16)', 'uint128', 'uint24', 'uint40', 'uint256', 'uint256', 'address'],
    [[5000, 0, 0, 0, 0, 0, 0], 0, 0, 0, 0, 0, ethers.ZeroAddress],
  );
  const routes = {
    [ethers.id('getBinStep()').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['uint16'], [25]),
    [ethers.id('getQuoteState()').slice(0, 10)]: quote,
    [ethers.id('getTokenX()').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [WETH]),
    [ethers.id('getTokenY()').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['address'], [USDC]),
  };
  await provider.send('anvil_setCode', [POOL, returnContract({ fallback: active, routes })]);
};
