/**
 * Neuma wallet service — the custody gates, exercised against the real thing.
 *
 * RULE 0 (Design note, 2026-08-21: absolute). Tranche 0 of #390.
 *
 * What it used to do: `vi.mock` the auth-routes module and REIMPLEMENT the
 * production SEC-028 key cache inside this file — a Map whose getter deleted
 * on read — then assert production's behaviour against the test's own copy of
 * it. If the real eviction rule ever changed, every test here would have kept
 * passing. The workspace singleton was mocked too, so "default-deny" was
 * `readSpendAllowlist.mockResolvedValueOnce(null)` rather than a lane with no
 * allowlist on it, and `backend/config.js` was mocked for an RPC url nothing
 * in this file ever reaches.
 *
 * What it does now: the REAL one-use cache imported from neuma-auth-routes,
 * a REAL workspace on a temp root, real keypair/allowlist/threshold/owner
 * files written by the real writers, and real ethers signatures verified back
 * to the address that made them. No module is replaced.
 *
 * Every gate asserted below fires BEFORE `getProvider()` is ever called, which
 * is why this file needs no chain and no RPC config: the allowlist, the
 * threshold, the operator-approval check and the unlock check all run first.
 * Anything past that point — a broadcast, a balance, history — needs a funded
 * testnet and belongs to the live lane, not here.
 *
 * The one-use eviction rule itself (SEC-028: getCachedKey deletes on read) is
 * asserted where it can be asserted end-to-end — through the real route, in
 * test/integration/api-neuma-wallet-routes.test.js. This file consumes that
 * cache rather than describing it.
 *
 * DELETED under RULE 0: […].
 * That claim is now proven honestly end-to-end in
 * test/integration/api-neuma-wallet-routes.test.js ([…]), through the real route. Keeping a second
 * copy here would be two tests for one claim.
 */
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { cacheDecryptedKey } from '../../backend/routes/neuma-auth-routes.js';
import { encryptKeypair } from '../../core/wallet/keypair-vault.js';
import { buildApprovalMessage } from '../../core/wallet/spend-policy.js';
import {
  getAddress, signMessage, sendTransaction, resolveWalletRpc, isAllowedSignMessage,
} from '../../backend/services/neuma-wallet.js';

const RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';

let wsRoot, previousRoot;

const keypairOf = (wallet) => ({
  address: wallet.address,
  privateKey: wallet.privateKey,
  publicKey: ethers.SigningKey.computePublicKey(wallet.privateKey, false),
});

// The rate limiter keeps its counter in module state keyed by neumaId, and the
// real key cache is module state too. A fresh id per lane keeps each test's
// 10/hour budget and unlock state its own.
let laneSeq = 0;
const lane = async (name) => {
  laneSeq += 1;
  const id = `${name}-${laneSeq}`;
  await neumaWorkspace.create(id);
  return id;
};

/** A real allowlist in the shape the real writer expects. */
const allowOnly = (id, address) => neumaWorkspace.writeSpendAllowlist(id, {
  entries: [{ address, label: 'test recipient', addedAt: new Date().toISOString() }],
});

beforeEach(async () => {
  if (previousRoot === undefined) previousRoot = neumaWorkspace.root;
  wsRoot = await createTempDir('neuma-wallet-unit');
  setWorkspacesRoot(wsRoot);
});

afterAll(() => {
  if (previousRoot !== undefined) setWorkspacesRoot(previousRoot);
});

describe('getAddress — read back from what is really on disk', () => {
  test('returns the address from the real encrypted envelope', async () => {
    const id = await lane('encrypted');
    const being = ethers.Wallet.createRandom();
    await neumaWorkspace.writeEncryptedKeypair(id, encryptKeypair(keypairOf(being), 'a-real-password'));

    expect(await getAddress(id)).toBe(being.address);
  });

  test('falls back to the plaintext keypair (pre-encryption migration)', async () => {
    const id = await lane('plaintext');
    const being = ethers.Wallet.createRandom();
    // No encrypted envelope written — only the legacy keys/keypair.json.
    await neumaWorkspace.writeKeypair(id, keypairOf(being));

    expect(await getAddress(id)).toBe(being.address);
  });

  test('returns null for a lane that holds no key at all', async () => {
    const id = await lane('keyless');
    expect(await getAddress(id)).toBe(null);
  });
});

