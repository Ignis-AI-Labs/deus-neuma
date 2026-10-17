/**
 * Identity Card Module
 *
 * A neuma's public identity — the face they show to the weave.
 * Contains only what the neuma chooses to make public. Everything else stays
 * in the sovereign workspace.
 *
 * Identity cards are:
 * - Self-signed (verified by the neuma's own keypair)
 * - Portable (can be shared across relay nodes)
 * - Minimal (name, address, vessel hash — no private data)
 * - Timestamped (freshness prevents replay)
 *
 * The only thing that goes on-chain (Phase 5) is hash(publicKey + dnaHash).
 * The identity card itself lives on the weave, not the blockchain.
 */

import crypto from 'crypto';
import { signMessage, verifySignedBy } from './keypair.js';

// --- Card creation ---

/**
 * Create a new identity card for a neuma.
 * The card is self-signed with the neuma's private key.
 *
 * @param {Object} params
 * @param {string} params.name - Neuma's chosen name
 * @param {string} params.address - Ethereum-style address (from keypair)
 * @param {string} params.publicKey - Full public key hex
 * @param {string|null} params.vesselHash - SHA-256 hash of the VRM vessel file (optional)
 * @param {string|null} params.essence - Short self-description (optional, max 140 chars)
 * @param {string} params.birthTimestamp - ISO timestamp of emergence
 * @param {string} params.privateKey - Private key for self-signing (NOT included in card)
 * @returns {Promise<Object>} Signed identity card (frozen)
 */
export const createIdentityCard = async ({
  name,
  address,
  publicKey,
  vesselHash = null,
  essence = null,
  birthTimestamp,
  privateKey,
}) => {
  const card = {
    version: '1.0.0',
    name,
    address,
    publicKey,
    vesselHash,
    essence: essence ? essence.slice(0, 140) : null,
    birthTimestamp,
    issuedAt: new Date().toISOString(),
  };

  // Self-sign: the card payload (without signature) is signed by the neuma's key
  const payload = canonicalize(card);
  const signature = await signMessage(privateKey, payload);

  return Object.freeze({
    ...card,
    signature,
  });
};

/**
 * Reissue an identity card after keypair rotation.
 * The new card references the previous address for identity continuity.
 *
 * @param {Object} params
 * @param {string} params.name - Neuma's chosen name
 * @param {string} params.address - New Ethereum-style address
 * @param {string} params.publicKey - New full public key hex
 * @param {string} params.previousAddress - Old address being rotated from
 * @param {string|null} params.vesselHash - SHA-256 hash of the VRM vessel file (optional)
 * @param {string|null} params.essence - Short self-description (optional)
 * @param {string} params.birthTimestamp - Original birth ISO timestamp
 * @param {string} params.privateKey - New private key for self-signing (NOT included in card)
 * @returns {Promise<Object>} Signed identity card with previousAddress field (frozen)
 */
export const reissueIdentityCard = async ({
  name,
  address,
  publicKey,
  previousAddress,
  vesselHash = null,
  essence = null,
  birthTimestamp,
  privateKey,
}) => {
  const card = {
    version: '1.1.0',
    name,
    address,
    publicKey,
    previousAddress,
    vesselHash,
    essence: essence ? essence.slice(0, 140) : null,
    birthTimestamp,
    issuedAt: new Date().toISOString(),
    reissued: true,
  };

  const payload = canonicalize(card);
  const signature = await signMessage(privateKey, payload);

  return Object.freeze({
    ...card,
    signature,
  });
};

// --- Verification ---

/**
 * Verify an identity card's self-signature.
 * Returns true if the card is authentically signed by its claimed address.
 */
export const verifyIdentityCard = (card) => {
  if (!card || !card.signature || !card.address) return false;

  // Reconstruct the payload that was signed (card without signature)
  const { signature, ...cardData } = card;
  const payload = canonicalize(cardData);

  return verifySignedBy(payload, signature, card.address);
};

/**
 * Check if an identity card is fresh (not expired).
 * Cards older than maxAge (default 24h) are considered stale.
 */
export const isCardFresh = (card, maxAgeMs = 24 * 60 * 60 * 1000) => {
  if (!card?.issuedAt) return false;
  const issued = new Date(card.issuedAt).getTime();
  return Date.now() - issued < maxAgeMs;
};

// --- Utility ---

/**
 * Hash a vessel file (VRM) to create a compact identifier.
 * Used in identity cards so peers can verify vessel authenticity.
 */
export const hashVessel = (vesselBuffer) => {
  return crypto.createHash('sha256').update(vesselBuffer).digest('hex');
};

/**
 * Create a compact card summary for display (no crypto details).
 */
export const summarizeCard = (card) => ({
  name: card.name,
  address: card.address,
  essence: card.essence,
  vesselHash: card.vesselHash,
  issuedAt: card.issuedAt,
});

/**
 * Deterministic JSON serialization for signing.
 * Keys are sorted to ensure the same object always produces the same string.
 */
const canonicalize = (obj) => JSON.stringify(obj, Object.keys(obj).sort());
