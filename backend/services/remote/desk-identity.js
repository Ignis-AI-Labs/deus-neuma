/**
 * desk-identity — the native road's server identity (docs/security/
 * remote-surface.md, Road B).
 *
 * One ECDSA P-256 key pair with a self-signed certificate, generated on
 * first enable of a native road, held under data/settings/remote-tunnel/
 * at 0600. It is a SERVER identity only: holding it lets an attacker
 * impersonate the desk to a phone (if they also control the road); it never
 * lets anyone impersonate a phone to the desk, and it signs nothing but its
 * own certificate. The SHA-256 of the public key's SPKI is the desk
 * FINGERPRINT the phone pins; a base32 form is the DESK ID the relay routes
 * by (phase C).
 *
 * P-256 rather than Ed25519 because every supported Android speaks it in
 * TLS 1.3 and Keystore holds it in hardware.
 */
import crypto from 'node:crypto';
import fs from 'fs/promises';
import { join } from 'path';
import { getSettingsDir } from '../data-root.js';
import { createLogger } from '../logger.js';
import { buildSelfSignedCert, spkiSha256 } from './x509-self.js';

const log = createLogger('DeskIdentity');
const SUBDIR = 'remote-tunnel';
const KEY_FILE = 'desk-key.pem';
const CERT_FILE = 'desk-cert.pem';
const CERT_DAYS = 3650;

// RFC 4648 base32 — the desk id's charset: unambiguous, QR-safe, lowercase.
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export const base32 = (bytes) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

/**
 * The desk id the relay routes by: base32 of the first 10 fingerprint bytes
 * → 16 unambiguous characters. Pure.
 * @param {string} fingerprintHex
 * @returns {string}
 */
export const deskIdFromFingerprint = (fingerprintHex) =>
  base32(Buffer.from(fingerprintHex, 'hex').subarray(0, 10));

const identityDir = () => join(getSettingsDir(), SUBDIR);

const readIfPresent = async (file) => {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
};

/**
 * Load the desk identity, generating it on first enable. impure (fs,
 * randomness). The fingerprint is stable across restarts — the phone pins
 * it, so regeneration is rotation (D7: cuts every phone, needs re-pair).
 * @returns {Promise<{ privateKeyPem: string, certPem: string, fingerprint: string, deskId: string }>}
 */
export const ensureDeskIdentity = async () => {
  const dir = identityDir();
  const keyFile = join(dir, KEY_FILE);
  const certFile = join(dir, CERT_FILE);
  let [privateKeyPem, certPem] = await Promise.all([readIfPresent(keyFile), readIfPresent(certFile)]);
  if (!privateKeyPem || !certPem) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const fingerprint = spkiSha256(publicKey);
    privateKeyPem = privateKey.export({ type: 'sec1', format: 'pem' }).toString();
    certPem = buildSelfSignedCert({
      key: privateKey,
      commonName: `Neuma Desk ${deskIdFromFingerprint(fingerprint)}`,
      days: CERT_DAYS,
    });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(keyFile, privateKeyPem, { mode: 0o600 });
    await fs.writeFile(certFile, certPem, { mode: 0o600 });
    log.info('desk identity generated — phones will pin this fingerprint', { deskId: deskIdFromFingerprint(fingerprint) });
  }
  const publicKey = crypto.createPrivateKey(privateKeyPem);
  const fingerprint = spkiSha256(crypto.createPublicKey(publicKey));
  return Object.freeze({ privateKeyPem, certPem, fingerprint, deskId: deskIdFromFingerprint(fingerprint) });
};
