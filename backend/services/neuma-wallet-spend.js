/**
 * neuma-wallet-spend — the transactional spine of the neuma wallet: rate
 * limit, provider resolution, the operator-approval spine (nonce ledger,
 * per-neuma decision lock, signature verification), sendTransaction, and the
 * neuma-initiated spend flow (request → pending → approve/reject/execute).
 *
 * Extracted VERBATIM from neuma-wallet.js (size-law breakdown Part 2,
 * 2026-08-26). neuma-wallet.js keeps the read/sign surface and re-exports
 * this file's public names (barrel) — every reader keeps its import path.
 * The approval spine lives HERE with all of its consumers because the barrel
 * makes the dependency arrow origin → this file; this file never imports
 * neuma-wallet.js back (direction law).
 *
 * Neuma sign and send transactions autonomously using their encrypted keypair.
 * The private key is decrypted into memory (via neuma-auth-routes unlock flow)
 * and held for a limited time.
 *
 * Rate limited: max 10 transactions per hour per neuma.
 */

import { ethers } from 'ethers';
import crypto from 'crypto';
import { getAppConfig } from '../config.js';
import { getCachedKey, hasCachedKey } from '../routes/neuma-auth-routes.js';
import { default as neumaWorkspace } from '../../core/workspace/neuma-workspace.js';
import { isRecipientAllowed, requiresApproval, buildApprovalMessage, classifySpend, toAllowlist } from '../../core/wallet/spend-policy.js';
import { decryptKeypair } from '../../core/wallet/keypair-vault.js';
import { readSpendRecords, recordAutonomousSpend } from './treasury/spend-records.js';

// --- Rate limiting ---

