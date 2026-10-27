// wallet-client.js — operator-managed spend policy for a neuma.
//
// impure — authed REST to the neuma wallet routes (/api/v1/neuma/:id/wallet/*).
// The operator approves recipients (allowlist), sets the autonomous threshold,
// and resolves exact pending spend requests. Every failure resolves to a safe value
// so the panel degrades gracefully.

// The approval message is built by the SAME pure function the backend verifies
// against — importing it keeps the signed bytes identical on both sides.
import { buildApprovalMessage } from '../../../core/wallet/spend-policy.js';
// Sign through the operator's SELECTED wallet (embedded → main-process IPC on
// desktop, or an external provider in the browser) — never a bare
// window.ethereum, which does not exist in the Electron shell.
import { walletDiscovery } from '../../services/WalletDiscovery.js';
import { ethers } from 'ethers';
import { WALLET_NETWORKS, NETWORK_KEY, browserNetwork, getBrowserNetworkProvider } from '../../services/wallet-browser-network.js';
export { WALLET_NETWORKS } from '../../services/wallet-browser-network.js';
import { validateSendForm, buildSendTx } from './wallet-tx.js';
import { browserRpcStatus, setBrowserRpc, clearBrowserRpc } from './wallet-rpc-browser.js';
import { apiCall, authHeadersOrNull } from '../../utils/http.js';

const base = (neumaId) => `/api/v1/neuma/${neumaId}/wallet`;

// The legacy refusal contract is `body.error || '<literal>'` — apiCall's
// own fallback carries the status (`'<literal> (403)'`), so fold it back to
// the bare literal; a real server refusal text passes through untouched.
const refusalText = (err, fallback) =>
  err.message === `${fallback} (${err.http})` ? fallback : err.message;

/**
 * Unlock a password-secured being's keypair into the backend's memory cache
 * (30-min TTL) so a seal can co-sign. Operator-authenticated; the password
 * never persists on this side.
 * @param {string} neumaId
 * @param {string} password
 * @returns {Promise<{ok:true}|{ok:false,error:string}>}
 */
export const unlockNeumaKey = async (neumaId, password) => {
  try {
    const headers = authHeadersOrNull();
    if (!headers) return { ok: false, error: 'Not authenticated.' };
    await apiCall('POST', '/api/v1/neuma-auth/unlock', { headers, body: { neumaId, password }, errorPrefix: 'Unlock refused.' });
    return { ok: true };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the desk.' };
    return { ok: false, error: refusalText(err, 'Unlock refused.') };
  }
};

/**
 * Recover a being's key with the 8 recovery codes shown once when it was
 * secured. On success the backend caches the decrypted key (same cache the
 * unlock fills) so a seal can co-sign.
 * @param {string} neumaId
 * @param {string[]} recoveryCodes
 * @returns {Promise<{ok:true}|{ok:false,error:string}>}
 */
export const recoverNeumaKey = async (neumaId, recoveryCodes) => {
  try {
    const headers = authHeadersOrNull();
    if (!headers) return { ok: false, error: 'Not authenticated.' };
    await apiCall('POST', `/api/v1/neuma/${neumaId}/recovery/verify-codes`, { headers, body: { recoveryCodes }, errorPrefix: 'Recovery refused.' });
    return { ok: true };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the desk.' };
    return { ok: false, error: refusalText(err, 'Recovery refused.') };
  }
};

/**
 * Reset a being's key password with the 8 recovery codes — the SAME keypair
 * re-encrypted under a new password (a password fix, never a rotation).
 * @param {string} neumaId
 * @param {string[]} recoveryCodes
 * @param {string} newPassword
 * @returns {Promise<{ok:true}|{ok:false,error:string}>}
 */
export const resetNeumaKeyPassword = async (neumaId, recoveryCodes, newPassword) => {
  try {
    const headers = authHeadersOrNull();
    if (!headers) return { ok: false, error: 'Not authenticated.' };
    await apiCall('POST', '/api/v1/neuma-auth/reset-password', { headers, body: { neumaId, recoveryCodes, newPassword }, errorPrefix: 'Reset refused.' });
    return { ok: true };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the desk.' };
    return { ok: false, error: refusalText(err, 'Reset refused.') };
  }
};

/**
 * A neuma's wallet. The selected network rides the read; the reply's
 * `network` names where the balance was actually read (a neuma wallet lives
 * on Base, so another selection is read on Base mainnet), and `balance` is
 * null when the RPC did not answer.
 * @returns {Promise<{address:string,balance:(string|null),network:string}|null>}
 */