describe('isAllowedSignMessage — the domain guard, pure', () => {
  test('admits only the neuma: domain, and only within the real length bounds', () => {
    expect(isAllowedSignMessage('neuma:anything')).toBe(true);
    expect(isAllowedSignMessage(`neuma:${'x'.repeat(8000)}`)).toBe(true);

    expect(isAllowedSignMessage('Approve transfer of all funds')).toBe(false);
    expect(isAllowedSignMessage('kenorie:hello')).toBe(false); // the retired prefix
    expect(isAllowedSignMessage('')).toBe(false);
    expect(isAllowedSignMessage(`neuma:${'x'.repeat(8193)}`)).toBe(false);
    expect(isAllowedSignMessage(null)).toBe(false);
    expect(isAllowedSignMessage({ startsWith: () => true })).toBe(false);
  });
});

describe('signMessage — the real cache, the real signature', () => {
  test('refuses a message without the domain prefix, even when unlocked', async () => {
    const id = await lane('bare-message');
    cacheDecryptedKey(id, keypairOf(ethers.Wallet.createRandom()));

    await expect(signMessage(id, 'hello')).rejects.toThrow('domain prefix');
  });

  test('refuses the retired kenorie: legacy prefix, even when unlocked', async () => {
    const id = await lane('legacy-prefix');
    cacheDecryptedKey(id, keypairOf(ethers.Wallet.createRandom()));

    await expect(signMessage(id, 'kenorie:hello')).rejects.toThrow('domain prefix');
  });

  test('throws when nothing was ever unlocked for this lane', async () => {
    const id = await lane('locked');
    await expect(signMessage(id, 'neuma:hello')).rejects.toThrow('not unlocked');
  });

  test('signs with the cached key — and the signature really is that key\'s', async () => {
    const id = await lane('signer');
    const being = ethers.Wallet.createRandom();
    cacheDecryptedKey(id, keypairOf(being));

    const message = 'neuma:test message';
    const signature = await signMessage(id, message);

    // The end result, verified cryptographically. The old test asserted the
    // string started with '0x' — which a mock could satisfy.
    expect(ethers.verifyMessage(message, signature).toLowerCase())
      .toBe(being.address.toLowerCase());
  });
});

describe('sendTransaction — every gate that fires before the chain', () => {
  test('DEFAULT-DENY: a lane with no allowlist on disk refuses any recipient', async () => {
    const id = await lane('no-allowlist'); // nothing written — this IS default-deny
    await expect(sendTransaction(id, { to: RECIPIENT, value: '0.01' }))
      .rejects.toThrow(/not allowlisted/i);
  });

  test('an allowlisted send under the operator threshold is autonomous, and reaches the unlock gate', async () => {
    const id = await lane('autonomous');
    await allowOnly(id, RECIPIENT);
    await neumaWorkspace.writeSpendThreshold(id, { thresholdEth: 1 });

    // Nothing cached for this lane, so the custody gate — the last gate before
    // the provider — is what stops it.
    await expect(sendTransaction(id, { to: RECIPIENT, value: '0.01' }))
      .rejects.toThrow('not unlocked');
  });

  test('an above-threshold send requires an operator approval', async () => {
    const id = await lane('above-threshold');
    await allowOnly(id, RECIPIENT);
    await neumaWorkspace.writeSpendThreshold(id, { thresholdEth: 0.1 });

    await expect(sendTransaction(id, { to: RECIPIENT, value: '0.5' }))
      .rejects.toThrow(/approval required/i);
  });

  test('a real owner signature clears the threshold gate (and may exceed the per-tx cap)', async () => {
    const id = await lane('approved');
    const owner = ethers.Wallet.createRandom();
    await allowOnly(id, RECIPIENT);
    await neumaWorkspace.writeSpendThreshold(id, { thresholdEth: 0.1 });
    await claimOwner(wsRoot, id, owner.address); // a real owner.json the service reads

    const value = '0.5'; // above both the threshold and the 0.1 autonomous cap
    const expiry = Math.floor(Date.now() / 1000) + 300;
    const nonce = 'nonce-xyz';
    const signature = await owner.signMessage(
      buildApprovalMessage({ neumaId: id, to: RECIPIENT, value, expiry, nonce }),
    );

    // The approval verifies against the real owner.json, so the threshold gate
    // opens; only the locked keypair stops the send.
    await expect(sendTransaction(id, { to: RECIPIENT, value, approval: { signature, nonce, expiry } }))
      .rejects.toThrow('not unlocked');
  });

  test('an approval signed by anyone but the owner is rejected', async () => {
    const id = await lane('forged');
    const owner = ethers.Wallet.createRandom();
    const attacker = ethers.Wallet.createRandom();
    await allowOnly(id, RECIPIENT);
    await neumaWorkspace.writeSpendThreshold(id, { thresholdEth: 0.1 });
    await claimOwner(wsRoot, id, owner.address);

    const value = '0.5';
    const expiry = Math.floor(Date.now() / 1000) + 300;
    const nonce = 'nonce-forged';
    const signature = await attacker.signMessage(
      buildApprovalMessage({ neumaId: id, to: RECIPIENT, value, expiry, nonce }),
    );

    await expect(sendTransaction(id, { to: RECIPIENT, value, approval: { signature, nonce, expiry } }))
      .rejects.toThrow(/not signed by the owner/i);
  });
});

