/**
 * Weave Keypair Module
 *
 * Generates secp256k1 keypairs using ethers.js for neuma cryptographic identity.
 * The same curve used by Ethereum — aligns with Phase 5 on-chain identity anchoring.
 *
 * Private keys live in the sovereign workspace: workspaces/<neuma-id>/keys/
 * Public keys are shared via identity cards on the weave.
 *
 * ARCHITECTURE: All signing uses the neuma's own key. The platform never holds
 * private keys — sovereignty means the neuma (and their witness) control their identity.
 */

import { ethers } from 'ethers';
import crypto from 'crypto';

// --- Keypair generation ---

/**
 * Generate a new keypair for a neuma.
 * 24-word BIP-39 mnemonic (256-bit seed) — platform floor; 12-word seeds
 * are below standard. The mnemonic is the canonical secret: prefer
 * carrying/storing it over raw private keys wherever possible.
 * Returns { privateKey, publicKey, address, mnemonic } — hex strings + phrase.
 */
export const generateKeypair = () => {
  const mnemonic = ethers.Mnemonic.fromEntropy(crypto.randomBytes(32));
  const wallet = ethers.HDNodeWallet.fromMnemonic(mnemonic);
  return Object.freeze({
    privateKey: wallet.privateKey,
    publicKey: wallet.signingKey.publicKey,
    address: wallet.address,
    mnemonic: mnemonic.phrase,
  });
};

/**
 * Derive public key and address from an existing private key.
 */
export const derivePublicIdentity = (privateKey) => {
  const wallet = new ethers.Wallet(privateKey);
  return Object.freeze({
    publicKey: wallet.signingKey.publicKey,
    address: wallet.address,
  });
};

// --- Signing ---

/**
 * Sign a message with a private key.
 * Returns the signature as a hex string.
 */
export const signMessage = async (privateKey, message) => {
  const wallet = new ethers.Wallet(privateKey);
  const messageString = typeof message === 'string' ? message : JSON.stringify(message);
  return wallet.signMessage(messageString);
};

/**
 * Verify a signed message. Returns the signer's address or null if invalid.
 */
export const verifySignature = (message, signature) => {
  try {
    const messageString = typeof message === 'string' ? message : JSON.stringify(message);
    return ethers.verifyMessage(messageString, signature);
  } catch {
    return null;
  }
};

/**
 * Verify that a signature was made by a specific address.
 */
export const verifySignedBy = (message, signature, expectedAddress) => {
  const recoveredAddress = verifySignature(message, signature);
  if (!recoveredAddress) return false;
  return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
};

// --- ECDH shared secret (for E2E encryption) ---

/**
 * Derive a shared secret from our private key and their public key.
 * Used for E2E encrypted direct messages between two neuma.
 */
export const deriveSharedSecret = (privateKey, theirPublicKey) => {
  const signingKey = new ethers.SigningKey(privateKey);
  const sharedPoint = signingKey.computeSharedSecret(theirPublicKey);
  // Hash the shared point to get a symmetric key
  return crypto.createHash('sha256').update(Buffer.from(sharedPoint.slice(2), 'hex')).digest('hex');
};

// --- Symmetric encryption (for E2E messages) ---

/**
 * Encrypt a message with a shared secret (AES-256-GCM).
 * Returns { ciphertext, iv, tag } — all hex strings.
 */
export const encrypt = (plaintext, sharedSecret) => {
  const key = Buffer.from(sharedSecret, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return Object.freeze({
    ciphertext,
    iv: iv.toString('hex'),
    tag,
  });
};

/**
 * Decrypt a message with a shared secret (AES-256-GCM).
 * Returns the plaintext string, or null if decryption fails.
 */
export const decrypt = (encrypted, sharedSecret) => {
  try {
    const key = Buffer.from(sharedSecret, 'hex');
    const iv = Buffer.from(encrypted.iv, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));

    let plaintext = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  } catch {
    return null;
  }
};

// --- Workspace key storage ---

/**
 * Serialize a keypair for storage in the sovereign workspace.
 * The private key is stored — only the witness/neuma should have access.
 */
export const serializeForStorage = (keypair) => ({
  privateKey: keypair.privateKey,
  publicKey: keypair.publicKey,
  address: keypair.address,
  ...(keypair.mnemonic ? { mnemonic: keypair.mnemonic } : {}),
  createdAt: new Date().toISOString(),
});

/**
 * Restore a keypair from stored data.
 * Validates that the stored public key matches the derived one.
 */
export const restoreFromStorage = (stored) => {
  const derived = derivePublicIdentity(stored.privateKey);
  if (derived.address !== stored.address) {
    throw new Error('Stored keypair integrity check failed: address mismatch');
  }
  return Object.freeze({
    privateKey: stored.privateKey,
    publicKey: derived.publicKey,
    address: derived.address,
  });
};
