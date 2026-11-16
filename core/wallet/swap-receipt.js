import { ethers } from 'ethers';

const TRANSFER = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);

export const swapOutputFromReceipt = ({ receipt, tokenOut, wallet, sources }) => {
  if (!receipt || !ethers.isAddress(tokenOut) || !ethers.isAddress(wallet) || !(sources instanceof Set)) return null;
  const token = ethers.getAddress(tokenOut);
  const receiver = ethers.getAddress(wallet).toLowerCase();
  const allowed = new Set([...sources].filter(ethers.isAddress).map((address) => address.toLowerCase()));
  if (allowed.size === 0) return null;
  let output = 0n;
  let found = false;
  for (const log of receipt.logs ?? []) {
    if (!ethers.isAddress(log.address) || ethers.getAddress(log.address) !== token) continue;
    try {
      const event = TRANSFER.parseLog(log);
      if (event.args.to.toLowerCase() !== receiver || !allowed.has(event.args.from.toLowerCase())) continue;
      output += event.args.value;
      found = true;
    } catch {
      return null;
    }
  }
  return found ? output.toString() : null;
};
