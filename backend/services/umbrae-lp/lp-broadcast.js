import { ethers } from 'ethers';
import { readLpCapitalControls } from './lp-capital-controls.js';
import { redactRpcUrl } from '../chain/chain-registry.js';

const privateUrl = () => {
  const raw = process.env.NEUMA_BASE_PRIVATE_RPC_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) return url.href;
  } catch { return null; }
  return null;
};

// impure — reject an unusable required relay before a nonce is reserved.
export const prepareLpBroadcast = async ({ neumaId }) => {
  try {
    const controls = await readLpCapitalControls(neumaId);
    if (!controls.privateBroadcastRequired) return { ok: true };
  } catch (error) {
    return { ok: false, reason: `Capital controls could not be read. Nothing was sent: ${error.message}` };
  }
  const url = privateUrl();
  if (!url) return { ok: false, reason: 'Private broadcast is required, but no valid NEUMA_BASE_PRIVATE_RPC_URL is configured. Nothing was sent.' };
  const relay = new ethers.JsonRpcProvider(url, ethers.Network.from(8453), { staticNetwork: true });
  try {
    const chainId = await relay.send('eth_chainId', []);
    return Number(chainId) === 8453 ? { ok: true } : { ok: false, reason: 'The private relay is not on Base. Nothing was sent.' };
  } catch (error) {
    return { ok: false, reason: `The private relay is unavailable. Nothing was sent: ${redactRpcUrl(error.shortMessage || error.message)}` };
  } finally {
    relay.destroy();
  }
};

// impure — the signed bytes handed to our Base node and, when there is one, a second
// independent node at once (P6-11: a node that keeps a transaction to itself cannot hold it
// back from the chain). Sent when either takes it; throws the first node's reason when neither does.
const sendToBoth = async (provider, second, signedTransaction) => {
  const sends = [provider.broadcastTransaction(signedTransaction)];
  if (second) sends.push(second.send('eth_sendRawTransaction', [signedTransaction]));
  const settled = await Promise.allSettled(sends);
  if (!settled.some((s) => s.status === 'fulfilled')) throw settled[0].reason;
};

// impure — broadcast through the mandatory private lane, or the existing public
// path only when the operator has not required privacy. Never fall back after a private failure.
export const broadcastLpTransaction = async ({ neumaId, signed, provider, keyedSend, second }) => {
  let controls;
  try {
    controls = await readLpCapitalControls(neumaId);
  } catch (error) {
    return { ok: false, sent: false, reason: `Capital controls could not be read. Nothing was sent: ${error.message}` };
  }
  if (!controls.privateBroadcastRequired) {
    try {
      if (keyedSend) {
        const sent = await keyedSend();
        return sent.ok ? { ok: true, hash: signed.hash } : { ok: false, sent: true, uncertain: true, reason: sent.error };
      }
      await sendToBoth(provider, second, signed.signedTransaction);
      return { ok: true, hash: signed.hash };
    } catch (error) {
      return { ok: false, sent: true, uncertain: true, reason: redactRpcUrl(error.shortMessage || error.message) };
    }
  }

  const url = privateUrl();
  if (!url) return { ok: false, sent: false, reason: 'Private broadcast is required, but no valid NEUMA_BASE_PRIVATE_RPC_URL is configured. Nothing was sent.' };
  const relay = new ethers.JsonRpcProvider(url, ethers.Network.from(8453), { staticNetwork: true });
  try {
    const chainId = await relay.send('eth_chainId', []);
    if (Number(chainId) !== 8453) return { ok: false, sent: false, reason: 'The private relay is not on Base. Nothing was sent.' };
    const hash = await relay.send('eth_sendRawTransaction', [signed.signedTransaction]);
    if (hash !== signed.hash) return { ok: false, sent: true, uncertain: true, reason: 'The private relay returned a different transaction hash. Reconcile before retrying.' };
    return { ok: true, hash };
  } catch (error) {
    return { ok: false, sent: true, uncertain: true, reason: redactRpcUrl(error.shortMessage || error.message) };
  } finally {
    relay.destroy();
  }
};