export const loadWallet = async (neumaId) => {
  try {
    const headers = authHeadersOrNull();
    if (!neumaId || !headers) return null;
    const { network } = await networkStatus();
    return await apiCall('GET', `${base(neumaId)}?network=${encodeURIComponent(network.key)}`, { headers, strictJson: true });
  } catch { return null; }
};

/**
 * The selected network + the selectable set. Desktop asks main (source of
 * truth, confirm-gated); browser reads localStorage (dev path, defaults to
 * mainnet on anything unknown).
 * @returns {Promise<{network: object, networks: object[]}>}
 */
export const networkStatus = async () => {
  const api = typeof window !== 'undefined' && window.neuma?.wallet?.network;
  if (api) {
    try { return await api.status(); } catch { /* fall through to browser view */ }
  }
  return { network: browserNetwork(), networks: [...WALLET_NETWORKS] };
};

/** Switch networks. Desktop gates it behind the trusted confirm window. */
export const setNetwork = async (key) => {
  const api = typeof window !== 'undefined' && window.neuma?.wallet?.network;
  if (api) {
    try { return await api.set(key); } catch { return { ok: false, error: 'Could not switch networks.' }; }
  }
  if (!WALLET_NETWORKS.some((n) => n.key === key)) return { ok: false, error: `Unknown network '${key}'` };
  try { localStorage.setItem(NETWORK_KEY, key); } catch { /* private mode */ }
  return { ok: true, network: key };
};

// Read through OUR configured Base RPC — on desktop the main process (custom RPC
// → else the selected network's public node); in the browser the user's custom
// RPC (localStorage) or the selected network's public node. NOT the connected
// wallet's own provider, so every read stays on the single configured endpoint.
// impure.
export const readBaseRpc = async (method, params = []) => {
  if (typeof window !== 'undefined' && window.neuma?.wallet?.request) {
    return window.neuma.wallet.request({ method, params });
  }
  return getBrowserNetworkProvider().send(method, params);
};

/**
 * The operator's OWN wallet — address from the connected session, balance read
 * through our Base RPC (custom → public). Degrades gracefully (balance null) on
 * any read failure.
 * @returns {Promise<{address:string,balance:string|null}|null>}
 */
/**
 * Any bare address's wallet — address supplied, balance read through our
 * Base RPC (custom → public). Read-only: an address is all this ever
 * touches. Degrades gracefully (balance null) on any read failure.
 * @param {string} address
 * @returns {Promise<{address:string,balance:string|null}>}
 */
export const loadAddressWallet = async (address) => {
  try {
    const weiHex = await readBaseRpc('eth_getBalance', [address, 'latest']);
    return { address, balance: ethers.formatEther(weiHex) };
  } catch {
    return { address, balance: null };
  }
};

/**
 * The operator's OWN wallet — address from the connected session, balance read
 * through our Base RPC (custom → public). Degrades gracefully (balance null) on
 * any read failure.
 * @returns {Promise<{address:string,balance:string|null}|null>}
 */
export const loadWitnessWallet = async () => {
  const address = localStorage.getItem('walletAddress');
  return address ? loadAddressWallet(address) : null;
};

/** @returns {Promise<Array<{address:string,label:string,addedAt:string}>>} */
export const loadAllowlist = async (neumaId) => {
  try {
    const headers = authHeadersOrNull();
    if (!neumaId || !headers) return [];
    const body = await apiCall('GET', `${base(neumaId)}/allowlist`, { headers, strictJson: true });
    return body.entries || [];
  } catch { return []; }
};

export const addAllowlistEntry = async (neumaId, address, label) => {
  const headers = authHeadersOrNull();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const body = await apiCall('POST', `${base(neumaId)}/allowlist`, { headers, body: { address, label }, errorPrefix: 'Could not add recipient.' });
    return { ok: true, entries: body.entries };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: refusalText(err, 'Could not add recipient.') };
  }
};

export const removeAllowlistEntry = async (neumaId, address) => {
  const headers = authHeadersOrNull();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const body = await apiCall('DELETE', `${base(neumaId)}/allowlist`, { headers, body: { address }, errorPrefix: 'Could not remove recipient.' });
    return { ok: true, entries: body.entries };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: refusalText(err, 'Could not remove recipient.') };
  }
};

/** @returns {Promise<number>} the autonomous threshold in ETH (0 if unset) */
export const loadThreshold = async (neumaId) => {
  try {
    const headers = authHeadersOrNull();
    if (!neumaId || !headers) return 0;
    const body = await apiCall('GET', `${base(neumaId)}/threshold`, { headers, strictJson: true });
    return body.thresholdEth ?? 0;
  } catch { return 0; }
};