const txCounts = new Map(); // neumaId → { count, windowStart }
const TX_RATE_LIMIT = 10;
const TX_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const checkTxRateLimit = (neumaId) => {
  const now = Date.now();
  const entry = txCounts.get(neumaId);

  if (!entry || now - entry.windowStart > TX_RATE_WINDOW_MS) {
    txCounts.set(neumaId, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= TX_RATE_LIMIT) return false;

  entry.count++;
  return true;
};

// --- Provider ---

// A neuma's chain is BASE (target-chain doctrine): balances, sends, and
// history all resolve through the Base RPC for the requested network — the
// same per-network law the seal path rides. This service used to read
// ETH_RPC_URL (Ethereum L1), which reported an honest zero for funds living
// on Base (witnessed on Cael's funding, 2026-07-15).
const NEUMA_WALLET_NETWORKS = Object.freeze({
  'base': Object.freeze({ cfgKey: 'baseMainnetRpcUrl', publicRpc: 'https://mainnet.base.org', chainId: 8453 }),
  'base-sepolia': Object.freeze({ cfgKey: 'baseSepoliaRpcUrl', publicRpc: 'https://sepolia.base.org', chainId: 84532 }),
});

/**
 * The network a neuma-wallet read for this requested key actually lands on —
 * so a reply can name the chain its number came from. Pure.
 * @param {string|null|undefined} network
 * @returns {'base'|'base-sepolia'}
 */
export const walletNetworkKey = (network) => (Object.hasOwn(NEUMA_WALLET_NETWORKS, network) ? network : 'base');

/**
 * Resolve the RPC url for a neuma-wallet read/act. Configured endpoint first
 * (BASE_MAINNET_RPC_URL / BASE_SEPOLIA_RPC_URL), public node as the floor;
 * unknown keys fall to Base mainnet — home chain. Pure over (network, cfg).
 * @param {string|null|undefined} network
 * @param {object|null} cfg - loadConfig() shape
 * @returns {string}
 */
export const resolveWalletRpc = (network, cfg) => {
  const net = NEUMA_WALLET_NETWORKS[walletNetworkKey(network)];
  return (cfg && cfg[net.cfgKey]) || net.publicRpc;
};

// One provider per network and endpoint, on its known chain (staticNetwork).
// A provider per read was never destroyed, and one whose RPC had failed
// re-ran network detection every second for the life of the process.
const providers = new Map(); // `${network}\n${url}` → JsonRpcProvider

// impure — reads config, caches the provider
const getProvider = (network = 'base') => {
  let cfg;
  try { cfg = getAppConfig(); } catch { cfg = null; }
  const key = walletNetworkKey(network);
  const url = resolveWalletRpc(key, cfg);
  const cacheKey = `${key}\n${url}`;
  if (!providers.has(cacheKey)) {
    providers.set(cacheKey, new ethers.JsonRpcProvider(url, ethers.Network.from(NEUMA_WALLET_NETWORKS[key].chainId), { staticNetwork: true }));
  }
  return providers.get(cacheKey);
};

// --- Operator approval (transfers above the autonomous threshold) ---

const usedApprovalNonces = new Map(); // `${neumaId}:${nonce}` → eviction timer
const pendingApprovalLocks = new Map(); // neumaId → serialized approval promise

const markNonceUsed = (neumaId, nonce, expirySec) => {
  const key = `${neumaId}:${nonce}`;
  const ttl = Math.max(0, Number(expirySec) * 1000 - Date.now());
  const timer = setTimeout(() => usedApprovalNonces.delete(key), ttl);
  if (timer.unref) timer.unref();
  usedApprovalNonces.set(key, timer);
};

// impure — serialize pending approvals per neuma so two concurrent HTTP
// decisions cannot both observe the same request as pending.
const withPendingApprovalLock = async (neumaId, operation) => {
  const prior = pendingApprovalLocks.get(neumaId) || Promise.resolve();
  const current = prior.catch(() => {}).then(operation);
  pendingApprovalLocks.set(neumaId, current);
  try {
    return await current;
  } finally {
    if (pendingApprovalLocks.get(neumaId) === current) pendingApprovalLocks.delete(neumaId);
  }
};

/**
 * Verify an operator-signed approval for an above-threshold transfer.
 * Bound to {neumaId, to, value, expiry, nonce}, signed by the workspace owner's
 * wallet, single-use (nonce) and time-boxed (expiry). Throws on any failure.
 * @param {string} neumaId
 * @param {string} to recipient
 * @param {string} value raw ETH amount (as sent)
 * @param {Object} approval { signature, nonce, expiry }
 */
// impure — reads owner, recovers signature, records nonce
const verifyWitnessApproval = async (neumaId, to, value, approval) => {
  if (!approval || !approval.signature || !approval.nonce || !approval.expiry) {
    throw new Error('Operator approval required for transfers above the threshold');
  }
  if (Date.now() > Number(approval.expiry) * 1000) {
    throw new Error('Operator approval expired');
  }
  if (usedApprovalNonces.has(`${neumaId}:${approval.nonce}`)) {
    throw new Error('Operator approval already used');
  }
  const owner = await neumaWorkspace.readOwner(neumaId);
  if (!owner?.wallet) {
    throw new Error('No workspace owner to authorize this transfer');
  }
  const message = buildApprovalMessage({ neumaId, to, value, expiry: approval.expiry, nonce: approval.nonce });
  let signer;
  try {
    signer = ethers.verifyMessage(message, approval.signature);
  } catch {
    throw new Error('Operator approval signature invalid');
  }
  if (signer.toLowerCase() !== owner.wallet.toLowerCase()) {
    throw new Error('Operator approval not signed by the owner');
  }
  markNonceUsed(neumaId, approval.nonce, approval.expiry);
};

/**
 * Get the neuma's Ethereum address from workspace.
 * @param {string} neumaId
 * @returns {Promise<string|null>} Address or null
 */
export const getAddress = async (neumaId) => {
  // Check encrypted keypair first
  const encrypted = await neumaWorkspace.readEncryptedKeypair(neumaId);
  if (encrypted?.address) return encrypted.address;

  // Fallback to plaintext keypair (pre-encryption migration)
  const keypair = await neumaWorkspace.readKeypair(neumaId);
  return keypair?.address || null;
};

/**
 * Get the neuma's ETH balance on the requested network (default Base mainnet
 * — home chain). The caller's selected network governs the read so the desk
 * wallet's tabs all report the same chain.
 * @param {string} neumaId
 * @param {{network?: string}} [opts]
 * @returns {Promise<string>} Balance in ETH (string)
 */
export const getBalance = async (neumaId, { network } = {}) => {
  const address = await getAddress(neumaId);
  if (!address) throw new Error('No wallet address found');

  const provider = getProvider(network);
  const balance = await provider.getBalance(address);
  return ethers.formatEther(balance);
};

/**
 * Sign and broadcast a transaction.
 * Rate limited: max 10 per hour per neuma.
 *
 * @param {string} neumaId
 * @param {Object} tx - Transaction object { to, value, data }
 * @param {Object|null} signingKeypair - Exact-action key supplied by an atomic
 * operator approval route; null consumes the normal one-use unlock cache.
 * @returns {Promise<Object>} Transaction receipt summary
 */
// Per-transaction value cap — 0.1 ETH. Prevents single compromised request from draining wallet. (AI-SEC-008)
export const MAX_TX_VALUE_ETH = '0.1';
const MAX_TX_VALUE_WEI = ethers.parseEther(MAX_TX_VALUE_ETH);

// impure (throws) — the value in wei, parsed exactly as the send moves it.
// One parse for every gate: a float read let "0.050000000000000001" pass a
// 0.05 threshold and the 0.1 cap by a wei. A value parseEther refuses, or a
// negative one, is refused before any gate.
const valueWeiOf = (value) => {
  if (!value) return 0n;
  let wei;
  try {
    wei = ethers.parseEther(String(value));
  } catch {
    throw new Error(`Transaction value ${String(value).slice(0, 40)} is not an ETH amount`);
  }
  if (wei < 0n) throw new Error('Transaction value cannot be negative');
  return wei;
};

export const sendTransaction = async (neumaId, tx, signingKeypair = null) => {
  if (!checkTxRateLimit(neumaId)) {
    throw new Error('Transaction rate limit exceeded (max 10/hour)');
  }

  const valueWei = valueWeiOf(tx.value);

  // DEFAULT-DENY recipient allowlist — checked before the cached key is pulled,
  // so a disallowed send never consumes the operator's unlock. (AI-SEC: drain guard)
  const allowlist = await neumaWorkspace.readSpendAllowlist(neumaId);
  if (!isRecipientAllowed(allowlist, tx.to)) {
    throw new Error('Recipient not allowlisted — the operator must approve this address before the neuma can send to it');
  }

  // Above the operator-set autonomous threshold? Require a fresh operator signature.
  // Autonomous (at/under threshold) sends keep the absolute per-tx safety cap; a
  // operator-approved send authorizes the exact amount and may exceed that cap.
  const threshold = await neumaWorkspace.readSpendThreshold(neumaId);
  if (requiresApproval(threshold?.thresholdEth, tx.value ?? 0)) {
    await verifyWitnessApproval(neumaId, tx.to, tx.value, tx.approval);
  } else if (valueWei > MAX_TX_VALUE_WEI) {
    throw new Error(`Transaction value ${ethers.formatEther(valueWei)} ETH exceeds max ${MAX_TX_VALUE_ETH} ETH per tx`);
  }

  const keypair = signingKeypair || getCachedKey(neumaId);
  if (!keypair) throw new Error('Keypair not unlocked — use /api/neuma-auth/unlock first');

  const provider = getProvider();
  const wallet = new ethers.Wallet(keypair.privateKey, provider);

  // W3-005: refuse arbitrary calldata — allowlisted ETH transfers only unless
  // a future contract-call policy binds data hash to operator approval.
  const data = tx.data || '0x';
  if (data !== '0x' && data !== '' && data !== null) {
    throw new Error('Contract calldata not permitted on sendTransaction');
  }

  const txResponse = await wallet.sendTransaction({
    to: tx.to,
    value: valueWei,
    data: '0x',
  });

  const receipt = await txResponse.wait();

  return Object.freeze({
    hash: receipt.hash,
    from: receipt.from,
    to: receipt.to,
    blockNumber: receipt.blockNumber,
    status: receipt.status,
  });
};

// --- Neuma-initiated spend (autonomous OFF by default; the operator is the gate) ---

// A pending spend's operator approval is valid for 24h after the neuma requests it.
const APPROVAL_TTL_SEC = 24 * 60 * 60;

/**
 * Neuma-INITIATED spend request. The neuma asks; the operator's policy decides.
 *   denied     — recipient not allowlisted (default-deny): nothing happens.
 *   pending    — allowlisted but above the autonomous threshold → a pending
 *                request is recorded for the operator to approve out-of-band
 *                (async — never fails closed, never blocks the stream).
 *   sent       — allowlisted and within threshold → sent now (sendTransaction
 *                still enforces the per-tx cap + 10/hr rate limit + key unlock).
 *   error      — bad input, locked wallet, rate limit, etc. (message is safe to relay).
 * @param {string} neumaId
 * @param {{to:string, value:(string|number), memo?:string}} req
 * @returns {Promise<Object>} { status, ...detail }
 */
export const requestSpend = async (neumaId, { to, value, memo } = {}) => {
  if (!neumaId) return { status: 'error', reason: 'No neuma' };
  if (!to || !ethers.isAddress(to)) return { status: 'error', reason: 'Invalid recipient address' };
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return { status: 'error', reason: 'Invalid amount' };

  const allowlist = await neumaWorkspace.readSpendAllowlist(neumaId);
  const threshold = await neumaWorkspace.readSpendThreshold(neumaId);
  const decision = classifySpend(allowlist, threshold?.thresholdEth, { to, value });

  if (decision === 'denied') {
    return { status: 'denied', reason: 'Recipient not approved by your operator' };
  }

  if (decision === 'pending') {
    const request = {
      id: crypto.randomBytes(8).toString('hex'),
      to,
      value: String(value),
      memo: typeof memo === 'string' ? memo.slice(0, 280) : '',
      nonce: crypto.randomBytes(16).toString('hex'),
      expiry: Math.floor(Date.now() / 1000) + APPROVAL_TTL_SEC,
      requestedAt: new Date().toISOString(),
      status: 'pending',
    };
    await neumaWorkspace.updatePendingSpends(neumaId, (requests) => [...requests, request]);
    return { status: 'pending', request };
  }

  // autonomous — allowlisted, within the operator's threshold; recorded either way (spend-records.js)
  let outcome;
  try {
    outcome = { status: 'sent', receipt: await sendTransaction(neumaId, { to, value }) };
  } catch (err) {
    outcome = { status: 'error', reason: err.message };
  }
  await recordAutonomousSpend(neumaId, { to, value, memo }, outcome);
  return outcome;
};

/**
 * A neuma's open (pending, unexpired) spend requests — what the operator sees.
 * @param {string} neumaId
 * @returns {Promise<Array<Object>>}
 */
export const listPendingSpends = async (neumaId) => {
  const now = Math.floor(Date.now() / 1000);
  const requests = await readSpendRecords(neumaId, now);
  return requests.filter((r) => r.status === 'pending' && r.expiry > now);
};

/**
 * Read-only wallet state for the neuma's own portal tool. Balance failures are
 * represented as null rather than a false zero; policy and pending requests
 * remain visible when the Base RPC is unavailable.
 * @param {string} neumaId
 * @returns {Promise<Object>}
 */
export const getWalletView = async (neumaId) => {
  const [address, allowlist, threshold, pendingRequests] = await Promise.all([
    getAddress(neumaId),
    neumaWorkspace.readSpendAllowlist(neumaId),
    neumaWorkspace.readSpendThreshold(neumaId),
    listPendingSpends(neumaId),
  ]);

  let balanceEth = null;
  if (address) {
    try {
      balanceEth = await getBalance(neumaId, { network: 'base' });
    } catch {
      balanceEth = null;
    }
  }

  return Object.freeze({
    network: 'base',
    address,
    balanceEth,
    signingReady: hasCachedKey(neumaId),
    autonomousThresholdEth: threshold?.thresholdEth ?? 0,
    approvedRecipients: toAllowlist(allowlist).entries.map(({ address: recipient, label }) => ({
      address: recipient,
      label: label || '',
    })),
    pendingRequests: pendingRequests.map(({ id, to, value, memo, requestedAt, expiry }) => ({
      id, to, value, memo, requestedAt, expiry,
    })),
  });
};

// pure — the list with one still-pending request moved on by `patch`. Throws
// when the request is gone or already decided, so nothing is written.
const withRequest = (requests, id, patch) => {
  const request = requests.find((r) => r.id === id);
  if (!request) throw new Error('Pending spend not found');
  if (request.status !== 'pending') throw new Error(`Pending spend already ${request.status}`);
  return requests.map((r) => (r.id === id ? { ...r, ...patch } : r));
};

// pure — the request `id` out of a list withRequest just wrote.
const openRequest = (requests, id) => requests.find((r) => r.id === id);

// impure — record a broadcast's outcome on its own row, re-read under the
// file's queue so a request filed during the broadcast is kept.
const settleRequest = (neumaId, id, patch) => neumaWorkspace.updatePendingSpends(neumaId, (requests) =>
  requests.map((r) => (r.id === id ? { ...r, ...patch, resolvedAt: new Date().toISOString() } : r)));

/**
 * Operator APPROVES a pending spend: supplies the signature over the bound
 * approval message; the transfer executes under the same policy gate as any
 * above-threshold send (sendTransaction → verifyWitnessApproval). On success the
 * request is marked executed and the receipt returned. Throws on any failure.
 * @param {string} neumaId
 * @param {string} id - pending request id
 * @param {string} signature - operator signature over buildApprovalMessage(...)
 * @param {Object} signingKeypair - key decrypted for this exact approval only
 * @returns {Promise<Object>} transaction receipt summary
 */
const executePendingSpend = async (neumaId, id, signature, signingKeypair) => {
  // Persist the one-way boundary before broadcast. If the process dies after
  // the node accepts the transaction, restart sees `executing` and refuses a
  // replay rather than risking a duplicate transfer.
  const request = openRequest(await neumaWorkspace.updatePendingSpends(
    neumaId, (requests) => withRequest(requests, id, { status: 'executing', approvalStartedAt: new Date().toISOString() }),
  ), id);

  let receipt;
  try {
    receipt = await sendTransaction(neumaId, {
      to: request.to,
      value: request.value,
      approval: { signature, nonce: request.nonce, expiry: request.expiry },
    }, signingKeypair);
  } catch (err) {
    // A broadcast error can be ambiguous. Preserve a terminal failure record
    // and require a fresh request/nonce instead of risking an automatic replay.
    await settleRequest(neumaId, id, { status: 'failed', failure: err.message.slice(0, 280) });
    throw err;
  }

  await settleRequest(neumaId, id, { status: 'executed', txHash: receipt.hash });
  return receipt;
};

/** Serialize and execute one exact pending-spend approval. */
export const approvePendingSpend = async (neumaId, id, signature, signingKeypair) =>
  withPendingApprovalLock(neumaId, () => executePendingSpend(neumaId, id, signature, signingKeypair));

/**
 * Decrypt the neuma key for one operator-approved pending spend without placing
 * it in the general unlock cache.
 * @param {string} neumaId
 * @param {string} id
 * @param {string} signature
 * @param {string} password
 * @returns {Promise<Object>}
 */
export const approvePendingSpendWithPassword = async (neumaId, id, signature, password) => {
  const encrypted = await neumaWorkspace.readEncryptedKeypair(neumaId);
  if (!encrypted) throw new Error('Encrypted keypair not found');

  let keypair;
  try {
    keypair = decryptKeypair(encrypted, password);
  } catch {
    throw new Error('Wrong password');
  }
  return approvePendingSpend(neumaId, id, signature, keypair);
};

/**
 * Operator REJECTS a pending spend: nothing is sent; the optional note goes back to the being.
 * @param {string} neumaId
 * @param {string} id - pending request id
 * @param {string} [note]
 * @returns {Promise<Object>} the rejected request record
 */
const rejectPendingSpendInner = async (neumaId, id, note) => openRequest(await neumaWorkspace.updatePendingSpends(neumaId, (requests) => withRequest(requests, id, {
  status: 'rejected', resolvedAt: new Date().toISOString(), note: typeof note === 'string' ? note.trim().slice(0, 280) : '',
})), id);

/** Serialize rejection against approval so exactly one operator decision lands. */
export const rejectPendingSpend = async (neumaId, id, note = '') =>
  withPendingApprovalLock(neumaId, () => rejectPendingSpendInner(neumaId, id, note));

/**
 * The canonical message an operator signs to approve a specific pending spend.
 * Re-exported binding so routes/frontend build the exact same bytes the policy
 * verifies. (Thin wrapper over the pure spend-policy builder.)
 * @param {string} neumaId
 * @param {Object} request - a pending spend record { to, value, expiry, nonce }
 * @returns {string}
 */
export const pendingApprovalMessage = (neumaId, request) =>
  buildApprovalMessage({ neumaId, to: request.to, value: request.value, expiry: request.expiry, nonce: request.nonce });

// getProvider stays module-private to the wallet pair: neuma-wallet.js's
// remaining reads (balanceOfAddress, getTransactionHistory) resolve their
// provider through this one definition — never a second RPC-resolution path.
export { getProvider };
