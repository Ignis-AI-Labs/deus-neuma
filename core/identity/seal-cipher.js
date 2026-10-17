/**
 * Seal cipher — wallet-bound encryption for genesis records.
 *
 * The witness wallet IS the keypair (no second PGP identity to manage):
 *   1. The wallet signs the per-seal derivation message (deterministic —
 *      ECDSA per RFC 6979: same message + same key = same signature).
 *   2. SHA-256 of that signature becomes the AES-256-GCM key.
 *   3. The encrypted record goes on chain; the key never exists anywhere
 *      until the wallet holder signs again to re-derive it.
 *
 * Recovery after total local loss: recordOf(genesisHash) from the chain,
 * sign the derivation message, decrypt locally. No one without the wallet
 * can read it — including the chain, including us.
 *
 * Keys are bound per-seal (message includes the genesisHash), so one
 * derived key can never unlock another seal from the same wallet.
 */
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const ENVELOPE_VERSION = 1;

/** The message the witness signs to derive this seal's key. */
export const sealKeyMessage = (genesisHash) => {
  if (typeof genesisHash !== 'string' || !/^[0-9a-f]{64}$/.test(genesisHash)) {
    throw new Error('sealKeyMessage requires the 64-hex genesisHash');
  }
  return `neuma:genesis-seal:v1:${genesisHash}`;
};

/** Derive the AES key from the wallet's signature over sealKeyMessage. */
export const deriveSealKey = (signature) => {
  if (typeof signature !== 'string' || signature.length < 64) {
    throw new Error('deriveSealKey requires the wallet signature string');
  }
  return createHash('sha256').update(signature).digest();
};

/**
 * Encrypt a canonical genesis record for on-chain storage.
 * Returns a compact JSON envelope string — the opaque payload the
 * Natalis stores without interpreting.
 */
// impure (random IV)
export const encryptSealRecord = (canonicalRecord, key) => {
  if (typeof canonicalRecord !== 'string' || canonicalRecord.length === 0) {
    throw new Error('encryptSealRecord requires the canonical record string');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(canonicalRecord, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: ENVELOPE_VERSION,
    alg: ALGO,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  });
};

/**
 * Decrypt an on-chain envelope back to the canonical record.
 * GCM authentication makes wrong-wallet keys fail loudly, not silently.
 */
export const decryptSealRecord = (envelopeString, key) => {
  let envelope;
  try {
    envelope = JSON.parse(envelopeString);
  } catch {
    throw new Error('Seal envelope is not valid JSON');
  }
  if (envelope.v !== ENVELOPE_VERSION || envelope.alg !== ALGO) {
    throw new Error(`Unsupported seal envelope (v${envelope.v}, ${envelope.alg})`);
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};
