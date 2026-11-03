// Seals a keypair envelope byte-for-byte the way keypair-vault's writer did before the PBKDF2
// raise (same fields, same cipher, the count chosen by the caller), so tests can prove envelopes
// already on disk keep opening. impure — random salt and IV.
import crypto from 'node:crypto';

export const sealLegacyEnvelope = (keypair, password, { iterations = 100_000, withCount = true } = {}) => {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha512');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify({ privateKey: keypair.privateKey, publicKey: keypair.publicKey, address: keypair.address });
  const ciphertext = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
  return {
    version: '1.0.0',
    algorithm: 'aes-256-gcm',
    kdf: 'pbkdf2',
    ...(withCount ? { kdfIterations: iterations } : {}),
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ciphertext,
    tag: cipher.getAuthTag().toString('hex'),
    address: keypair.address,
    encryptedAt: new Date().toISOString(),
  };
};