export const setThreshold = async (neumaId, thresholdEth) => {
  const headers = authHeadersOrNull();
  if (!headers) return { ok: false, error: 'Not authenticated.' };
  try {
    const body = await apiCall('PUT', `${base(neumaId)}/threshold`, { headers, body: { thresholdEth }, errorPrefix: 'Could not set threshold.' });
    return { ok: true, thresholdEth: body.thresholdEth };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: refusalText(err, 'Could not set threshold.') };
  }
};

/**
 * List exact transfer requests awaiting the operator's decision.
 * @returns {Promise<Array<Object>>}
 */
export const loadPendingSpends = async (neumaId) => {
  try {
    const headers = authHeadersOrNull();
    if (!neumaId || !headers) return [];
    const body = await apiCall('GET', `${base(neumaId)}/pending`, { headers, strictJson: true });
    return body.requests || [];
  } catch { return []; }
};

/**
 * Approve one request exactly as the neuma made it. The operator signature is
 * collected before the key password is sent. The backend decrypts the key only
 * inside this exact approval request and never places it in the unlock cache.
 */
export const approvePendingSpend = async (neumaId, request, password) => {
  const address = localStorage.getItem('walletAddress');
  const selected = walletDiscovery.getPreferredProvider();
  const provider = selected ? selected.provider : null;
  if (!provider || !address) return { ok: false, error: 'Connect your operator wallet to sign.' };
  if (!request?.id || !request.to || !request.value || !request.expiry || !request.nonce) {
    return { ok: false, error: 'The pending request is incomplete. Refresh and try again.' };
  }
  const message = buildApprovalMessage({
    neumaId,
    to: request.to,
    value: request.value,
    expiry: request.expiry,
    nonce: request.nonce,
  });
  let signature;
  try {
    signature = await provider.request({ method: 'personal_sign', params: [message, address] });
  } catch {
    return { ok: false, error: 'Signature was rejected.' };
  }

  try {
    const headers = authHeadersOrNull();
    if (!headers) return { ok: false, error: 'Not authenticated.' };
    const body = await apiCall('POST', `${base(neumaId)}/pending/${encodeURIComponent(request.id)}/approve`, {
      headers, body: { signature, password }, errorPrefix: 'The transfer was not approved.',
    });
    return { ok: true, hash: body.hash };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: refusalText(err, 'The transfer was not approved.') };
  }
};

/** Deny one request — nothing moves; the optional note goes back to the being with the outcome. */
export const rejectPendingSpend = async (neumaId, requestId, note = '') => {
  try {
    const headers = authHeadersOrNull();
    if (!headers) return { ok: false, error: 'Not authenticated.' };
    await apiCall('POST', `${base(neumaId)}/pending/${encodeURIComponent(requestId)}/reject`, { headers, body: note ? { note } : {}, errorPrefix: 'The request was not rejected.' });
    return { ok: true };
  } catch (err) {
    if (!err.http) return { ok: false, error: 'Could not reach the platform.' };
    return { ok: false, error: refusalText(err, 'The request was not rejected.') };
  }
};

// --- Operator's own wallets: list + send ---

/**
 * List the operator's available wallets — the embedded Neuma wallet and any
 * injected providers (Rabby, MetaMask, …) discovered via EIP-6963 — each
 * resolved to its primary account and balance. The active provider is marked.
 *
 * impure — queries each discovered provider's RPC. Per-wallet failures degrade
 * to null fields so one locked wallet never blanks the whole list.
 * @returns {Promise<Array<{rdns:string,name:string,address:string|null,balance:string|null,active:boolean}>>}
 */
export const listMyWallets = async () => {
  const providers = walletDiscovery.getProviders();
  const activeRdns = walletDiscovery.getPreferredProvider()?.info?.rdns ?? null;
  return Promise.all(providers.map(async ({ info, provider }) => {
    let address = null;
    let balance = null;
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      address = Array.isArray(accounts) && accounts[0] ? accounts[0] : null;
      // Balance via OUR Base RPC, not the wallet's own provider, so the list
      // shows Base balances consistently with the header (an external wallet may
      // default to another chain).
      if (address) {
        const weiHex = await readBaseRpc('eth_getBalance', [address, 'latest']);
        balance = ethers.formatEther(weiHex);
      }
    } catch { /* provider locked or not ready — leave fields null */ }
    return { rdns: info.rdns, name: info.name, address, balance, active: info.rdns === activeRdns };
  }));
};

