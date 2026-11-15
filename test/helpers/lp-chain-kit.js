import { ethers } from 'ethers';
import { returnContract } from './evm-return-contract.js';

const CREATE = 'createPositionWithStrategy(address,address,uint16,uint16,uint256,uint256,uint8,uint24,uint8,uint24,bool,uint24,uint24,uint256,address,uint256)';
const INCREASE = 'increasePositionWithStrategy(uint256,uint256,uint256,uint24,bool,uint24,uint24,uint256,uint256)';
const QUOTE_STATE = 'getQuoteState()';

export const installLpPool = async (provider, address, baseFactor = 5000) => {
  const active = ethers.AbiCoder.defaultAbiCoder().encode(['uint24'], [8_388_608]);
  const quote = ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(uint16,uint16,uint16,uint16,uint16,uint24,uint16)', 'uint128', 'uint24', 'uint40', 'uint256', 'uint256', 'address'],
    [[baseFactor, 0, 0, 0, 0, 0, 0], 0, 0, 0, 0, 0, ethers.ZeroAddress],
  );
  await provider.send('anvil_setCode', [address, returnContract({ fallback: active, routes: { [ethers.id(QUOTE_STATE).slice(0, 10)]: quote } })]);
};

export const installLpManager = async (provider, address, balance = 0n) => {
  const distribution = ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256[]'], [0n, [5_000_000n]]);
  const increase = ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[5_000_000n]]);
  const close = ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [0n, 5_000_000n]);
  const code = returnContract({
    fallback: close,
    routes: {
      [ethers.id(CREATE).slice(0, 10)]: distribution,
      [ethers.id(INCREASE).slice(0, 10)]: increase,
      [ethers.id('balanceOf(address)').slice(0, 10)]: ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [balance]),
    },
  });
  await provider.send('anvil_setCode', [address, code]);
};