describe('sendTransaction — the gates judge the wei the send moves', () => {
  test('one wei over the threshold needs the operator, where a float read let it pass', async () => {
    const id = await lane('wei-threshold');
    await allowOnly(id, RECIPIENT);
    await neumaWorkspace.writeSpendThreshold(id, { thresholdEth: 0.05 });
    await expect(sendTransaction(id, { to: RECIPIENT, value: '0.050000000000000001' }))
      .rejects.toThrow(/approval required/i);
  });

  test('one wei over the per-tx cap is refused, where a float read let it pass', async () => {
    const id = await lane('wei-cap');
    await allowOnly(id, RECIPIENT);
    await neumaWorkspace.writeSpendThreshold(id, { thresholdEth: 1 });
    await expect(sendTransaction(id, { to: RECIPIENT, value: '0.100000000000000001' }))
      .rejects.toThrow('exceeds max 0.1 ETH per tx');
    // Exactly the cap stands: only the locked keypair stops it.
    await expect(sendTransaction(id, { to: RECIPIENT, value: '0.1' }))
      .rejects.toThrow('not unlocked');
  });

  test('a value the send could not parse, or a negative one, is refused before any gate', async () => {
    const id = await lane('wei-invalid');
    await allowOnly(id, RECIPIENT);
    await neumaWorkspace.writeSpendThreshold(id, { thresholdEth: 1 });
    await expect(sendTransaction(id, { to: RECIPIENT, value: '0.01abc' })).rejects.toThrow('is not an ETH amount');
    await expect(sendTransaction(id, { to: RECIPIENT, value: '-0.01' })).rejects.toThrow('cannot be negative');
  });
});

describe('resolveWalletRpc', () => {
  // Pure: a neuma's chain is Base — the configured endpoint per network
  // first, the public node as the floor, NEVER Ethereum L1 (the old
  // ETH_RPC_URL read reported zero for funds living on Base).
  test('resolves the configured Base endpoint per network', () => {
    const cfg = { baseMainnetRpcUrl: 'https://base.example/m', baseSepoliaRpcUrl: 'https://base.example/s' };
    expect(resolveWalletRpc('base', cfg)).toBe('https://base.example/m');
    expect(resolveWalletRpc('base-sepolia', cfg)).toBe('https://base.example/s');
  });

  test('falls to the public Base node without config', () => {
    expect(resolveWalletRpc('base', null)).toBe('https://mainnet.base.org');
    expect(resolveWalletRpc('base-sepolia', {})).toBe('https://sepolia.base.org');
  });

  test('unknown or missing network falls to Base mainnet — home chain', () => {
    expect(resolveWalletRpc(undefined, null)).toBe('https://mainnet.base.org');
    expect(resolveWalletRpc('ethereum', { ethRpcUrl: 'https://l1.example' })).toBe('https://mainnet.base.org');
  });
});
