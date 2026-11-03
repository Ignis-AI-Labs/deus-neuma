// Custody status checks persisted structure; only password/codes prove decryption.
import fs from 'node:fs/promises';
import path from 'node:path';
import { keyDir } from '../../core/identity/ai-witness/ai-witness-service.js';
import { derivePublicIdentity } from '../../core/weave/keypair.js';
import { kdfIterationsValid } from '../../core/wallet/keypair-vault.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hex = (value, length) => typeof value === 'string'
  && /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0
  && (length === undefined || value.length === length);
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);

// pure — validate the current writer/decryptor contract, not cipher authenticity.
const envelopeValid = value => record(value)
  && value.version === '1.0.0' && value.algorithm === 'aes-256-gcm'
  && value.kdf === 'pbkdf2' && kdfIterationsValid(value.kdfIterations)
  && hex(value.salt, 64) && hex(value.iv, 24) && hex(value.tag, 32)
  && hex(value.ciphertext) && address(value.address);

// pure — an existing plaintext record must describe its actual private key.
const plaintextValid = value => {
  if (!record(value) || !address(value.address)) return false;
  try {
    const identity = derivePublicIdentity(value.privateKey);
    return identity.address.toLowerCase() === value.address.toLowerCase()
      && (!value.publicKey || value.publicKey === identity.publicKey);
  } catch { return false; }
};

// impure — null is reserved for ENOENT; a present JSON null fails validation.
const readArtifact = async (directory, filename, valid) => {
  let raw;
  try { raw = await fs.readFile(path.join(directory, filename), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const value = JSON.parse(raw);
  if (!valid(value)) throw new Error(`Invalid witness custody artifact: ${filename}`);
  return value;
};

/** Read custody artifacts without treating invalid records as missing. impure. */
export const readWitnessCustodyArtifacts = async ({ vendorSlug, chosenName }) => {
  const directory = keyDir(vendorSlug, chosenName);
  const [plaintext, encrypted, recovery, recoveryHash] = await Promise.all([
    readArtifact(directory, 'keypair.json', plaintextValid),
    readArtifact(directory, 'keypair-encrypted.json', envelopeValid),
    readArtifact(directory, 'keypair-recovery.json', envelopeValid),
    readArtifact(directory, 'recovery-hash.json', value => hex(value, 64)),
  ]);
  if (encrypted || recovery || recoveryHash) {
    if (!encrypted || !recovery || !recoveryHash) throw new Error('Incomplete witness custody artifacts');
    if (encrypted.address.toLowerCase() !== recovery.address.toLowerCase()
      || (plaintext && plaintext.address.toLowerCase() !== encrypted.address.toLowerCase())) {
      throw new Error('Witness custody artifact addresses disagree');
    }
  }
  return { plaintext, encrypted };
};