/**
 * Send ETH from the operator's selected wallet. The actual confirmation is owned
 * by that wallet: the embedded wallet shows the Electron main-process native
 * gate; an external wallet shows its own popup. We never hold the key.
 *
 * impure — builds the tx via the shared pure helpers and dispatches
 * eth_sendTransaction through the selected provider. `from` defaults to the
 * provider's own active account (NOT a stale localStorage address) so it always
 * matches the wallet that will sign — external wallets reject a mismatched from.
 * @param {{to:string,amountEth:string|number,balanceEth?:string|number|null,from?:string|null}} args
 * @returns {Promise<{ok:true,hash:string}|{ok:false,error:string}>}
 */
export const sendEth = async ({ to, amountEth, balanceEth = null, from = null }) => {
  const selected = walletDiscovery.getPreferredProvider();
  const provider = selected ? selected.provider : null;
  if (!provider) return { ok: false, error: 'Connect your wallet to send.' };
  let sender = from;
  if (!sender) {
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      sender = Array.isArray(accounts) && accounts[0] ? accounts[0] : null;
    } catch { sender = null; }
  }
  if (!sender) sender = localStorage.getItem('walletAddress');
  if (!sender) return { ok: false, error: 'Connect your wallet to send.' };
  const v = validateSendForm({ to, amountEth, balanceEth });
  if (!v.ok) return { ok: false, error: v.error };
  const tx = buildSendTx({ from: sender, to: to.trim(), wei: v.wei });
  try {
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [tx] });
    return { ok: true, hash };
  } catch (e) {
    return { ok: false, error: e?.message || 'Transaction was rejected.' };
  }
};

// --- Custom Base RPC (desktop → OS keychain via main; browser → wallet-scoped localStorage) ---

const desktopRpc = () => (typeof window !== 'undefined' && window.neuma?.wallet?.rpc) || null;

/**
 * Status of the custom Base RPC. Desktop → the OS-keychain store (main process);
 * browser → wallet-scoped localStorage (status carries `browser: true`).
 * @returns {Promise<{custom:boolean,label?:string,degraded?:string,browser?:boolean}>}
 */
export const getRpcStatus = async () => {
  const rpc = desktopRpc();
  if (!rpc) return browserRpcStatus();
  try { return await rpc.status(); } catch { return { custom: false }; }
};

/** Save a custom Base RPC. Desktop gates it behind a native confirm; browser persists to localStorage. */
export const setRpc = async (url) => {
  const rpc = desktopRpc();
  if (!rpc) return setBrowserRpc(url);
  try { return await rpc.set(url); } catch { return { ok: false, error: 'Could not save the RPC.' }; }
};

/** Revert to the public Base RPC. */
export const clearRpc = async () => {
  const rpc = desktopRpc();
  if (!rpc) return clearBrowserRpc();
  try { return await rpc.clear(); } catch { return { ok: false, error: 'Could not clear the RPC.' }; }
};

/**
 * Probe the active RPC — confirm it responds and report its chain + head
 * block against the SELECTED network, so the UI can show the endpoint is
 * genuinely live and on the chain the wallet currently targets.
 * Note: on desktop, eth_chainId is answered by main as the selected network's
 * id, so the chain check is authoritative in the browser; the block proves
 * liveness in both.
 * @returns {Promise<{ok:true,chainId:number,blockNumber:number,onExpectedChain:boolean,expected:object,chainAuthoritative:boolean}|{ok:false,error:string}>}
 */
export const probeRpc = async () => {
  // On desktop, main answers eth_chainId statically with the selected network's
  // id, so the chain claim is only authoritative in the browser path — the UI
  // must not assert the chain from a value main fabricated. The block proves
  // liveness in both.
  const chainAuthoritative = !(typeof window !== 'undefined' && window.neuma?.wallet?.request);
  try {
    const [{ network: expected }, chainHex, blockHex] = await Promise.all([
      networkStatus(),
      readBaseRpc('eth_chainId', []),
      readBaseRpc('eth_blockNumber', []),
    ]);
    const chainId = parseInt(chainHex, 16);
    const blockNumber = parseInt(blockHex, 16);
    if (!Number.isFinite(chainId) || !Number.isFinite(blockNumber)) {
      return { ok: false, error: 'Malformed RPC response.' };
    }
    return { ok: true, chainId, blockNumber, onExpectedChain: chainId === expected.chainId, expected, chainAuthoritative };
  } catch (e) {
    return { ok: false, error: e?.message || 'RPC did not respond.' };
  }
};
