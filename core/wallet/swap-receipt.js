import { ethers } from 'ethers';

const TRANSFER = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);

export const swapOutputFromReceipt = ({ receipt, tokenOut, wallet }) => {
  if (!receipt || !ethers.isAddress(tokenOut) || !ethers.isAddress(wallet)) return null;
  const token = ethers.getAddress(tokenOut);
  const receiver = ethers.getAddress(wallet).toLowerCase();
  let output = 0n;
  let found = false;
  for (const log of receipt.logs ?? []) {
    if (!ethers.isAddress(log.address) || ethers.getAddress(log.address) !== token) continue;
    try {
      const event = TRANSFER.parseLog(log);
      if (event.args.to.toLowerCase() !== receiver) continue;
      output += event.args.value;
      found = true;
    } catch {
      return null;
    }
  }
  return found ? output.toString() : null;
};
