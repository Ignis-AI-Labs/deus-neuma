import { ethers } from 'ethers';

const SECONDARY_URL = 'https://base-rpc.publicnode.com';
const FALLBACK_URL = 'https://mainnet.base.org';
const providerUrl = (provider) => provider._getConnection().url;

// impure — a separate endpoint for independent transaction evidence, or null
// when the only available answer would be the same server.
export const independentReceiptProvider = (primary) => {
  const primaryUrl = providerUrl(primary);
  const configured = process.env.NEUMA_BASE_RECEIPT_RPC_URL || SECONDARY_URL;
  const candidates = [configured, configured === primaryUrl ? FALLBACK_URL : configured];
  const url = candidates.find((candidate) => candidate && candidate !== primaryUrl);
  return url ? new ethers.JsonRpcProvider(url, ethers.Network.from(8453), { staticNetwork: true }) : null;
};

// impure — matching inclusion evidence from two endpoints and enough depth.
export const proveLpReceipt = async ({ primary, secondary, hash, minConfirmations, timeoutMs = 0 }) => {
  const depth = minConfirmations ?? Number(process.env.NEUMA_BASE_RECEIPT_CONFIRMATIONS ?? 2);
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash) || !Number.isSafeInteger(depth) || depth < 1) {
    return { ok: false, uncertain: true };
  }
  const other = secondary ?? independentReceiptProvider(primary);
  if (!other) return { ok: false, uncertain: true };
  const ownsSecondary = secondary === undefined;
  try {
    for (const until = Date.now() + timeoutMs;;) {
      const [a, b] = await Promise.all([
        primary.send('eth_getTransactionReceipt', [hash]),
        other.send('eth_getTransactionReceipt', [hash]),
      ]);
      if (!a || !b) return { ok: false, uncertain: true };
      if (a.transactionHash !== hash || b.transactionHash !== hash || !a.blockHash || a.blockHash !== b.blockHash
          || a.blockNumber !== b.blockNumber || Number(a.status) !== 1 || Number(b.status) !== 1) {
        return { ok: false, uncertain: true };
      }
      if (JSON.stringify(a.logs) !== JSON.stringify(b.logs)) return { ok: false, uncertain: true };
      const [heightA, heightB] = await Promise.all([
        primary.send('eth_blockNumber', []), other.send('eth_blockNumber', []),
      ]);
      const block = Number(a.blockNumber);
      const height = Math.min(Number(heightA), Number(heightB));
      if (Number.isSafeInteger(block) && block >= 0 && height >= block + depth - 1) {
        return { ok: true, receipt: a };
      }
      if (Date.now() >= until) return { ok: false, uncertain: true };
      await new Promise((resolve) => { setTimeout(resolve, 500); });
    }
  } catch {
    return { ok: false, uncertain: true };
  } finally {
    if (ownsSecondary) other.destroy();
  }
};
